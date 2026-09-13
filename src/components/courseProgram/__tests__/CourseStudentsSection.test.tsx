import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * board/023 (§171): строка ученика на вкладке курса ведёт на его карточку по
 * `student_id`, а не по `profile_id` — путаница этих двух id уже ловила
 * §148. Колонка «Действия» (карандаш/отчисление) не должна открывать
 * карточку — иначе преподаватель, целясь в отчисление, улетал бы на чужую
 * страницу. Ссылка настоящая (`<Link>`), не `div onClick`: работает Ctrl+клик
 * и виден href.
 */

const ROWS = [
  {
    student_id: 'stud-1',
    joined_at: '2026-09-01T00:00:00Z',
    groups: { id: 'g1', name: 'Группа А', course_id: 'course-1' },
    students: {
      id: 'stud-1',
      profile_id: 'prof-1',
      profiles: { id: 'prof-1', full_name: 'Иванов Иван', email: 'ivan@test.ru', phone: null },
    },
  },
]

vi.mock('@/hooks/useMyTeachingScope', () => ({
  useMyTeachingScope: () => ({ readOnly: false }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'group_students') {
        return { select: () => ({ eq: () => Promise.resolve({ data: ROWS, error: null }) }) }
      }
      if (table === 'course_curators') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      if (table === 'telegram_connections') {
        return { select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}))

import { CourseStudentsSection } from '@/components/courseProgram/CourseStudentsSection'

function draw() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<CourseStudentsSection courseId="course-1" />} />
        <Route path="/students/:id" element={<div data-testid="student-page">карточка ученика</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CourseStudentsSection — строка ведёт на карточку ученика', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ссылка на имени указывает на /students/<student_id>?course=<course_id> (не profile_id)', async () => {
    draw()
    const link = await screen.findByTestId('course-student-link')
    expect(link).toHaveAttribute('href', '/students/stud-1?course=course-1')
  })

  it('клик по имени переводит на карточку ученика', async () => {
    draw()
    fireEvent.click(await screen.findByText('Иванов Иван'))
    expect(await screen.findByTestId('student-page')).toBeInTheDocument()
  })

  it('клик по «Действия» (карандаш) не переводит на карточку', async () => {
    draw()
    const renameButton = await screen.findByTitle('Переименовать')
    fireEvent.click(renameButton)

    // Переименование включилось (появилось поле ввода) — кнопка сработала как
    // положено, а не провалилась молча из-за случайной навигации.
    await waitFor(() => expect(screen.getByDisplayValue('Иванов Иван')).toBeInTheDocument())
    expect(screen.queryByTestId('student-page')).not.toBeInTheDocument()
  })

  it('кнопки «Действия» не вложены в ссылку — клик по ним физически не долетает до неё', async () => {
    draw()
    const link = await screen.findByTestId('course-student-link')
    const renameButton = await screen.findByTitle('Переименовать')
    expect(link.contains(renameButton)).toBe(false)
  })
})
