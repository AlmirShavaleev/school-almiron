import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EMPTY_HOME } from '@/lib/teacherHome'

/**
 * §263. Главная учителя: пока окно проверочной/контрольной идёт — блок
 * «Идёт сейчас» с кнопкой «Следить» (монитор). Ничего не идёт / нет функции —
 * блока нет.
 */
const live = vi.hoisted(() => ({ data: null as unknown, error: null as null | { message: string } }))
vi.mock('@/lib/safeRpc', () => ({ safeRpc: vi.fn(async () => ({ data: live.data, error: live.error })) }))
vi.mock('@/hooks/useTeacherHome', () => ({
  useTeacherHome: () => ({ pending: [], home: { ...EMPTY_HOME, today: '2026-10-03' }, loading: false, error: null, reload: vi.fn(), remind: vi.fn() }),
}))

import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'

const OPENS = '2026-10-03T05:45:00.000Z'
const CLOSES = '2026-10-03T06:30:00.000Z'

function renderHome() {
  return render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)
}

describe('Главная учителя: «Идёт сейчас» (§263)', () => {
  it('идущая работа — строка с классом и «Следить» в монитор', async () => {
    live.data = [
      { homework_id: 'hw1', topic_id: 't1', title: 'Движение по окружности', kind: 'check', group_name: '10А', opens_at: OPENS, closes_at: CLOSES, personal_live: 0, server_now: '2026-10-03T06:00:00.000Z' },
    ]
    live.error = null
    renderHome()
    const row = await screen.findByTestId('home-live-row')
    expect(row).toHaveTextContent('Движение по окружности')
    expect(row).toHaveTextContent('Проверочная работа · 10А · идёт до 09:30')
    expect(within(row).getByTestId('home-live-watch')).toHaveAttribute('href', '/live-work/hw1')
  })

  it('ничего не идёт или функции нет — блока нет', async () => {
    live.data = []
    renderHome()
    await waitFor(() => expect(screen.getByTestId('teacher-home')).toBeInTheDocument())
    expect(screen.queryByTestId('home-live')).not.toBeInTheDocument()
    live.data = null
    live.error = { message: 'function my_live_timed_works does not exist' }
    renderHome()
    await waitFor(() => expect(screen.getAllByTestId('teacher-home').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('home-live')).not.toBeInTheDocument()
  })
})
