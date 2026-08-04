import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}))

vi.mock('@/hooks/useSidebarBadges', () => ({
  useSidebarBadges: () => ({}),
}))

vi.mock('@/components/demo/ImpersonationBanner', () => ({
  ImpersonationBanner: () => null,
}))

vi.mock('@/components/shared/SupportWidget', () => ({
  SupportWidget: () => null,
}))

const ADMIN_ID = 'admin-profile'

function setProfile(role: string, id: string) {
  useAuthStore.setState({
    profile: {
      id,
      email: 'owner@almiron.ru',
      full_name: 'Шавалеев Альмир',
      role,
      created_at: '2026-08-04T00:00:00.000Z',
      updated_at: '2026-08-04T00:00:00.000Z',
    },
    loading: false,
  } as any)
}

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/admin" element={<div>cabinet-marker</div>} />
        </Route>
      </Routes>
      <Outlet />
    </MemoryRouter>,
  )
}

describe('Экран выбора режима после входа', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: false })
    setProfile('admin', ADMIN_ID)
  })

  it('админу показывается вместо кабинета', async () => {
    renderLayout()

    expect(await screen.findByTestId('staff-mode-gate')).toBeInTheDocument()
    expect(screen.queryByText('cabinet-marker')).not.toBeInTheDocument()
  })

  it('выбор «учитель» пускает в кабинет и ставит режим', async () => {
    renderLayout()

    fireEvent.click(await screen.findByTestId('staff-mode-gate-teacher'))

    expect(await screen.findByText('cabinet-marker')).toBeInTheDocument()
    expect(useStaffModeStore.getState().mode).toBe('teacher')
    // Режим переживает перезагрузку, отметка о выборе — только текущий вход.
    expect(localStorage.getItem(`almiron:staff-mode:${ADMIN_ID}`)).toBe('teacher')
    expect(sessionStorage.getItem(`almiron:staff-mode-chosen:${ADMIN_ID}`)).toBe('1')
  })

  it('после выбора перезагрузка не спрашивает снова', async () => {
    sessionStorage.setItem(`almiron:staff-mode-chosen:${ADMIN_ID}`, '1')
    renderLayout()

    expect(await screen.findByText('cabinet-marker')).toBeInTheDocument()
    expect(screen.queryByTestId('staff-mode-gate')).not.toBeInTheDocument()
  })

  it('учителю и ученику экран не показывается вовсе', async () => {
    for (const role of ['teacher', 'student', 'curator']) {
      useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: false })
      setProfile(role, `${role}-profile`)
      const view = renderLayout()

      expect(await screen.findByText('cabinet-marker')).toBeInTheDocument()
      expect(screen.queryByTestId('staff-mode-gate')).not.toBeInTheDocument()
      view.unmount()
    }
  })
})
