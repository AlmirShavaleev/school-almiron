import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/**
 * Вкладка «Видео».
 *
 * Файл сторожит не вёрстку, а обещания, которые экран даёт владельцу:
 *
 * 1. **Оговорка про безымянность стоит ДО чисел.** Bunny не знает, кто
 *    смотрел; экран, умолчавший об этом, отвечает на вопрос, которого не
 *    знает.
 * 2. **Отказ — словами, а не нулями** (урок §135).
 * 3. **Строка = видео, а не запись материала.** Один ролик стоит в двух-трёх
 *    курсах; строка на каждую запись утроила бы просмотры.
 * 4. **«Ноль просмотров» и «ролика нет в библиотеке» — разные блоки.**
 * 5. **Тепловая карта грузится по клику**, а не вместе со списком.
 */

const invoke = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}))

import { VideoStats } from '@/components/admin/VideoStats'
import type { VideoLibraryStats } from '@/hooks/useVideoStats'
import type { VideoLesson } from '@/lib/videoStats'

function lesson(over: Partial<VideoLesson> = {}): VideoLesson {
  return {
    videoId: 'a', topicTitle: 'Векторы', bunnyTitle: '№2 Видеоконспект_Векторы',
    courses: ['Математика 11А'], placements: 3, onlyInTemplate: false,
    missingInBunny: false, views: 11, lengthSec: 1159,
    totalWatchSec: 1969, avgWatchSec: 179,
    ...over,
  }
}

/** Библиотека математики с данными — то, что до §232 было всей вкладкой. */
function mathLib(over: Partial<VideoLibraryStats> = {}): VideoLibraryStats {
  return {
    id: '726880', label: 'Математика', primary: true, status: 'ok', message: null,
    attachedVideos: 1,
    lessons: [lesson()],
    unattachedInLibrary: 54,
    libraryTotal: 181,
    period: { days: 30, views: 19, watchSec: 5154, points: 31 },
    fetchedAt: '2026-09-09T10:00:00.000Z',
    fromCache: false, throttled: false, partial: false,
    ...over,
  }
}

function physLib(over: Partial<VideoLibraryStats> = {}): VideoLibraryStats {
  return mathLib({
    id: '763334', label: 'Физика', primary: false,
    lessons: [lesson({ videoId: 'p1', topicTitle: 'Кинематика', courses: ['Физика ЕГЭ 10А'], views: 5 })],
    unattachedInLibrary: 0, libraryTotal: 58,
    period: { days: 30, views: 7, watchSec: 600, points: 30 },
    ...over,
  })
}

/**
 * `over` — поля основной библиотеки (как было до §232), плюс служебные
 * `loading`/`error`; `libraries` целиком — для сцен с двумя библиотеками.
 */
function props(over: Partial<VideoLibraryStats & { loading: boolean; error: string | null; libraries: VideoLibraryStats[] }> = {}) {
  const { loading = false, error = null, libraries, ...libOver } = over
  return {
    libraries: libraries ?? [mathLib(libOver)],
    unknownLibraries: [],
    loading, error, reload: vi.fn(),
  }
}

beforeEach(() => {
  invoke.mockReset()
})

