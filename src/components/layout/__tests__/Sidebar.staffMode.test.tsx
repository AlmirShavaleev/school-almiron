import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ count: 0 }),
        }),
      }),
    }),
  },
}))

const OWNER_PROFILE_ID = 'owner-profile'

function setProfile(role: string, id = OWNER_PROFILE_ID) {
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

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar open onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('Sidebar в режимах представления', () => {
  beforeEach(() => {
    localStorage.clear()
    useStaffModeStore.setState({ mode: 'admin', profileId: null })
    setProfile('admin')
  })

  it('в режиме админа показывает «Панель админа»', async () => {
    renderSidebar()
    expect(await screen.findByText('Панель админа')).toBeInTheDocument()
  })

  it('в режиме учителя админские пункты уходят, учительские приходят', async () => {
    localStorage.setItem(`almiron:staff-mode:${OWNER_PROFILE_ID}`, 'teacher')
    renderSidebar()

    expect(await screen.findByText('Кабинет учителя')).toBeInTheDocument()
    expect(screen.queryByText('Панель админа')).not.toBeInTheDocument()
  })

  it('режим влияет на подпись роли в меню', async () => {
    localStorage.setItem(`almiron:staff-mode:${OWNER_PROFILE_ID}`, 'teacher')
    renderSidebar()
    expect(await screen.findByText('Преподаватель')).toBeInTheDocument()
  })

  it('обычного учителя переключатель не касается: меню то же', async () => {
    // Ключ чужого профиля не должен подхватываться — режим на profile_id.
    localStorage.setItem(`almiron:staff-mode:${OWNER_PROFILE_ID}`, 'teacher')
    setProfile('teacher', 'real-teacher-profile')
    renderSidebar()

    expect(await screen.findByText('Кабинет учителя')).toBeInTheDocument()
    expect(screen.queryByText('Панель админа')).not.toBeInTheDocument()
  })
})
