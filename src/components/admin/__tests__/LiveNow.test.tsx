import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Вкладка «Сейчас».
 *
 * Файл сторожит не вёрстку, а обещания, данные владельцу:
 *
 * 1. **Имя подставляет ЭКРАН.** В канале присутствия имён нет — если бы они
 *    брались оттуда, требование «только идентификатор и роль» было бы нарушено
 *    незаметно.
 * 2. **Пустая школа и оборванный канал — РАЗНЫЕ состояния.** Оба выглядят
 *    пустым списком, и молчание тут соврало бы.
 * 3. **Никакой красоты поверх пустоты**: ноль за период называется словами.
 * 4. **Списки ведут на карточку ученика по student_id**, а не по profile_id:
 *    `/students/:id` ждёт именно student_id, и подмена открыла бы пустую
 *    карточку.
 * 5. **Подпись часов честная**: заходы в неё не входят, и это сказано.
 */

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

let pulseState: any = null
let feedState: any[] = []
let liveFeed = true
let loading = false
let error: string | null = null

vi.mock('@/hooks/useLivePulse', () => ({
  useLivePulse: () => ({
    pulse: pulseState, feed: feedState, loading, error,
    fetchedAt: '2026-09-10T10:00:00.000Z', liveFeed, reload: vi.fn(),
  }),
}))

let online: Array<{ profileId: string; role: string }> = []
let presenceOk = true

vi.mock('@/hooks/useSchoolPresence', () => ({
  useOnlinePeople: () => ({ people: online, ok: presenceOk }),
  useSchoolPresence: () => {},
}))

import { LiveNow } from '@/components/admin/LiveNow'
import { PRESENCE_WINDOW_S } from '@/lib/schoolPresence'

const series = (values: number[]) =>
  values.map((value, i) => ({ day: `2026-08-${String(20 + i).padStart(2, '0')}`, value }))

const PULSE = {
  visitsDaily:  [{ day: '2026-09-09', value: 24 }, { day: '2026-09-10', value: 2 }],
  submitsDaily: [{ day: '2026-09-09', value: 5 }, { day: '2026-09-10', value: 0 }],
  // Живой ряд очереди на 11.09: растёт с 2 до 20 — то есть ухудшается.
  queueDaily:   series([1, 1, 1, 1, 1, 2, 2, 1, 5, 9, 14, 16, 23, 20]),
  // Пройденных тем мало, и это правильная картинка, а не поломка.
  marksDaily:   series([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 1, 0, 4, 0]),
  hourly:       [{ hour: 13, events: 9 }, { hour: 14, events: 4 }],
  week: { visitsThis: 110, visitsPrev: 23, submitsThis: 23, submitsPrev: 0 },
  reach: { active7d: 29, enrolled: 32 },
  visitDaysPerStudent: 3.4,
  newStudents: [{ studentId: 's-new', profileId: 'p-new', fullName: 'Новичок', createdAt: '2026-09-09T10:00:00Z' }],
  noTelegram:  [{ studentId: 's-tg', profileId: 'p-tg', fullName: 'Без телеграма' }],
}

const PROFILES = [
  { id: 'p-1', full_name: 'Шавалеев Альмир', role: 'admin' },
  { id: 'p-2', full_name: 'Минхайдаров Тимур', role: 'student' },
]

function props(over: Partial<React.ComponentProps<typeof LiveNow>> = {}) {
  return {
    pendingReview: 9,
    submittedToday: 4,
    dormant: [
      { student_id: 's-d1', profile_id: 'p-d1', full_name: 'Пропавший', days_silent: 9 },
    ],
    profiles: PROFILES,
    schoolError: null,
    ...over,
  }
}

function draw(over: Partial<React.ComponentProps<typeof LiveNow>> = {}) {
  return render(<MemoryRouter><LiveNow {...props(over)} /></MemoryRouter>)
}

beforeEach(() => {
  navigate.mockReset()
  pulseState = PULSE
  feedState = [
    { kind: 'submitted', at: '2026-09-10T09:55:00Z', actorName: 'Рахматуллин', detail: 'Кинематика' },
  ]
  liveFeed = true
  loading = false
  error = null
  online = []
  presenceOk = true
})

