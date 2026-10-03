import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §263. Флажки выдачи «после сдачи показать ответы / разбор» работают: если
 * учитель их снял, сервер не отдаёт эталон и разбор (get_variant_items_for_student
 * — null), а страница говорит, почему, прячет столбец «Правильный ответ» и
 * берёт вердикт и балл у сервера (points_earned). Флажки включены — как раньше.
 */
const flags = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/lib/safeRpc', () => ({ safeRpc: vi.fn(async () => ({ data: flags.value, error: null })) }))
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/${p}` } }), createSignedUrl: vi.fn() }) } },
}))

const assignment = {
  id: 'assign-1', status: 'completed', started_at: '2026-07-13T09:00:00Z', submitted_at: '2026-07-13T10:00:00Z',
  completed_at: '2026-07-13T10:00:00Z', available_from: null, due_at: null, score: 1, max_score: 2, percentage: 50,
  grading_status: 'graded', answered_count: 2, correct_count: 1, manual_review_count: 0, teacher_name: 'Учитель',
  variant: { id: 'v1', title: 'Вариант учителя', description: null, subject: 'physics', exam_type: 'ege', tasks_count: 2, source_type: 'manual' },
  assignment: null,
}
vi.mock('@/hooks/useVariantAssignments', () => ({
  useStudentVariantAssignmentDetail: () => ({ assignment, items: [], loading: false, error: null }),
}))

const item = (n: number, answer: string | null, solution: string | null) => ({
  item_id: `item-${n}`, variant_id: 'v1', task_id: `task-${n}`, item_position: n, points: 1, max_points: 1, grading_type: 'auto',
  task_ext_id: answer === null ? null : 100 + n, subject: 'Физика', exam_type: 'ЕГЭ', partial_type: null,
  statement_html: `<p>Задача ${n}</p>`, has_answer: true, has_solution: true, exam_part: 1, source_type: 'manual',
  solution_html: solution, solution_plan_html: null, grade_criteria_html: null, answer_html: answer, assets: [],
})
const attempt = vi.hoisted(() => ({ state: null as unknown }))
vi.mock('@/hooks/useVariantAttempt', () => ({ useVariantAttempt: () => attempt.state }))

import { StudentVariantDetailPage } from '@/pages/student/StudentVariantDetailPage'

function setAttempt(items: unknown[]) {
  attempt.state = {
    items, answers: { 'item-1': '5', 'item-2': '9' }, saveStates: {}, attachments: {},
    attempt: { status: 'completed', submitted_at: '2026-07-13T10:00:00Z', completed_at: '2026-07-13T10:00:00Z', started_at: '2026-07-13T09:00:00Z', answered_count: 2, correct_count: 1, score: 1, max_score: 2, percentage: 50, grading_status: 'graded', manual_review_count: 0 },
    loading: false, error: null, startAttempt: vi.fn(), setAnswer: vi.fn(), addAttachment: vi.fn(), removeAttachment: vi.fn(),
    submitVariant: vi.fn(), submitting: false, submitError: null,
    // Сервер оценил: первая верна, вторая нет.
    gradedAnswers: {
      'item-1': { points_earned: 1, points_max: 1, teacher_comment: null, grading_status: 'auto' },
      'item-2': { points_earned: 0, points_max: 1, teacher_comment: null, grading_status: 'auto' },
    },
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/student/variants/assign-1']}>
      <Routes><Route path="/student/variants/:assignmentId" element={<StudentVariantDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('Вариант после сдачи: флажки учителя (§263)', () => {
  beforeEach(() => { flags.value = null })

  it('флажки сняты: эталона и разбора нет, столбца «Правильный ответ» нет, вердикт — по баллам сервера, объяснение', async () => {
    flags.value = { show_answers: false, show_solutions: false, work_mode: false }
    setAttempt([item(1, null, null), item(2, null, null)])
    renderPage()
    expect(await screen.findByTestId('variant-answers-hidden')).toHaveTextContent('Учитель не показывает правильные ответы и разбор')
    expect(screen.queryByText('Правильный ответ')).not.toBeInTheDocument()
    expect(screen.queryByText(/Правильный ответ:/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('result-task-reveal-item-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('auto-answer-cell-item-1')).toHaveTextContent('5')
    expect(screen.getByTestId('auto-answer-badge-item-1')).toHaveTextContent('Верно')
    expect(screen.getByTestId('auto-answer-badge-item-2')).toHaveTextContent('Неверно')
  })

  it('только ответы: эталон и вердикт есть, разбора нет, объяснение про разбор', async () => {
    flags.value = { show_answers: true, show_solutions: false, work_mode: false }
    setAttempt([item(1, '<p>5</p>', null), item(2, '<p>7</p>', null)])
    renderPage()
    expect(await screen.findByTestId('variant-answers-hidden')).toHaveTextContent('не показывает разбор')
    expect(screen.getByText('Правильный ответ')).toBeInTheDocument()
    expect(screen.getByTestId('auto-answer-badge-item-2')).toHaveTextContent('Неверно')
    expect(screen.queryByTestId('result-task-reveal-item-1')).not.toBeInTheDocument()
  })

  it('флажки включены (и нет функции) — как раньше: эталон, решение, без объяснения', async () => {
    flags.value = null
    setAttempt([item(1, '<p>5</p>', '<p>Решение 1</p>'), item(2, '<p>7</p>', '<p>Решение 2</p>')])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('result-task-reveal-item-1')).toBeInTheDocument())
    expect(screen.queryByTestId('variant-answers-hidden')).not.toBeInTheDocument()
    expect(screen.getByText('Правильный ответ')).toBeInTheDocument()
    expect(screen.getAllByText(/Правильный ответ:/)).toHaveLength(2)
  })

  it('идёт проверочная — ответы закрыты до её конца, сказано почему', async () => {
    flags.value = { show_answers: true, show_solutions: true, work_mode: true }
    setAttempt([item(1, null, null), item(2, null, null)])
    renderPage()
    expect(await screen.findByTestId('variant-answers-hidden')).toHaveTextContent('идёт проверочная работа')
    expect(screen.queryByText('Правильный ответ')).not.toBeInTheDocument()
  })
})
