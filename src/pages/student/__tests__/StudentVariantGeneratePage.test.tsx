import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'fs'
import { join } from 'path'

const navigateSpy = vi.hoisted(() => vi.fn())
const generateTasksSpy = vi.hoisted(() => vi.fn())
const createSpy = vi.hoisted(() => vi.fn())
const SECTION_FIXTURES = [
  { id: 'sec-1', title: 'Линейные уравнения', subject: 'Математика', exam_type: 'ЕГЭ', external_id: 1, exam_number: 1, position: 1, task_count: 20 },
  { id: 'sec-2', title: 'Геометрия', subject: 'Математика', exam_type: 'ЕГЭ', external_id: 2, exam_number: 2, position: 2, task_count: 20 },
]

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateSpy }
})

vi.mock('@/hooks/useCatalog', () => ({
  SUBJECT_FROM_SLUG: { math: 'Математика', physics: 'Физика' },
  EXAM_FROM_SLUG: { ege: 'ЕГЭ', oge: 'ОГЭ' },
  useCatalogSections: () => ({
    sections: SECTION_FIXTURES,
    loading: false,
    error: null,
  }),
  useCatalogTopics: () => ({
    topics: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useVariants', () => ({
  useVariantBuilder: () => ({
    generateTasks: generateTasksSpy,
    generating: false,
    genError: null,
    setGenError: vi.fn(),
  }),
  useCreateSelfBuiltVariant: () => ({
    create: createSpy,
    saving: false,
    error: null,
  }),
}))

import { StudentVariantGeneratePage } from '@/pages/student/StudentVariantGeneratePage'

describe('StudentVariantGeneratePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigateSpy.mockReset()
    generateTasksSpy.mockResolvedValue([
      {
        task_id: 'task-1',
        section_id: 'sec-1',
        topic_id: '',
        position: 1,
        task: {
          id: 'task-1',
          external_id: 101,
          section_id: 'sec-1',
          subject: 'Математика',
          exam_type: 'ЕГЭ',
          statement_html: '<p>Условие 1</p>',
          answer_html: '1',
          solution_html: null,
          solution_plan_html: null,
          grade_criteria_html: null,
          has_answer: true,
          has_solution: false,
          position: 1,
          assets: [],
          sectionTitle: 'Линейные уравнения',
        },
      },
      {
        task_id: 'task-2',
        section_id: 'sec-2',
        topic_id: '',
        position: 2,
        task: {
          id: 'task-2',
          external_id: 102,
          section_id: 'sec-2',
          subject: 'Математика',
          exam_type: 'ЕГЭ',
          statement_html: '<p>Условие 2</p>',
          answer_html: '2',
          solution_html: null,
          solution_plan_html: null,
          grade_criteria_html: null,
          has_answer: true,
          has_solution: false,
          position: 2,
          assets: [],
          sectionTitle: 'Геометрия',
        },
      },
    ])
    createSpy.mockResolvedValue('student-assignment-1')
  })

  it('generates and immediately creates a student variant', async () => {
    render(
      <MemoryRouter initialEntries={['/student/variants/generate']}>
        <Routes>
          <Route path="/student/variants/generate" element={<StudentVariantGeneratePage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId('variant-section-plus-sec-1'))
    fireEvent.click(screen.getByTestId('variant-section-plus-sec-2'))
    fireEvent.click(screen.getByTestId('variant-constructor-generate'))

    await waitFor(() => expect(generateTasksSpy).toHaveBeenCalledTimes(1))
    expect(generateTasksSpy).toHaveBeenCalledWith(
      [
        { section_id: 'sec-1', cnt: 1, topic_ids: [] },
        { section_id: 'sec-2', cnt: 1, topic_ids: [] },
      ],
      { hydrateTasks: false },
    )

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1))
    expect(createSpy).toHaveBeenCalledWith({
      title: expect.stringContaining('Мой вариант от'),
      subject: 'math',
      examType: 'ege',
      items: [
        { task_id: 'task-1', section_id: 'sec-1', topic_id: null },
        { task_id: 'task-2', section_id: 'sec-2', topic_id: null },
      ],
    })
    expect(navigateSpy).toHaveBeenCalledWith('/student/variants/student-assignment-1')
    expect(screen.queryByText('Предпросмотр')).not.toBeInTheDocument()
  })

  it('student route is protected by student RoleGuard', () => {
    const src = readFileSync(join(process.cwd(), 'src/AppRoutes.tsx'), 'utf8')
    expect(src).toContain('path="/student/variants/generate"')
    const match = src.match(/path="\/student\/variants\/generate"[^>]*RoleGuard\s+allow=\{([^}]+)\}/)
    expect(match).not.toBeNull()
    const allowList = match ? match[1] : ''
    expect(allowList).toContain('student')
    expect(allowList).not.toContain('teacher')
  })
})
