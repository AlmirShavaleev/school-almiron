import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'

/**
 * 14.10, владелец: баллы школы и «Достижения» выключены совсем. У ученика нет
 * ни пункта «Успехи → Достижения», ни счётчика новых наград, и меню больше не
 * ходит в `student_achievements`.
 */
const tables: string[] = []
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      tables.push(table)
      const res = Promise.resolve({ count: 0, data: [], error: null })
      const chain = { eq: () => Object.assign(res, chain), is: () => res, in: () => res }
      return { select: () => chain }
    },
  },
}))

beforeEach(() => {
  tables.length = 0
  useAuthStore.setState({
    profile: { id: 'p1', email: 's@example.com', full_name: 'Ученик Тестовый', role: 'student', created_at: '', updated_at: '' },
    loading: false,
  } as never)
})

describe('меню ученика без «Достижений»', () => {
  it('нет пункта «Достижения» и раздела «Успехи»; «Прогресса» тоже нет', async () => {
    render(<MemoryRouter initialEntries={['/dashboard']}><Sidebar open onClose={() => {}} /></MemoryRouter>)
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
    expect(screen.queryByRole('link', { name: /Достижения/ })).toBeNull()
    expect(screen.queryByText('Успехи')).toBeNull()
    expect(screen.queryByRole('link', { name: /^Прогресс/ })).toBeNull()
    expect(document.querySelector('[data-path="/achievements"]')).toBeNull()
  })

  it('счётчики меню не запрашивают награды', async () => {
    render(<MemoryRouter initialEntries={['/dashboard']}><Sidebar open onClose={() => {}} /></MemoryRouter>)
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
    expect(tables).toContain('notifications')
    expect(tables).not.toContain('student_achievements')
  })
})
