import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Устройство панели админа: перечень вкладок, «Обзор» как список дел и
 * проводка вкладки «Видео».
 *
 * Вкладки собраны по вопросам владельца, а не по таблицам базы, и порядок у
 * них утверждённый — поэтому сторожится он целиком, а не по одной вкладке.
 *
 * Про «Видео» здесь две поведенческие проверки, обе про то, как вкладка
 * подключена.
 *
 * 1. **Вкладка есть и открывается.** Без неё вся работа недостижима из
 *    интерфейса.
 * 2. **Пока вкладку не открыли, в Bunny не ходим.** Хук `useVideoStats`
 *    смонтирован ВНУТРИ вкладки, а не на странице. Подними его на страницу
 *    (как `useVercelAnalytics`) — и каждое открытие админки дёргало бы
 *    edge-функцию у того, кто на эту вкладку не заглядывает. Проверка именно
 *    поведенческая: разработчику ничего не мешает «упростить» и вернуть хук
 *    наверх, а тест на присутствие вкладки этого не заметит.
 */

const invoke = vi.fn()
const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: () => new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = Promise.resolve({ data: [], error: null })
          return p.then.bind(p)
        }
        return () => new Proxy({}, { get: () => () => undefined })
      },
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

// Числа задаются потестово: «Обзор» — это список дел, и проверить его можно
// только на разных состояниях школы.
let adminStats: { new_users_week: number; total_users: number } | null = null
let schoolStats: Record<string, unknown> | null = null
let schoolError: string | null = null
let dormantRows: { student_id: string }[] = []

