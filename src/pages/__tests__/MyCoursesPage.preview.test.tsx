import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * §178. Список курсов в предпросмотре глазами ученика: не зачисления (их у
 * владельца нет), а группы курсов, где он персонал, — под той же RLS, что и
 * «Программа курса»; каркасы не показываются; карточка та же, что у ученика.
 */

const queried: string[] = []

function chain(data: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'not', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data, error: null })
  c.maybeSingle = () => Promise.resolve({ data, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(f)
  return c
}

const GROUPS = [
  { id: 'group-1', name: '11А', course_id: 'course-1', courses: { id: 'course-1', title: 'Физика ЕГЭ 11А', subject: 'physics', exam_type: 'ege', start_date: null, end_date: null, is_template: false } },
  { id: 'group-t', name: 'Каркас', course_id: 'course-t', courses: { id: 'course-t', title: 'Физика ЕГЭ Шаблон', subject: 'physics', exam_type: 'ege', start_date: null, end_date: null, is_template: true } },
  { id: 'group-x', name: 'Без курса', course_id: null, courses: null },
]

const MODULES = [{
  course_id: 'course-1',
  topics: [
    { id: 't1', is_open: true, available_from: null },
    { id: 't2', is_open: false, available_from: null },
    { id: 't3', is_open: null, available_from: '2999-01-01' },
  ],
}]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      queried.push(table)
      if (table === 'groups') return chain(GROUPS)
      if (table === 'modules') return chain(MODULES)
      if (table === 'students') return chain(null)
      return chain([])
    },
  },
}))

const PROFILE = { id: 'owner-1', role: 'owner' }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: PROFILE }),
}))

import { MyCoursesPage } from '@/pages/MyCoursesPage'

describe('MyCoursesPage в предпросмотре (§178)', () => {
  beforeEach(() => {
    queried.length = 0
    localStorage.clear()
    useStaffModeStore.setState({ mode: 'student', profileId: 'owner-1', choiceMade: true })
  })

  it('показывает курсы персонала без каркасов, карточкой ученика', async () => {
    render(<MemoryRouter><MyCoursesPage /></MemoryRouter>)

    expect(await screen.findByText('Физика ЕГЭ 11А')).toBeInTheDocument()
    expect(screen.queryByText('Физика ЕГЭ Шаблон')).not.toBeInTheDocument()
    expect(screen.queryByText('Без курса')).not.toBeInTheDocument()
    // Карточка та же: ссылка на курс по группе и счёт открытых тем.
    expect(screen.getByRole('link', { name: /Физика ЕГЭ 11А/ })).toHaveAttribute('href', '/my-course/group-1')
    expect(screen.getByTestId('course-card-topics')).toHaveTextContent('1 / 3 темы открыто')
    expect(screen.getByTestId('my-courses-preview-hint')).toBeInTheDocument()
  })

  it('зачисления и строку students не читает: у владельца их нет', async () => {
    render(<MemoryRouter><MyCoursesPage /></MemoryRouter>)
    await screen.findByText('Физика ЕГЭ 11А')

    expect(queried).not.toContain('students')
    expect(queried).not.toContain('group_students')
    expect(queried).toContain('groups')
  })
})
