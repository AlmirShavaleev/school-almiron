import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * §263. Режим работы ученика в кабинете: пока у него идёт проверочная (или
 * пробник), любой раздел, кроме страницы работы, — «<Раздел> закрыт до HH:MM»
 * с полосой и «Вернуться к работе»; страница работы открыта; сдал → режим
 * снят сразу (перечитали my_work_mode). Учитель и предпросмотр — без режима.
 */
const rpc = vi.hoisted(() => ({ result: null as unknown, calls: [] as string[] }))
vi.mock('@/lib/safeRpc', () => ({
  safeRpc: vi.fn(async (fn: string) => { rpc.calls.push(fn); return { data: rpc.result, error: null } }),
}))
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/hooks/useSidebarBadges', () => ({ useSidebarBadges: () => ({}) }))
vi.mock('@/components/demo/ImpersonationBanner', () => ({ ImpersonationBanner: () => null }))
vi.mock('@/components/shared/SupportWidget', () => ({ SupportWidget: () => <div data-testid="support-widget" /> }))
vi.mock('@/components/shared/TelegramOnboarding', () => ({ TelegramOnboarding: () => null }))

import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/store/authStore'
import { refreshWorkMode, useWorkModeStore } from '@/store/workModeStore'

const ACTIVE = {
  active: true, kind: 'timed', work_kind: 'check', homework_id: 'hw1', topic_id: 'topic-1', course_id: 'c1', group_id: 'g1',
  title: 'Движение по окружности', opens_at: '2026-10-03T05:45:00.000Z', closes_at: '2026-10-03T06:30:00.000Z',
  personal: false, server_now: '2026-10-03T06:22:18.000Z',
}

function setProfile(role: string) {
  useAuthStore.setState({
    profile: { id: 'p1', email: 's@almiron.ru', full_name: 'Ученик Один', role, created_at: '', updated_at: '' },
    loading: false,
  } as never)
}

function Page({ label }: { label: string }) {
  const location = useLocation()
  return <div data-testid="page">{label}:{location.pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/catalog" element={<Page label="catalog" />} />
          <Route path="/dashboard" element={<Page label="home" />} />
          <Route path="/achievements" element={<Page label="ach" />} />
          <Route path="/my-course/:g/topic/:t" element={<Page label="topic" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Режим работы в кабинете (§263)', () => {
  beforeEach(() => {
    rpc.result = ACTIVE
    rpc.calls = []
    useWorkModeStore.getState().reset()
    setProfile('student')
  })

  it('каталог во время проверочной закрыт: полоса, «Каталог заданий закрыт до 09:30», одна кнопка «Вернуться к работе»', async () => {
    renderAt('/catalog')
    expect(await screen.findByTestId('work-mode-closed-title')).toHaveTextContent('Каталог заданий закрыт до 09:30')
    expect(screen.queryByTestId('page')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-mode-strip')).toHaveTextContent('Идёт проверочная · до 09:30')
    expect(screen.getByTestId('work-mode-strip')).toHaveTextContent('Движение по окружности')
    expect(screen.getByTestId('work-mode-back')).toHaveAttribute('href', '/my-course/g1/topic/topic-1')
    // Сообщения учителю (плавающая «Помощь») остаются.
    expect(screen.getByTestId('support-widget')).toBeInTheDocument()
  })

  it('главная и достижения — тоже закрыты, род раздела верный', async () => {
    renderAt('/dashboard')
    expect(await screen.findByTestId('work-mode-closed-title')).toHaveTextContent('Главная закрыта до 09:30')
  })

  it('страница своей работы открыта, без полосы', async () => {
    renderAt('/my-course/g1/topic/topic-1')
    await waitFor(() => expect(rpc.calls).toContain('my_work_mode'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('page')).toHaveTextContent('topic:/my-course/g1/topic/topic-1')
    expect(screen.queryByTestId('work-mode-strip')).not.toBeInTheDocument()
  })

  it('«Вернуться к работе» ведёт на страницу работы', async () => {
    renderAt('/achievements')
    fireEvent.click(await screen.findByTestId('work-mode-back'))
    expect(await screen.findByTestId('page')).toHaveTextContent('topic:/my-course/g1/topic/topic-1')
  })

  it('сдал → режим снят сразу: тот же раздел открылся', async () => {
    renderAt('/catalog')
    await screen.findByTestId('work-mode-closed')
    rpc.result = { active: false, server_now: ACTIVE.server_now }
    await act(async () => { refreshWorkMode(); await Promise.resolve(); await Promise.resolve() })
    expect(await screen.findByTestId('page')).toHaveTextContent('catalog:/catalog')
    expect(screen.queryByTestId('work-mode-strip')).not.toBeInTheDocument()
  })

  it('нет функции (миграция не применена) — сайт как раньше', async () => {
    rpc.result = null
    renderAt('/catalog')
    await waitFor(() => expect(rpc.calls).toContain('my_work_mode'))
    expect(await screen.findByTestId('page')).toHaveTextContent('catalog')
  })

  it('учитель — режима нет и функция не вызывается', async () => {
    setProfile('teacher')
    renderAt('/catalog')
    expect(await screen.findByTestId('page')).toHaveTextContent('catalog')
    expect(rpc.calls).not.toContain('my_work_mode')
  })
})