describe('присутствие', () => {
  it('имя берётся из профилей, а не из канала', () => {
    online = [{ profileId: 'p-2', role: 'student' }]
    draw()

    // В канале имени нет вовсе — если бы экран его оттуда ждал, здесь было бы
    // пусто. Значит подстановка работает и требование соблюдено.
    expect(screen.getByTestId('live-online-list')).toHaveTextContent('Минхайдаров Тимур')
    expect(screen.getByTestId('live-online-count')).toHaveTextContent('1')
  })

  it('пустая школа говорит «сейчас никого»', () => {
    online = []
    presenceOk = true
    draw()
    expect(screen.getByTestId('live-online-empty')).toHaveTextContent('Сейчас никого')
    expect(screen.queryByTestId('live-online-count')).not.toBeInTheDocument()
  })

  it('непрочитанный список — ОТДЕЛЬНОЕ состояние, а не «никого»', () => {
    online = []
    presenceOk = false
    draw()
    expect(screen.getByTestId('live-online-offline')).toHaveTextContent('не прочитался')
    expect(screen.queryByTestId('live-online-empty')).not.toBeInTheDocument()
  })

  it('подпись совпадает с окном функции, а не с числом из головы', () => {
    // Приёмка §165: подпись обязана описывать ровно то окно, которое панель
    // спрашивает у `school_presence_online`. Число берётся из той же
    // константы — поменяй окно, не поправив текст, и тест упадёт.
    draw()
    const minutes = PRESENCE_WINDOW_S / 60
    expect(screen.getByTestId('live-online').textContent).toContain(`${minutes} минут`)
    // Старое обещание «45 секунд» снято осознанно: теперь присутствие — это
    // «занимался последние полчаса», а не «вкладка поверх остальных».
    expect(screen.getByTestId('live-online').textContent).not.toContain('45 секунд')
  })

  it('конспект в соседней вкладке назван занятием прямо на экране', () => {
    // Ради этого §165 и делался: ученик, читающий PDF, присутствует.
    draw()
    expect(screen.getByTestId('live-online').textContent).toContain('соседней вкладке')
  })

  it('на каком экране человек — не показываем вовсе', () => {
    online = [{ profileId: 'p-2', role: 'student' }]
    draw()
    const block = screen.getByTestId('live-online')
    expect(block.textContent).toContain('На каком экране человек находится — не показываем')
  })
})

describe('числа и неделя', () => {
  it('очередь проверки ведёт в очередь', () => {
    draw()
    fireEvent.click(screen.getByRole('button', { name: /Ждут проверки/ }))
    expect(navigate).toHaveBeenCalledWith('/homework-queue')
  })

  it('охват показан долей от зачисленных', () => {
    draw()
    expect(screen.getByText('29 из 32')).toBeInTheDocument()
    expect(screen.getByText('91 % зачисленных')).toBeInTheDocument()
  })

  it('рост с нуля описывается словами, а не процентом', () => {
    draw()
    // submitsPrev = 0: «+2300 %» было бы шумом, а не числом.
    expect(screen.getByTestId('live-week')).toHaveTextContent('на прошлой неделе не было')
  })

  it('при отказе школьной RPC числа §107 показаны прочерком, а не нулём', () => {
    draw({ schoolError: 'Статистику школы видит только администратор', pendingReview: null })
    const stats = screen.getByText('Ждут проверки').closest('button')
    expect(stats).toHaveTextContent('—')
  })
})

