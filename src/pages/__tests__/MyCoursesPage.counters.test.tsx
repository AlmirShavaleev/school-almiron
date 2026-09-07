import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §141. Вторая цифра карточки считалась по `homework_submissions` +
 * `homeworks` — это ДЗ первой версии, обе таблицы пусты, и «выполнено» было
 * нулём по построению, независимо от данных. Теперь карточка считает открытые
 * темы тем же правилом, что страница курса.
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

// Две темы открыты (тумблер и наступившая дата), две закрыты.
const MODULES = [{
  course_id: 'course-1',
  topics: [
    { id: 't1', is_open: true, available_from: null },
    { id: 't2', is_open: null, available_from: '2020-01-01' },
    { id: 't3', is_open: false, available_from: null },
    { id: 't4', is_open: null, available_from: '2999-01-01' },
  ],
}]

const GROUPS = [{
  id: 'group-1',
  name: '11А',
  courses: {
    id: 'course-1', title: 'Физика ЕГЭ 11А', subject: 'physics', exam_type: 'ege',
    start_date: null, end_date: null,
  },
}]

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      queried.push(table)
      if (table === 'students') return chain({ id: 'student-1' })
      // Страница читает group_students с вложенной группой и курсом.
      if (table === 'group_students') {
        return chain(GROUPS.map(g => ({ group_id: g.id, groups: { ...g, course_id: g.courses.id } })))
      }
      if (table === 'groups') return chain(GROUPS)
      if (table === 'modules') return chain(MODULES)
      return chain([])
    },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-1', role: 'student' } }),
}))

import { MyCoursesPage } from '@/pages/MyCoursesPage'

describe('MyCoursesPage — вторая цифра карточки', () => {
  beforeEach(() => { queried.length = 0 })

  it('мёртвые таблицы ДЗ первой версии больше не читаются', async () => {
    render(<MemoryRouter><MyCoursesPage /></MemoryRouter>)
    await screen.findByTestId('course-card-topics')

    expect(queried).not.toContain('homework_submissions')
    expect(queried).not.toContain('homeworks')
    expect(queried).toContain('modules')
  })

  it('считает открытые темы, а не выполненные задания', async () => {
    render(<MemoryRouter><MyCoursesPage /></MemoryRouter>)
    expect(await screen.findByTestId('course-card-topics')).toHaveTextContent('2 / 4 тем открыто')
  })
})
