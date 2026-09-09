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
import type { VideoStatsData } from '@/hooks/useVideoStats'
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

function props(over: Partial<VideoStatsData & { loading: boolean; error: string | null }> = {}) {
  const base: VideoStatsData = {
    lessons: [lesson()],
    unattachedInLibrary: 54,
    libraryTotal: 181,
    period: { days: 30, views: 19, watchSec: 5154, points: 31 },
    fetchedAt: '2026-09-09T10:00:00.000Z',
    fromCache: false, throttled: false, partial: false,
  }
  return { ...base, loading: false, error: null, reload: vi.fn(), ...over }
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
      'bunny-video-stats', { body: { heatmap: 'a' } },
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
