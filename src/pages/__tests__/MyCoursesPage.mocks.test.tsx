import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §224.2. «Мои курсы»: у курса, где пробник идёт, полоса «Идёт пробник «№1» ·
 * осталось 7 мин · Начать» прямо на карточке, и такая карточка — первой.
 * Полоса — рядом со ссылкой курса, не внутри неё (ссылка в ссылке).
 */

const MIN = 60_000
const rpcCalls: unknown[] = []

function chain(data: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'not', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data, error: null })
  c.maybeSingle = () => Promise.resolve({ data, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(f)
  return c
}

const course = (id: string, title: string) => ({ id, title, subject: 'math', exam_type: 'ege', start_date: null, end_date: null })
const MEMBERSHIPS = [
  { group_id: 'g-phys', groups: { id: 'g-phys', name: '11А', course_id: 'c-phys', courses: course('c-phys', 'Физика ЕГЭ') } },
  { group_id: 'g-sand', groups: { id: 'g-sand', name: 'Песочница', course_id: 'c-sand', courses: course('c-sand', 'Песочница — пробник (тест)') } },
]

function listRow() {
  const now = Date.now()
  const s = now - 233 * MIN
  return [{
    id: 'ex1', title: '№1', starts_at: new Date(s).toISOString(), ends_at: new Date(s + 240 * MIN).toISOString(),
    photos_until: new Date(s + 255 * MIN).toISOString(), duration_minutes: 240,
    submitted_at: null, has_work: false, notified: false, server_now: new Date(now).toISOString(),
  }]
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'students') return chain({ id: 'student-1' })
      if (table === 'group_students') return chain(MEMBERSHIPS)
      if (table === 'modules') return chain([{ course_id: 'c-sand', topics: [{ id: 't1', is_open: true, available_from: null }] }])
      return chain([])
    },
    rpc: (name: string, args: { p_group_id: string }) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: name === 'my_mock_exams' && args.p_group_id === 'g-sand' ? listRow() : [], error: null })
    },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'p1', role: 'student' } }),
}))

import { MyCoursesPage } from '@/pages/MyCoursesPage'

describe('MyCoursesPage — идущий пробник на карточке курса (§224.2)', () => {
  it('полоса на карточке своего курса, карточка первой; «Начать» — на страницу пробника', async () => {
    render(
      <MemoryRouter initialEntries={['/my-course']}>
        <Routes>
          <Route path="/my-course" element={<MyCoursesPage />} />
          <Route path="/my-course/:groupId/mock/:examId" element={<p>страница пробника</p>} />
        </Routes>
      </MemoryRouter>,
    )
    const alert = await screen.findByTestId('mock-alert')
    const cards = screen.getAllByTestId('course-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Песочница — пробник (тест)')
    expect(within(cards[0]).getByTestId('mock-alert')).toBe(alert)
    expect(within(cards[1]).queryByTestId('mock-alert')).toBeNull()
    expect(alert).toHaveTextContent('Идёт пробник «№1»')
    expect(alert).toHaveTextContent('осталось 7 мин')
    // Ссылка пробника не вложена в ссылку курса.
    expect(alert.closest('a')).toBeNull()
    expect(rpcCalls).toContainEqual({ name: 'my_mock_exams', args: { p_group_id: 'g-sand' } })
    fireEvent.click(within(alert).getByRole('link', { name: /Начать/ }))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })
})
