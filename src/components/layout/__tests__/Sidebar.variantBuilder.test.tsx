import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * 13.10, владелец: у ученика в меню нет «Конструктора вариантов» (страница и
 * маршрут остались). У учителя пункт остаётся — вход из «Заданий».
 */
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const res = Promise.resolve({ count: 0, error: null })
      const chain: Record<string, unknown> = {}
      chain.eq = () => Object.assign(res, chain)
      chain.is = () => res
      return { select: () => chain }
    },
  },
}))

function setRole(role: string) {
  useAuthStore.setState({
    profile: { id: 'p1', email: 'u@example.com', full_name: 'Тест', role, created_at: '', updated_at: '' },
    loading: false,
  } as never)
}

async function renderMenu() {
  render(<MemoryRouter initialEntries={['/']}><Sidebar open onClose={() => {}} /></MemoryRouter>)
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
}

const builderLink = () => document.querySelector('a[href="/student/variants/generate"]')

beforeEach(() => {
  localStorage.clear()
  useStaffModeStore.setState({ mode: 'teacher', profileId: null })
})

describe('«Конструктор вариантов» в меню', () => {
  it('у ученика пункта нет, остальная «Учёба» на месте', async () => {
    setRole('student')
    await renderMenu()
    expect(builderLink()).toBeNull()
    expect(document.querySelector('a[href="/catalog"]')).not.toBeNull()
    expect(document.querySelector('a[href="/my-mock-exams"]')).not.toBeNull()
  })

  it('у учителя пункт есть', async () => {
    setRole('teacher')
    await renderMenu()
    expect(builderLink()).not.toBeNull()
  })
})
