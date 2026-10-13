import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { countTopics } from '@/lib/studentCourseCounters'
import type { ModuleProgress } from '@/hooks/useStudentCourseProgram'

/**
 * 13.10, владелец: «с аккаунта ученика убрать ссылки на ДЗ в моём курсе».
 * В «урочном» курсе (уроки нового формата) блока «Задания» со счётчиками
 * «Не сдано / На проверке / Проверено / Тестов ждёт» и «Открыть тему» нет —
 * ДЗ внутри уроков. В курсе школьной группы — как было.
 */

const program = vi.hoisted(() => ({ lessonFormat: null as string | null }))

const topic = (id: string) => ({
  id, title: `Урок ${id}`, order_index: 1, max_score: null,
  available_from: null, is_open: true, sections: new Set<string>(),
  hw_id: `hw-${id}`, hw_title: 'ДЗ', hw_instructions: null, hw_due_at: null,
  hw_grade_scale: 'five', hw_status: 'not_started', hw_score: null, hw_max: null, hw_comment: null,
  test_assignment_id: null, test_title: null, test_status: null,
  test_points: null, test_max_points: null,
  completed_count: 0, assignment_count: 1,
  lesson_format: program.lessonFormat,
}) as unknown as ModuleProgress['topics'][number]

vi.mock('@/hooks/useStudentCourseProgram', () => ({
  useStudentCourseProgram: () => {
    const topics = [topic('1'), topic('2')]
    const modules: ModuleProgress[] = [{
      id: 'm1', title: 'Механика', order_index: 1, topics, done: 0, total: 0,
      counters: countTopics(topics.map(() => ({ is_open: true, available_from: null, hasHomework: true, hwStatus: 'not_started' })), '2026-10-13'),
    }]
    return {
      course: { id: 'c1', title: 'Физика ЕГЭ', subject: 'physics', exam_type: 'ege', group_name: 'g', teacher: null, curator: null },
      modules, loading: false, error: null, reload: vi.fn(),
    }
  },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'p1', role: 'student' } }),
}))
// Режим «по прохождению» и темы с lesson_format в базе — не урочный: решает программа.
vi.mock('@/lib/lessonCourses', async (orig) => ({
  ...(await orig<object>()),
  useLessonCourseIds: () => ({ ids: new Set<string>(), ready: true }),
}))

import { StudentCoursePage } from '@/pages/StudentCoursePage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-course/g1']}>
      <Routes>
        <Route path="/my-course/:groupId" element={<StudentCoursePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { program.lessonFormat = null })

describe('блок «Задания» на странице курса', () => {
  it('курс школьной группы — блок со счётчиками и «Открыть тему» на месте', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: /Задания/ })).toBeInTheDocument()
    expect(screen.getByText('Тестов ждёт')).toBeInTheDocument()
    expect(screen.getAllByText('Открыть тему').length).toBeGreaterThan(0)
  })

  it('урочный курс — блока «Задания» нет', async () => {
    program.lessonFormat = 'training'
    renderPage()
    expect(await screen.findAllByTestId('module-card')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: /Задания/ })).toBeNull()
    expect(screen.queryByText('Тестов ждёт')).toBeNull()
    expect(screen.queryByText('Открыть тему')).toBeNull()
  })
})
