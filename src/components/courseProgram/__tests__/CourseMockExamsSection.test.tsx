/**
 * §224. Раздел «Пробники» в программе курса у преподавателя: пробники
 * группы, без времени — словами «ученики не видят», ссылки «Настройка» /
 * «Таблица», «Добавить пробник» — с подставленной группой.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const min = 60_000
const iso = (off: number) => new Date(Date.now() + off * min).toISOString()
const ROWS = [
  { id: 'past', title: 'Пробник №1', starts_at: iso(-10 * 24 * 60), duration_minutes: 240, photo_grace_minutes: 15, template_id: 't1' },
  { id: 'none', title: 'Без времени', starts_at: null, duration_minutes: 240, photo_grace_minutes: 15, template_id: null },
  { id: 'soon', title: 'Пробник №4', starts_at: iso(3 * 24 * 60), duration_minutes: 240, photo_grace_minutes: 15, template_id: 't1' },
  { id: 'run', title: 'Пробник №3', starts_at: iso(-30), duration_minutes: 240, photo_grace_minutes: 15, template_id: 't1' },
]
const filters: [string, string][] = []

function chain(value: unknown) {
  const c: Record<string, unknown> = {
    select: () => c,
    eq: (col: string, v: string) => { filters.push([col, v]); return c },
    order: () => c,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej),
  }
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'mock_exams') return chain({ data: ROWS, error: null })
      if (table === 'teachers') return chain({ data: { id: 'tc' }, error: null })
      if (table === 'groups') return chain({ data: [], error: null })
      if (table === 'mock_exam_templates') return chain({ data: [], error: null })
      throw new Error(`неожиданная таблица ${table}`)
    },
  },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'p-t', role: 'teacher' } }),
}))

import { CourseMockExamsSection } from '@/components/courseProgram/CourseMockExamsSection'

describe('CourseMockExamsSection', () => {
  it('пробники ЭТОЙ группы: идёт → ближайший → без времени → прошедший; ссылки на настройку и таблицу', async () => {
    render(<MemoryRouter><CourseMockExamsSection groupId="g-11a" groupName="11А" /></MemoryRouter>)
    const rows = await screen.findAllByTestId('course-mock-row')
    expect(filters).toContainEqual(['group_id', 'g-11a'])
    expect(rows.map(r => r.getAttribute('data-kind'))).toEqual(['now', 'upcoming', 'unscheduled', 'past'])
    expect(rows[0]).toHaveTextContent(/идёт · до \d\d:\d\d/)
    expect(rows[2]).toHaveTextContent('время не назначено — ученики не видят')
    expect(within(rows[0]).getByText('Настройка').closest('a')).toHaveAttribute('href', '/mock-exams/run/setup')
    expect(within(rows[0]).getByText('Таблица').closest('a')).toHaveAttribute('href', '/mock-exams/run')
    // Без шаблона таблицы по номерам нет — и ссылки нет.
    expect(within(rows[2]).queryByText('Таблица')).toBeNull()
  })

  it('«Добавить пробник» открывает создание с подставленной группой', async () => {
    render(<MemoryRouter><CourseMockExamsSection groupId="g-11a" groupName="11А" /></MemoryRouter>)
    fireEvent.click(await screen.findByTestId('course-mock-add'))
    const group = await screen.findByLabelText('Группа') as HTMLSelectElement
    expect(group.value).toBe('g-11a')
    expect(within(group).getByRole('option', { name: '11А' })).toBeInTheDocument()
  })
})