describe('вкладка «Видео»', () => {
  it('оговорка про безымянных зрителей стоит на экране', () => {
    render(<VideoStats {...props()} />)

    const note = screen.getByTestId('video-stats-anonymity')
    expect(note.textContent).toContain('не знает, кто смотрел')
    // Именно «просмотры всех», а не «ученики посмотрели» — вводная требует
    // формулировок, которые учитывают отсутствие токенов у ссылок.
    expect(note.textContent).toContain('а не «ученики посмотрели»')
  })

  it('отказ показывается словами вместо таблицы с нулями', () => {
    render(<VideoStats {...props({ error: 'Bunny отклонил ключ: он недействителен.' })} />)

    expect(screen.getByTestId('video-stats-error')).toHaveTextContent('Bunny отклонил ключ')
    expect(screen.queryByTestId('video-stats')).not.toBeInTheDocument()
  })

  it('минуты за период считаются из секунд, а не показываются сырыми', () => {
    render(<VideoStats {...props()} />)
    // 5154 с = 86 мин. Сырое число на экране читалось бы как полтора часа.
    expect(screen.getByText('86 мин')).toBeInTheDocument()
    expect(screen.queryByText('5154 мин')).not.toBeInTheDocument()
  })

  it('урок из трёх курсов — ОДНА строка, курсы перечислены', () => {
    render(<VideoStats {...props({
      lessons: [lesson({ courses: ['Математика 11А', 'Математика Саида'] })],
    })} />)

    expect(screen.getAllByText('Векторы')).toHaveLength(1)
    expect(screen.getByText('Математика 11А · Математика Саида')).toBeInTheDocument()
  })

  it('переключатель меняет порядок: по просмотрам и по минутам — разные топы', async () => {
    render(<VideoStats {...props({
      lessons: [
        lesson({ videoId: 'often', topicTitle: 'Часто', views: 10, totalWatchSec: 100 }),
        lesson({ videoId: 'long',  topicTitle: 'Долго', views: 2,  totalWatchSec: 5000 }),
      ],
    })} />)

    const firstRow = () => screen.getAllByRole('row')[1].textContent
    expect(firstRow()).toContain('Часто')

    fireEvent.click(screen.getByText('по минутам'))
    expect(firstRow()).toContain('Долго')
  })

  it('«не смотрел никто» и «нет в библиотеке» разведены по блокам', async () => {
    render(<VideoStats {...props({
      lessons: [
        lesson({ videoId: 'seen', views: 11 }),
        lesson({ videoId: 'cold', topicTitle: 'Холодный', views: 0 }),
        lesson({ videoId: 'gone', topicTitle: 'Пропавший', views: 0, missingInBunny: true }),
      ],
    })} />)

    expect(screen.getByText('Не смотрел никто — 1')).toBeInTheDocument()
    expect(screen.getByText('Нет в библиотеке Bunny — 1')).toBeInTheDocument()

    // Пропавший ролик НЕ значится среди «не смотрели»: там пустой плеер у
    // ученика, а не отсутствие интереса.
    fireEvent.click(screen.getByText('Показать список'))
    const cold = screen.getByTestId('video-untouched-list')
    expect(cold).toHaveTextContent('Холодный')
    expect(cold).not.toHaveTextContent('Пропавший')
    expect(screen.getByTestId('video-missing-list')).toHaveTextContent('Пропавший')
  })

  it('непривязанные ролики библиотеки названы отдельной строкой', () => {
    render(<VideoStats {...props()} />)
    expect(screen.getByTestId('video-stats-unattached')).toHaveTextContent('ещё 54 роликов')
  })

  it('тепловая карта запрашивается по клику по строке, а не сразу', async () => {
    invoke.mockResolvedValue({
      data: { videoId: 'a', heatmap: { '0': 100, '1': 78, '2': 42 } },
      error: null,
    })
    render(<VideoStats {...props()} />)

    // До клика в функцию не ходим вовсе.
    expect(invoke).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Векторы'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'bunny-video-stats', { body: { heatmap: 'a', library: '726880' } },
    ))
    // 1159 с / 3 отрезка ≈ 386 с на отрезок; падение вдвое на третьем.
    await waitFor(() => expect(screen.getByTestId('video-heatmap-halves'))
      .toHaveTextContent('Внимание падает вдвое к'))
  })

  it('ролик только в шаблоне помечен, а не выброшен молча', () => {
    render(<VideoStats {...props({
      lessons: [lesson({ courses: [], onlyInTemplate: true })],
    })} />)
    expect(screen.getByText('только в шаблоне')).toBeInTheDocument()
  })

  it('пометка кэша и троттлинга видна на экране', () => {
    render(<VideoStats {...props({ fromCache: true, throttled: true })} />)
    expect(screen.getByTestId('video-stats-freshness')).toHaveTextContent('из кэша')
    expect(screen.getByText(/Обновляли только что/)).toBeInTheDocument()
  })
})

