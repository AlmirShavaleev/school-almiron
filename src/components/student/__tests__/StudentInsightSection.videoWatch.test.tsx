import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * §204. Строка «сколько смотрел видео» в карточке ученика у преподавателя.
 *
 * Проверяется ровно то, на чём такая строка обманывает: минуты показываются
 * персоналу (в отличие от ученика), рядом с числом всегда стоит дата начала
 * записи, а когда записей нет — это НЕ ноль минут.
 */

let watchRows: Array<{ day: string; seconds: number }> = []
let watchError: { message: string } | null = null
const queried: string[] = []

function chain(table: string) {
  queried.push(table)
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) c[m] = () => c
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: watchError ? null : watchRows, error: watchError }).then(resolve)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => chain(table), rpc: () => Promise.resolve({ data: null, error: null }) },
}))
vi.mock('@/hooks/useStudentInsights', () => ({
  useStudentInsights: () => ({ insights: null, works: [], loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useStudentFeedback', () => ({
  useStudentFeedback: () => ({
    saved: [], current: null, notes: [], loading: false, error: null,
    reload: vi.fn(), save: vi.fn(), generate: vi.fn(),
  }),
}))
vi.mock('@/hooks/useAttentionSignals', () => ({
  useAttentionSignals: () => ({ signals: [], comparable: 0, loading: false, error: null, reload: vi.fn() }),
}))

import { StudentInsightSection } from '@/components/student/StudentInsightSection'

const PROFILE = 'p0000000-0000-0000-0000-000000000001'

/**
 * Дни считаются от НАСТОЯЩЕГО «сегодня» по Москве — тем же счётом, что в
 * `useStudentVideoWatch`. Прибитая дата сделала бы тест «неделю назад»
 * зелёным сегодня и красным через месяц.
 */
function moscowDayShift(deltaDays: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return date.toISOString().slice(0, 10)
}

function humanDay(day: string): string {
  return new Date(`${day}T00:00:00Z`)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

beforeEach(() => {
  watchRows = []
  watchError = null
  queried.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Видео в карточке ученика у преподавателя (§204)', () => {
  it('показывает минуты за неделю, всего и дату начала записи', async () => {
    const first = moscowDayShift(-30)
    watchRows = [
      { day: first, seconds: 1800 },
      { day: moscowDayShift(-2), seconds: 600 },
      { day: moscowDayShift(0), seconds: 300 },
      // За пределами недели, но внутри «всего» — граница ровно на седьмых сутках.
      { day: moscowDayShift(-7), seconds: 1200 },
    ]
    render(<StudentInsightSection studentId="s1" profileId={PROFILE} />)

    const line = await screen.findByTestId('student-video-watch')
    expect(line).toHaveTextContent('15 мин за неделю')
    expect(line).toHaveTextContent('65 мин всего')
    expect(line).toHaveTextContent(`записи с ${humanDay(first)}`)
  })

  it('без записей — не ноль минут, а «записей пока нет»', async () => {
    render(<StudentInsightSection studentId="s1" profileId={PROFILE} />)

    const line = await screen.findByTestId('student-video-watch')
    expect(line).toHaveTextContent('записей пока нет')
    expect(line.textContent).not.toMatch(/0 мин/)
  })

  it('отказ базы прячет строку целиком, а не рисует нули', async () => {
    watchError = { message: 'relation "video_watch_daily" does not exist' }
    render(<StudentInsightSection studentId="s1" profileId={PROFILE} />)

    await waitFor(() => expect(queried).toContain('video_watch_daily'))
    expect(screen.queryByTestId('student-video-watch')).not.toBeInTheDocument()
  })

  it('без profileId строка не показывается и база не спрашивается', async () => {
    render(<StudentInsightSection studentId="s1" />)

    await screen.findByText('Анализ и обратная связь')
    expect(queried).not.toContain('video_watch_daily')
    expect(screen.queryByTestId('student-video-watch')).not.toBeInTheDocument()
  })

  it('строка стоит и тогда, когда работ у ученика нет вовсе', async () => {
    watchRows = [{ day: moscowDayShift(0), seconds: 120 }]
    render(<StudentInsightSection studentId="s1" profileId={PROFILE} />)

    expect(await screen.findByTestId('student-insights-empty')).toBeInTheDocument()
    expect(await screen.findByTestId('student-video-watch')).toHaveTextContent('2 мин за неделю')
  })
})