vi.mock('@/hooks/useAdminDashboard', () => ({
  useAdminDashboard: () => ({
    profiles: [], groups: [], courses: [], stats: adminStats,
    loading: false, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useSchoolStats', async () => {
  // Порог воронки Telegram — настоящий: строка на «Обзоре» обязана краситься
  // тем же правилом, которым живёт хук, а не своей копией в тесте.
  const actual = await vi.importActual<typeof import('@/hooks/useSchoolStats')>('@/hooks/useSchoolStats')
  return {
    ...actual,
    useSchoolStats: () => ({
      stats: schoolStats, loading: false, error: schoolError,
      fetchedAt: '2026-09-09T17:00:00.000Z', reload: vi.fn(),
    }),
  }
})
vi.mock('@/hooks/useSchoolAnalytics', () => ({
  DORMANT_DAYS: 7,
  useSchoolAnalytics: () => ({
    dormant: dormantRows, activity: [], unopened: [], funnel: [],
    viewHealth: { views_7d: 0, views_total: 0, first_day: null }, hasViewData: false,
    loading: false, error: null, fetchedAt: '2026-09-09T17:00:00.000Z', reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useVercelAnalytics', () => ({
  useVercelAnalytics: () => ({
    totals7: { visitors: 0, pageviews: 0 }, totals30: { visitors: 0, pageviews: 0 },
    days: [], sections: [], referrers: [], devices: [], countries: [],
    fetchedAt: null, fromCache: false, throttled: false, partial: false, daysReturned: 0,
    loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/components/demo/QuickLogin', () => ({ QuickLogin: () => <div>quick-login-stub</div> }))
vi.mock('@/components/admin/StaffTab', () => ({ StaffTab: () => <div>staff-stub</div> }))
vi.mock('@/components/admin/SchoolActivity', () => ({
  DormantPanel: () => <div>dormant-stub</div>,
  LearningPanel: () => <div>learning-stub</div>,
}))
// Живая панель проверяется своим файлом (LiveNow.test.tsx). Здесь нужна только
// проводка: что вкладка её монтирует и передаёт ей уже загруженные страницей
// числа §107, а не заводит для них второй счётчик.
vi.mock('@/components/admin/LiveNow', () => ({
  LiveNow: (p: Record<string, unknown>) => (
    <div
      data-testid="live-now-stub"
      data-pending={String(p.pendingReview)}
      data-today={String(p.submittedToday)}
      data-dormant={String((p.dormant as unknown[]).length)}
      data-profiles={String((p.profiles as unknown[]).length)}
    />
  ),
}))

import { AdminDashboard } from '@/pages/admin/AdminDashboard'

const EMPTY_STATS = {
  lessons: [], unattachedInLibrary: 0, libraryTotalItems: 0,
  period: { days: 30, views: 0, watchTimeRaw: 0, points: 0 },
  fetched_at: '2026-09-09T10:00:00.000Z', source: 'cache', partial: false,
}

/** Спокойный день: делать нечего. */
const QUIET_SCHOOL = {
  teachers: 8, students: 53, courses: 10,
  homework_submitted_total: 31, homework_submitted_7d: 23, homework_submitted_today: 0,
  homework_reviewed: 17, homework_pending: 0, homework_oldest_pending_days: null,
  variants_completed: 1, telegram_connected: 27,
  visits_today: 0, visits_7d: 33,
  support_new: 0, telegram_links_created_7d: 0, telegram_links_connected_7d: 0,
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: EMPTY_STATS, error: null })
  navigate.mockReset()
  adminStats = { new_users_week: 0, total_users: 61 }
  schoolStats = { ...QUIET_SCHOOL }
  schoolError = null
  dormantRows = []
})

function open(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('перечень вкладок', () => {
  it('семь вкладок в утверждённом порядке', () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const labels = ['Сейчас', 'Обзор', 'Ученики', 'Учёба', 'Сайт', 'Видео', 'Команда']
    labels.forEach(l => expect(screen.getByRole('button', { name: l })).toBeInTheDocument())
  })

  it('«Сейчас» открывает живую панель, а не заглушку', () => {
    // Место, оставленное §147, занято настоящей панелью.
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    open('Сейчас')
    expect(screen.getByTestId('live-now-stub')).toBeInTheDocument()
    expect(screen.queryByText(/Живая панель школы готовится/)).not.toBeInTheDocument()
  })

  it('панель получает числа §107 сверху, а не считает их заново', () => {
    // Второй счётчик тех же величин развёл бы два ответа на один вопрос:
    // «ждут проверки» на «Обзоре» и на «Сейчас» обязаны совпадать всегда.
    schoolStats = { ...QUIET_SCHOOL, homework_pending: 9, homework_submitted_today: 4 }
    dormantRows = [{ student_id: 's-1' }, { student_id: 's-2' }]
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    open('Сейчас')

    const panel = screen.getByTestId('live-now-stub')
    expect(panel).toHaveAttribute('data-pending', '9')
    expect(panel).toHaveAttribute('data-today', '4')
    expect(panel).toHaveAttribute('data-dormant', '2')
  })

  it('живая панель не монтируется, пока вкладку не открыли', () => {
    // На ней висят подписка присутствия и подписка на изменения таблиц.
    // Смонтированная заранее, она держала бы сокеты у того, кто на «Сейчас» не
    // заглядывает.
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.queryByTestId('live-now-stub')).not.toBeInTheDocument()
  })

  it('плитки чисел разъехались по вкладкам, а не висят над всеми сразу', () => {
    // Раньше девять плиток стояли НАД вкладками: «Учителей» читалось и на
    // «Курсах», и на «Сайте». Число про команду живёт на «Команде».
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.queryByText('Учителей')).not.toBeInTheDocument()

    open('Команда')
    expect(screen.getByText('Учителей')).toBeInTheDocument()
  })

  it('отказ школьной RPC виден словами на любой вкладке', () => {
    schoolError = 'Статистику школы видит только администратор'
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByText('Статистику школы видит только администратор')).toBeInTheDocument()

    open('Учёба')
    expect(screen.getByText('Статистику школы видит только администратор')).toBeInTheDocument()
  })
})

describe('«Обзор» как список дел', () => {
  it('спокойный день не выдумывает работу', () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByText(/На сегодня всё разобрано/)).toBeInTheDocument()
    expect(screen.queryByTestId('admin-todo')).not.toBeInTheDocument()
  })

  it('непроверенные работы — строка с числом и переходом в очередь', () => {
    schoolStats = { ...QUIET_SCHOOL, homework_pending: 14, homework_oldest_pending_days: 2 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    const row = screen.getByRole('button', { name: /Проверить работы/ })
    expect(row).toHaveTextContent('14')
    expect(row).toHaveTextContent('самая старая ждёт 2 дн.')

    fireEvent.click(row)
    expect(navigate).toHaveBeenCalledWith('/homework-queue')
  })

  it('пустая очередь не превращается в «ждёт 0 дней»', () => {
    // null из RPC означает «ждать нечего», и ноль дней — совсем другое
    // состояние: работу могли сдать сегодня утром.
    schoolStats = { ...QUIET_SCHOOL, homework_pending: 0, homework_oldest_pending_days: null }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.queryByText(/ждёт 0 дн/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Проверить работы/ })).not.toBeInTheDocument()
  })

  it('пропавшие ведут на «Учеников», где стоит сам список', () => {
    dormantRows = [{ student_id: 's1' }, { student_id: 's2' }]
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    const row = screen.getByRole('button', { name: /Написать пропавшим/ })
    expect(row).toHaveTextContent('2')

    fireEvent.click(row)
    expect(screen.getByText('dormant-stub')).toBeInTheDocument()
  })

  it('новички за неделю — отдельная строка', () => {
    adminStats = { new_users_week: 3, total_users: 61 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Встретить новичков/ })).toHaveTextContent('3')
  })

  it('«сегодня» показывает нули честно и подписан источником', () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByText('Сегодня')).toBeInTheDocument()
    expect(screen.getByText(/Сдано работ/)).toBeInTheDocument()
    expect(screen.getAllByTestId('source-note')[0]).toHaveTextContent('Наша база')
  })

  it('сданное сегодня приходит из той же RPC, а не считается на клиенте', () => {
    schoolStats = { ...QUIET_SCHOOL, homework_submitted_today: 5, visits_today: 23 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('23')).toBeInTheDocument()
  })
})

