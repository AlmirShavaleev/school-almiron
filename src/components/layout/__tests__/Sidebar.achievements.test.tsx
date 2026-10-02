import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/store/authStore'
import { useAchievementsBadge } from '@/store/achievementsStore'

/**
 * §257. Пункт меню «Успехи → Достижения» (вместо «Прогресс») и счётчик новых
 * наград: при входе — из базы (`student_achievements`, seen_at is null), дальше
 * — то, что сообщили sync / «увидел».
 */
const counts: Record<string, number> = { notifications: 0, topic_homework_attempts: 0, student_achievements: 3 }
const filters: string[] = []
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const res = Promise.resolve({ count: counts[table] ?? 0, error: null })
      const chain = { eq: () => Object.assign(res, chain), is: (col: string, v: unknown) => { filters.push(`${table}.${col}=${v}`); return res } }
      return { select: () => chain }
    },
  },
}))

async function renderMenu() {
  render(<MemoryRouter initialEntries={['/student']}><Sidebar open onClose={() => {}} /></MemoryRouter>)
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
}

beforeEach(() => {
  counts.student_achievements = 3
  filters.length = 0
  useAchievementsBadge.setState({ newCount: null })
  useAuthStore.setState({
    profile: { id: 'p1', email: 's@example.com', full_name: 'Ученик Тестовый', role: 'student', created_at: '', updated_at: '' },
    loading: false,
  } as never)
})

describe('меню ученика: «Достижения»', () => {
  it('«Успехи → Достижения» ведёт на /achievements; «Прогресса» больше нет', async () => {
    await renderMenu()
    const link = screen.getByRole('link', { name: /Достижения/ })
    expect(link).toHaveAttribute('href', '/achievements')
    expect(screen.getByText('Успехи')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Прогресс/ })).toBeNull()
  })

  it('счётчик новых наград — из базы (seen_at is null)', async () => {
    await renderMenu()
    const badge = document.querySelector('[data-testid=nav-badge][data-path="/achievements"]')
    expect(badge).toHaveTextContent('3')
    expect(filters).toContain('student_achievements.seen_at=null')
  })

  it('sync/«увидел» сообщили число — меню показывает его сразу; 0 — счётчика нет', async () => {
    await renderMenu()
    act(() => useAchievementsBadge.getState().setNewCount(5))
    expect(document.querySelector('[data-testid=nav-badge][data-path="/achievements"]')).toHaveTextContent('5')
    act(() => useAchievementsBadge.getState().setNewCount(0))
    expect(document.querySelector('[data-testid=nav-badge][data-path="/achievements"]')).toBeNull()
  })
})
