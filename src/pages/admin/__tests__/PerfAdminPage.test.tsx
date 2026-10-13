/**
 * §291. Экран «Скорость»: таблица вкладок по p95, выбор вкладки → графики по
 * часам (p95 и нагрузка — отдельно), медленные запросы, фильтр по ученику.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  fetchPerfSummary: vi.fn(),
  fetchPerfHourly: vi.fn(),
  fetchPerfPeople: vi.fn(),
  fetchPerfRecent: vi.fn(),
}))
vi.mock('@/lib/perf/perfAdmin', async (orig) => ({ ...(await orig<object>()), ...api }))

import { PerfAdminPage } from '../PerfAdminPage'

const row = (label: string, p95: number) => ({ label, n: 10, p50: p95 / 4, p95, max: p95 * 2, errors: 0, students: 3 })

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><PerfAdminPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchPerfSummary.mockImplementation(async (kind: string) =>
    kind === 'route' ? [row('/my-course/:id', 8200), row('/catalog', 900)] : [row('POST /rest/v1/rpc/student_home_activity', 2500)])
  api.fetchPerfHourly.mockResolvedValue([
    { hour: '2026-10-12T07:00:00Z', n: 30, p50: 900, p95: 20000, students: 20 },
    { hour: '2026-10-12T08:00:00Z', n: 10, p50: 300, p95: 1200, students: 4 },
  ])
  api.fetchPerfPeople.mockResolvedValue([{ profile_id: 'p1', full_name: 'Аня', email: 'a@t.ru', role: 'student', n: 40, route_p95: 8200 }])
  api.fetchPerfRecent.mockResolvedValue([{ at: '2026-10-12T07:40:00Z', kind: 'route', label: '/my-course/:id', ms: 19000, status: null, device: 'mobile' }])
})

describe('«Скорость»', () => {
  it('вкладки по p95, первая выбрана: графики p95 и нагрузки по часам', async () => {
    renderPage()
    const rows = await screen.findAllByTestId('perf-routes-row')
    expect(rows[0]).toHaveTextContent('/my-course/:id')
    expect(rows[0]).toHaveTextContent('8,2 с')
    await waitFor(() => expect(api.fetchPerfHourly).toHaveBeenCalledWith('route', '/my-course/:id', 'today'))
    expect(await screen.findByTestId('perf-chart-p95')).toHaveTextContent('макс. 20 с')
    expect(screen.getByTestId('perf-chart-load')).toHaveTextContent('макс. 20 уч.')
    expect(screen.getAllByTestId('perf-api-row')[0]).toHaveTextContent('student_home_activity')
  })

  it('клик по вкладке — её график; период — переспрос; ученик — его события', async () => {
    renderPage()
    fireEvent.click((await screen.findAllByTestId('perf-routes-row'))[1])
    await waitFor(() => expect(api.fetchPerfHourly).toHaveBeenCalledWith('route', '/catalog', 'today'))
    fireEvent.click(screen.getByTestId('perf-period-week'))
    await waitFor(() => expect(api.fetchPerfSummary).toHaveBeenCalledWith('route', 'week', null))
    await screen.findByRole('option', { name: /Аня/ })
    fireEvent.change(screen.getByTestId('perf-person'), { target: { value: 'p1' } })
    await waitFor(() => expect(screen.getByTestId('perf-recent')).toHaveTextContent('19 с'))
    expect(api.fetchPerfSummary).toHaveBeenCalledWith('route', 'week', 'p1')
  })
})