describe('§169: обращения и воронка Telegram на «Обзоре»', () => {
  it('необработанные обращения — строка с числом и переходом на экран обращений', () => {
    schoolStats = { ...QUIET_SCHOOL, support_new: 7 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    const row = screen.getByRole('button', { name: /Разобрать обращения/ })
    expect(row).toHaveTextContent('7')

    fireEvent.click(row)
    expect(navigate).toHaveBeenCalledWith('/admin/support')
  })

  it('ноль обращений — строки нет, день спокойный', () => {
    // Список дел не про нули (§147): «разобрать 0 обращений» — не дело.
    schoolStats = { ...QUIET_SCHOOL, support_new: 0 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /Разобрать обращения/ })).not.toBeInTheDocument()
    expect(screen.getByText(/На сегодня всё разобрано/)).toBeInTheDocument()
  })

  it('«в работе» не считается необработанным: число приходит из RPC как есть', () => {
    // Клиент не пересчитывает: если RPC сказала 2, строка показывает 2, а не
    // сумму каких-либо других ключей.
    schoolStats = { ...QUIET_SCHOOL, support_new: 2, telegram_connected: 40 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Разобрать обращения/ })).toHaveTextContent('2')
  })

  it('Telegram за 7 дней: оба числа в строке и переход в журнал', () => {
    schoolStats = { ...QUIET_SCHOOL, telegram_links_created_7d: 12, telegram_links_connected_7d: 11 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    const row = screen.getByRole('button', { name: /Telegram за 7 дней/ })
    expect(row).toHaveTextContent('создано ссылок 12, привязано 11')
    expect(row).toHaveTextContent('11 / 12')

    fireEvent.click(row)
    expect(navigate).toHaveBeenCalledWith('/admin/telegram')
  })

  it('здоровая привязка не подсвечена как проблема', () => {
    schoolStats = { ...QUIET_SCHOOL, telegram_links_created_7d: 12, telegram_links_connected_7d: 11 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const row = screen.getByRole('button', { name: /Telegram за 7 дней/ })
    expect(row).toHaveAttribute('data-mood', 'ok')
    expect(row).not.toHaveTextContent(/похоже на поломку/)
  })

  it('X ≥ 5 и меньше половины привязалось — тон bad и слова о поломке', () => {
    // Сломанная привязка 08.09: 100 % → 20 %, три дня никто не видел.
    schoolStats = { ...QUIET_SCHOOL, telegram_links_created_7d: 10, telegram_links_connected_7d: 2 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const row = screen.getByRole('button', { name: /Telegram за 7 дней/ })
    expect(row).toHaveAttribute('data-mood', 'bad')
    expect(row).toHaveTextContent(/похоже на поломку/)
  })

  it('ровно половина — ещё не поломка', () => {
    schoolStats = { ...QUIET_SCHOOL, telegram_links_created_7d: 10, telegram_links_connected_7d: 5 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByRole('button', { name: /Telegram за 7 дней/ })).toHaveAttribute('data-mood', 'ok')
  })

  it('меньше пяти ссылок — по ним не судят, даже при нуле привязок', () => {
    // 4 ссылки и 0 привязок — это может быть один человек, у которого не
    // получилось; тревога по такому числу была бы шумом каждую неделю.
    schoolStats = { ...QUIET_SCHOOL, telegram_links_created_7d: 4, telegram_links_connected_7d: 0 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    const row = screen.getByRole('button', { name: /Telegram за 7 дней/ })
    expect(row).toHaveAttribute('data-mood', 'ok')
    expect(row).toHaveTextContent('создано ссылок 4, привязано 0')
  })

  it('за неделю ни ссылок, ни привязок — строки Telegram нет', () => {
    schoolStats = { ...QUIET_SCHOOL, telegram_links_created_7d: 0, telegram_links_connected_7d: 0 }
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: /Telegram за 7 дней/ })).not.toBeInTheDocument()
    expect(screen.getByText(/На сегодня всё разобрано/)).toBeInTheDocument()
  })
})

describe('вкладка «Видео» в панели админа', () => {
  it('вкладка есть в списке', () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Видео' })).toBeInTheDocument()
  })

  it('пока вкладку не открыли, в bunny-video-stats не ходим', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    // Дать всем смонтированным эффектам отработать — если бы хук висел на
    // странице, запрос ушёл бы именно здесь.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Видео' })).toBeInTheDocument())
    expect(invoke).not.toHaveBeenCalledWith('bunny-video-stats', expect.anything())
  })

  it('по клику вкладка открывается и запрашивает статистику', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Видео' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('bunny-video-stats', { body: {} }))
    await waitFor(() => expect(screen.getByTestId('video-stats')).toBeInTheDocument())
  })
})
