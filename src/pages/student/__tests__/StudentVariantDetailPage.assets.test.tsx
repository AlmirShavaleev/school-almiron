import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
        createSignedUrl: vi.fn(),
      }),
    },
  },
}))

vi.mock('@/hooks/useVariantAssignments', () => ({
  useStudentVariantAssignmentDetail: () => ({
    assignment: {
      id: 'assign-1',
      status: 'completed',
      started_at: '2026-07-13T09:00:00Z',
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: '2026-07-13T10:00:00Z',
      available_from: null,
      due_at: null,
      score: 0,
      max_score: 2,
      percentage: 0,
      grading_status: 'graded',
      answered_count: 1,
      correct_count: 0,
      manual_review_count: 0,
      variant: {
        id: 'variant-1',
        title: 'Мой вариант',
        description: null,
        subject: 'math',
        exam_type: 'ege',
        tasks_count: 1,
        source_type: 'student_self_built',
      },
      assignment: null,
    },
    items: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useVariantAttempt', () => ({
  useVariantAttempt: () => ({
    items: [{
      item_id: 'item-1',
      variant_id: 'variant-1',
      task_id: 'task-1',
      item_position: 1,
      points: 2,
      grading_type: 'manual',
      task_ext_id: 7,
      section_id: 'sec-1',
      subject: 'Математика',
      exam_type: 'ЕГЭ',
      statement_html: '<p><img src="DI_703.png" alt="PIC"></p>',
      has_answer: false,
      has_solution: true,
      exam_part: 2,
      source_type: 'student_self_built',
      solution_html: '<p><img src="sol.png" alt="PIC"></p>',
      solution_plan_html: null,
      grade_criteria_html: null,
      answer_html: null,
      assets: [
        { id: 'a1', tex_session_id: null, kind: 'condition', storage_path: 'math-ege/1861/DI_703.png', alt: 'PIC', position: 1 },
        { id: 'a2', tex_session_id: null, kind: 'solution', storage_path: 'math-ege/1861/sol.png', alt: 'PIC', position: 2 },
      ],
    }],
    answers: { 'item-1': '42' },
    saveStates: {},
    attachments: {},
    attempt: {
      status: 'completed',
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: '2026-07-13T10:00:00Z',
      started_at: '2026-07-13T09:00:00Z',
      answered_count: 1,
      correct_count: 0,
      score: 0,
      max_score: 2,
      percentage: 0,
      grading_status: 'graded',
      manual_review_count: 0,
    },
    loading: false,
    error: null,
    startAttempt: vi.fn(),
    setAnswer: vi.fn(),
    addAttachment: vi.fn(),
    removeAttachment: vi.fn(),
    submitVariant: vi.fn(),
    submitting: false,
    submitError: null,
    gradedAnswers: {},
  }),
}))

import { StudentVariantDetailPage } from '@/pages/student/StudentVariantDetailPage'

describe('StudentVariantDetailPage asset rendering', () => {
  it('renders statement and self-check solution images via resolved asset URLs', () => {
    render(
      <MemoryRouter initialEntries={['/student/variants/assign-1']}>
        <Routes>
          <Route path="/student/variants/:assignmentId" element={<StudentVariantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const imgsBefore = screen.getAllByRole('img') as HTMLImageElement[]
    expect(imgsBefore[0].src).toContain('https://cdn.test/math-ege/1861/DI_703.png')

    fireEvent.click(screen.getByText('Показать решение и критерии'))

    const imgsAfter = screen.getAllByRole('img') as HTMLImageElement[]
    expect(imgsAfter[1].src).toContain('https://cdn.test/math-ege/1861/sol.png')
  })
})
