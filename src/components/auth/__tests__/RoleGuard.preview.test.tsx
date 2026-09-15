import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { PreviewStubGate } from '@/components/layout/StudentPreviewUnavailable'
import { DashboardPage } from '@/pages/DashboardPage'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'
import { resetCuratorshipsCache } from '@/hooks/useMyCuratorships'

/**
 * §178. Третья дверь сторожа — предпросмотр глазами ученика. Только для
 * маршрутов, где она проставлена явно: `preview="allow"` пускает admin/owner
 * на ученическую страницу, `preview="stub"` показывает заглушку вместо
 * страницы с личными данными. Без флага режим на охрану не влияет, а
 * настоящему ученику и преподавателю предпросмотр недоступен по построению.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.then = (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onFulfilled)
      return chain
    },
  },
}))

function setProfile(role: string, id: string) {
  useAuthStore.setState({
    profile: {
      id, email: 'x@example.com', full_name: 'Кто-то', role,
      created_at: '2026-08-05T00:00:00.000Z', updated_at: '2026-08-05T00:00:00.000Z',
    },
    loading: false,
  } as any)
}

function renderRoutes(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/admin" element={<div>Панель админа</div>} />
        <Route path="/student" element={<RoleGuard allow={['student']} preview="stub"><div>Мой кабинет</div></RoleGuard>} />
        <Route path="/my-course" element={<RoleGuard allow={['student']} preview="allow"><div>Список курсов</div></RoleGuard>} />
        <Route path="/my-homework" element={<RoleGuard allow={['student']} preview="stub"><div>Мои ДЗ</div></RoleGuard>} />
        <Route path="/notifications" element={<PreviewStubGate><div>Уведомления владельца</div></PreviewStubGate>} />
        <Route path="/student/variants" element={<RoleGuard allow={['student']}><div>Варианты без флага</div></RoleGuard>} />
        <Route path="/students" element={<div>Ученики</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RoleGuard и предпросмотр глазами ученика (§178)', () => {
  beforeEach(() => {
    resetCuratorshipsCache()
    localStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null, choiceMade: true })
  })

  it('owner в предпросмотре проходит на ученический маршрут с preview="allow"', async () => {
    setProfile('owner', 'owner-1')
    localStorage.setItem('almiron:staff-mode:owner-1', 'student')
    renderRoutes('/my-course')
    expect(await screen.findByText('Список курсов')).toBeInTheDocument()
  })

  it('owner вне предпросмотра на тот же маршрут не проходит — уходит на дашборд', async () => {
    setProfile('owner', 'owner-1')
    renderRoutes('/my-course')
    expect(await screen.findByText('Панель админа')).toBeInTheDocument()
  })

  it('/dashboard в предпросмотре ведёт на список курсов ученика', async () => {
    setProfile('admin', 'admin-1')
    localStorage.setItem('almiron:staff-mode:admin-1', 'student')
    renderRoutes('/dashboard')
    expect(await screen.findByText('Список курсов')).toBeInTheDocument()
  })

  it('страницы с личными данными ученика в предпросмотре — заглушка со ссылкой на учеников', async () => {
    setProfile('owner', 'owner-1')
    localStorage.setItem('almiron:staff-mode:owner-1', 'student')
    renderRoutes('/my-homework')
    const stub = await screen.findByTestId('student-preview-unavailable')
    expect(stub).toHaveTextContent('В предпросмотре недоступно')
    expect(screen.queryByText('Мои ДЗ')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Карточка ученика/ })).toHaveAttribute('href', '/students')
  })

  it('«Мой кабинет» ученика в предпросмотре — тоже заглушка, а не редирект', async () => {
    setProfile('owner', 'owner-1')
    localStorage.setItem('almiron:staff-mode:owner-1', 'student')
    renderRoutes('/student')
    expect(await screen.findByTestId('student-preview-unavailable')).toBeInTheDocument()
  })

  it('общий маршрут под PreviewStubGate в предпросмотре — заглушка, вне него — страница', async () => {
    setProfile('owner', 'owner-1')
    localStorage.setItem('almiron:staff-mode:owner-1', 'student')
    const { unmount } = renderRoutes('/notifications')
    expect(await screen.findByTestId('student-preview-unavailable')).toBeInTheDocument()
    unmount()

    localStorage.setItem('almiron:staff-mode:owner-1', 'teacher')
    useStaffModeStore.setState({ mode: 'admin', profileId: null })
    renderRoutes('/notifications')
    expect(await screen.findByText('Уведомления владельца')).toBeInTheDocument()
  })

  it('без флага preview режим на охрану не влияет: admin в предпросмотре не проходит', async () => {
    setProfile('admin', 'admin-1')
    localStorage.setItem('almiron:staff-mode:admin-1', 'student')
    renderRoutes('/student/variants')
    // /dashboard в предпросмотре → /my-course → «Список курсов»; на «Варианты
    // без флага» не пустило.
    expect(await screen.findByText('Список курсов')).toBeInTheDocument()
    expect(screen.queryByText('Варианты без флага')).not.toBeInTheDocument()
  })

  it('настоящий ученик видит свои страницы, а не заглушку, даже со student в хранилище', async () => {
    setProfile('student', 'student-1')
    localStorage.setItem('almiron:staff-mode:student-1', 'student')
    renderRoutes('/my-homework')
    expect(await screen.findByText('Мои ДЗ')).toBeInTheDocument()
  })

  it('преподаватель на ученический маршрут не проходит и заглушки не видит', async () => {
    setProfile('teacher', 'teacher-1')
    localStorage.setItem('almiron:staff-mode:teacher-1', 'student')
    renderRoutes('/my-homework')
    // Его /dashboard ведёт в кабинет учителя, которого в этом наборе роутов
    // нет — важно лишь, что ни страницы, ни заглушки не показано.
    await waitFor(() => {
      expect(screen.queryByText('Мои ДЗ')).not.toBeInTheDocument()
      expect(screen.queryByTestId('student-preview-unavailable')).not.toBeInTheDocument()
      expect(screen.queryByText('Список курсов')).not.toBeInTheDocument()
    })
  })
})