describe('часы', () => {
  it('подпись честно говорит, что заходы сюда не входят', () => {
    draw()
    expect(screen.getByTestId('live-hours')).toHaveTextContent('в них времени суток нет')
  })

  it('час пик назван, когда события есть', () => {
    draw()
    expect(screen.getByTestId('live-hours-peak')).toHaveTextContent('13:00')
  })

  it('без событий час пик не выдумывается', () => {
    pulseState = { ...PULSE, hourly: [{ hour: 0, events: 0 }, { hour: 1, events: 0 }] }
    draw()
    expect(screen.getByTestId('live-hours-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('live-hours-peak')).not.toBeInTheDocument()
  })
})

describe('лента', () => {
  it('событие описано словами школы', () => {
    draw()
    const feed = screen.getByTestId('live-feed')
    expect(feed).toHaveTextContent('Рахматуллин')
    expect(feed).toHaveTextContent('сдал работу')
    expect(feed).toHaveTextContent('Кинематика')
  })

  it('пустая лента говорит об этом, а не оставляет рамку', () => {
    feedState = []
    draw()
    expect(screen.getByTestId('live-feed-empty')).toBeInTheDocument()
  })

  it('не поднявшаяся подписка названа словами', () => {
    liveFeed = false
    draw()
    expect(screen.getByTestId('live-feed-static')).toHaveTextContent('не обновляется сама')
  })
})

describe('списки имён', () => {
  it('пропавшие открываются по student_id, а не по profile_id', () => {
    draw()
    fireEvent.click(screen.getByText('Пропавший'))
    // profile_id здесь открыл бы пустую карточку: `/students/:id` — это student_id.
    expect(navigate).toHaveBeenCalledWith('/students/s-d1')
  })

  it('без Telegram — тоже по student_id', () => {
    draw()
    fireEvent.click(screen.getByText('Без телеграма'))
    expect(navigate).toHaveBeenCalledWith('/students/s-tg')
  })

  it('новые ученики — тоже по student_id', () => {
    draw()
    fireEvent.click(screen.getByText('Новичок'))
    expect(navigate).toHaveBeenCalledWith('/students/s-new')
  })

  it('пустой список говорит словами', () => {
    pulseState = { ...PULSE, noTelegram: [] }
    draw()
    expect(screen.getByTestId('live-no-telegram')).toHaveTextContent('У всех учеников привязан Telegram')
  })
})

describe('отказ и загрузка', () => {
  it('отказ показывается словами вместо панели', () => {
    error = 'Живую панель школы видит только администратор'
    draw()
    expect(screen.getByTestId('live-now-error')).toHaveTextContent('только администратор')
    expect(screen.queryByTestId('live-now')).not.toBeInTheDocument()
  })

  it('загрузка не рисует пустых рамок', () => {
    loading = true
    draw()
    expect(screen.getByText(/Загружаем живую панель/)).toBeInTheDocument()
    expect(screen.queryByTestId('live-now')).not.toBeInTheDocument()
  })
})

describe('карточки с графиками', () => {
  it('их четыре', () => {
    draw()
    const cards = ['card-visits', 'card-submits', 'card-queue', 'card-marks']
    cards.forEach(id => expect(screen.getByTestId(id)).toBeInTheDocument())
  })

  it('рост очереди подсвечен как УХУДШЕНИЕ', () => {
    // Очередь выросла с 2 до 20. Зелёная стрелка вверх здесь была бы прямой
    // дезинформацией: владелец прочёл бы рост завала как хорошую новость.
    draw()
    expect(screen.getByTestId('card-queue-badge')).toHaveAttribute('data-mood', 'bad')
  })

  it('рост заходов подсвечен как улучшение — тон задаётся карточкой, не знаком', () => {
    draw()
    expect(screen.getByTestId('card-visits-badge')).toHaveAttribute('data-mood', 'good')
  })

  it('очередь показывает УРОВЕНЬ на сегодня, а не сумму по дням', () => {
    // Сумма дала бы 97 — величину, не значащую ничего.
    draw()
    expect(screen.getByTestId('card-queue-value')).toHaveTextContent('20')
  })

  it('карточка пройденных тем показывает честный почти-ноль', () => {
    draw()
    // 7 за неделю по строгому определению. Ни сглаживания, ни растянутой шкалы.
    expect(screen.getByTestId('card-marks-value')).toHaveTextContent('7')
  })

  it('точка «живое» — у заходов, и число в ней из присутствия', () => {
    online = [{ profileId: 'p-2', role: 'student' }]
    draw()
    expect(screen.getByTestId('card-visits-dot')).toBeInTheDocument()
    expect(screen.getByTestId('card-visits')).toHaveTextContent('1 сейчас на платформе')
  })

  it('присутствие не прочиталось — точки нет и сказано словами', () => {
    presenceOk = false
    draw()
    expect(screen.queryByTestId('card-visits-dot')).not.toBeInTheDocument()
    expect(screen.getByTestId('card-visits')).toHaveTextContent('присутствие не прочиталось')
  })

  it('карточки очереди и сдач ведут в очередь проверки', () => {
    draw()
    // Обе карточки про одну и ту же очередь, поэтому ведут в одно место.
    // Ищем кнопку внутри каждой карточки: по имени их две, и общий поиск
    // нашёл бы обе сразу.
    for (const card of ['card-submits', 'card-queue']) {
      navigate.mockReset()
      fireEvent.click(within(screen.getByTestId(card)).getByRole('button'))
      expect(navigate).toHaveBeenCalledWith('/inbox')
    }
  })

  it('у карточек без перехода стрелки нет', () => {
    draw()
    // Заходы и пройденные темы никуда не ведут: вести некуда, и стрелка там
    // была бы украшением, а правило §147 — про действие.
    expect(within(screen.getByTestId('card-visits')).queryByRole('button')).toBeNull()
    expect(within(screen.getByTestId('card-marks')).queryByRole('button')).toBeNull()
  })
})