describe('вкладка «Видео» — две библиотеки (§232)', () => {
  it('переключатель «Математика / Физика»: у каждой свои числа и свои уроки', () => {
    render(<VideoStats {...props({ libraries: [mathLib(), physLib()] })} />)

    const sw = screen.getByTestId('video-library-switch')
    expect(sw).toHaveTextContent('Математика')
    expect(sw).toHaveTextContent('Физика')
    expect(screen.getByRole('button', { name: 'Математика' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Векторы')).toBeInTheDocument()
    expect(screen.queryByText('Кинематика')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Физика' }))
    expect(screen.getByRole('button', { name: 'Физика' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(screen.queryByText('Векторы')).not.toBeInTheDocument()
    // Плитки периода — из статистики ИМЕННО физики, а не сумма двух библиотек.
    expect(screen.getByText('10 мин')).toBeInTheDocument()
    expect(screen.getByTestId('video-stats-freshness')).toHaveTextContent('в библиотеке 58 роликов')
  })

  it('с одной библиотекой (прежняя функция) переключателя нет', () => {
    render(<VideoStats {...props()} />)
    expect(screen.queryByTestId('video-library-switch')).not.toBeInTheDocument()
  })

  it('физика без ключа — спокойная пометка, не красная ошибка, и сколько роликов ждут', () => {
    render(<VideoStats {...props({
      libraries: [mathLib(), physLib({
        status: 'not_configured', lessons: [], attachedVideos: 58, period: null,
        message: 'Ключ библиотеки физики не задан (BUNNY_PHYSICS_API_KEY). Статистика появится, когда его добавят в переменные проекта.',
      })],
    })} />)

    // На кнопке — серая подпись, числа математики на месте.
    expect(screen.getByRole('button', { name: /Физика/ })).toHaveTextContent('не подключена')
    expect(screen.getByText('Векторы')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Физика/ }))
    const note = screen.getByTestId('video-library-not-configured')
    expect(note).toHaveTextContent('Ключ библиотеки физики не задан')
    expect(screen.getByTestId('video-library-waiting')).toHaveTextContent('привязано 58 роликов из библиотеки 763334')
    // Не тревога: ни role=alert, ни общей ошибки вкладки.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('video-stats-error')).not.toBeInTheDocument()
  })

  it('отказ Bunny по физике — словами на вкладке физики, математика работает', () => {
    render(<VideoStats {...props({
      libraries: [mathLib(), physLib({ status: 'error', lessons: [], message: 'Bunny отклонил ключ библиотеки «Физика» (763334).' })],
    })} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Физика/ }))
    expect(screen.getByTestId('video-library-error')).toHaveTextContent('Bunny отклонил ключ библиотеки «Физика»')

    fireEvent.click(screen.getByRole('button', { name: /Математика/ }))
    expect(screen.getByText('Векторы')).toBeInTheDocument()
  })

  it('тепловая карта ролика физики запрашивается у библиотеки физики', async () => {
    invoke.mockResolvedValue({ data: { videoId: 'p1', heatmap: { '0': 100, '1': 30 } }, error: null })
    render(<VideoStats {...props({ libraries: [mathLib(), physLib()] })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Физика' }))
    fireEvent.click(screen.getByText('Кинематика'))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'bunny-video-stats', { body: { heatmap: 'p1', library: '763334' } },
    ))
  })

  it('материалы из неизвестной библиотеки названы строкой, а не спрятаны', () => {
    render(<VideoStats {...{ ...props(), unknownLibraries: [{ libraryId: '111111', videos: 3 }] }} />)
    expect(screen.getByTestId('video-stats-unknown-libraries')).toHaveTextContent('3 ролика из библиотеки 111111')
  })
})
