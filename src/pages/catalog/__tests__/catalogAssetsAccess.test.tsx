import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { useAuthStore } from '@/store/authStore'
import { resetCuratorshipsCache } from '@/hooks/useMyCuratorships'
import type { UserRole } from '@/types'

/**
 * §195. Кому виден экран картинок каталога.
 *
 * Политика бакета (`is_admin_or_owner()`) пускает писать только владельца и
 * админа. Преподаватель, попавший на экран, получил бы отказ Storage на каждой
 * кнопке — то есть экран врал бы ему про его права. Поэтому дверь закрыта
 * дважды: пункта меню нет и сторож маршрута не пускает. Проверяем обе.
 */

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.in = () => chain
  chain.order = () => chain
  chain.limit = () => chain
  chain.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(onFulfilled)
  return { supabase: { from: () => chain } }
})

function signIn(role: UserRole) {
  useAuthStore.setState({
    profile: {
      id: `profile-${role}`,
      email: `${role}@example.com`,
      full_name: 'Человек',
      role,
      created_at: '2026-09-17T00:00:00.000Z',
      updated_at: '2026-09-17T00:00:00.000Z',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    loading: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

function renderSidebar(at = '/dashboard') {
  return render(<MemoryRouter initialEntries={[at]}><Sidebar open onClose={() => {}} /></MemoryRouter>)
}

/** Подписи пунктов меню, подсвеченных как текущий экран. */
function highlighted(container: HTMLElement): string[] {
  return [...container.querySelectorAll('a')]
    // Ровно класс `bg-white`, а не `hover:bg-white/10` у спокойных пунктов.
    .filter(a => /(^|\s)bg-white(\s|$)/.test(a.className))
    .map(a => a.textContent?.trim() ?? '')
}

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/catalog/assets']}>
      <Routes>
        <Route
          path="/catalog/assets"
          element={<RoleGuard allow={['admin', 'owner']}><div>экран картинок каталога</div></RoleGuard>}
        />
        <Route path="/dashboard" element={<div>Отправлен на дашборд</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Доступ к экрану картинок каталога (§195)', () => {
  beforeEach(() => {
    resetCuratorshipsCache()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('владелец видит пункт меню и попадает на экран', async () => {
    signIn('owner')
    renderSidebar()
    const label = await screen.findByText('Картинки каталога')
    expect(label.closest('a')).toHaveAttribute('href', '/catalog/assets')
  })

  it('админ видит пункт меню', async () => {
    signIn('admin')
    renderSidebar()
    expect(await screen.findByText('Картинки каталога')).toBeInTheDocument()
  })

  it('преподавателю пункта меню нет, хотя каталог ему виден', async () => {
    signIn('teacher')
    renderSidebar()
    expect(await screen.findByText('Каталог заданий')).toBeInTheDocument()
    expect(screen.queryByText('Картинки каталога')).not.toBeInTheDocument()
  })

  it('ученику пункта меню нет', async () => {
    signIn('student')
    renderSidebar()
    expect(await screen.findByText('Каталог заданий')).toBeInTheDocument()
    expect(screen.queryByText('Картинки каталога')).not.toBeInTheDocument()
  })

  it('на экране картинок подсвечен один пункт меню, а не он и «Каталог заданий»', async () => {
    signIn('owner')
    const { container } = renderSidebar('/catalog/assets')
    await screen.findByText('Картинки каталога')
    expect(highlighted(container)).toEqual(['Картинки каталога'])
  })

  it('внутри каталога по-прежнему горит «Каталог заданий»', async () => {
    signIn('owner')
    const { container } = renderSidebar('/catalog/section-1/topic/t-1')
    await screen.findByText('Каталог заданий')
    expect(highlighted(container)).toEqual(['Каталог заданий'])
  })

  it('сторож маршрута пускает владельца', async () => {
    signIn('owner')
    renderRoute()
    expect(await screen.findByText('экран картинок каталога')).toBeInTheDocument()
  })

  it('сторож маршрута уводит преподавателя, даже если он знает адрес', async () => {
    signIn('teacher')
    renderRoute()
    await waitFor(() => expect(screen.getByText('Отправлен на дашборд')).toBeInTheDocument())
    expect(screen.queryByText('экран картинок каталога')).not.toBeInTheDocument()
  })
})
