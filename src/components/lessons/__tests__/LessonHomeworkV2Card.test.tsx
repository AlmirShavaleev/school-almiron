import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LessonHomeworkV2Card } from '@/components/lessons/LessonHomeworkV2Card'
import type { CatalogTask } from '@/hooks/useCatalog'

let templateRows: Array<{ id: string; title: string; lesson_id: string | null; created_at: string }> = []
let versionRows: Array<{ id: string; version: number }> = []
let itemRows: any[] = []
const updateMock = vi.fn()
const catalogTask: CatalogTask = {
  id: 'task-1',
  external_id: 101,
  section_id: 'sec-1',
  subject: 'Математика',
  exam_type: 'ЕГЭ',
  difficulty: null,
  statement_html: '<p>Task</p>',
  answer_html: null,
  solution_html: null,
  solution_plan_html: null,
  grade_criteria_html: null,
  has_answer: false,
  has_solution: false,
  position: 1,
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'homework_templates') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: templateRows, error: null }),
              }),
            }),
          }),
          update: (...args: unknown[]) => {
            updateMock(...args)
            return {
              eq: () => Promise.resolve({ data: null, error: null }),
            }
          },
        }
      }
      if (table === 'homework_template_versions') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: versionRows, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'homework_template_items') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: itemRows, error: null }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }
    },
  },
}))

const saveMock = vi.fn()
vi.mock('@/hooks/useHomeworkTemplateBuilder', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useHomeworkTemplateBuilder')>('@/hooks/useHomeworkTemplateBuilder')
  return {
    ...actual,
    useHomeworkTemplateBuilder: () => {
      const real = actual.useHomeworkTemplateBuilder()
      return {
        ...real,
        save: async (input: any) => {
          const result = await saveMock(input)
          real.clear()
          return result
        },
      }
    },
  }
})

vi.mock('@/components/modals/HomeworkCatalogTaskPicker', () => ({
  HomeworkCatalogTaskPicker: ({ onAdd }: { onAdd: (task: CatalogTask) => void }) => (
    <button type="button" onClick={() => onAdd(catalogTask)}>
      mock-add-task
    </button>
  ),
}))

describe('LessonHomeworkV2Card', () => {
  beforeEach(() => {
    templateRows = []
    versionRows = []
    itemRows = []
    updateMock.mockReset()
    saveMock.mockReset()
    saveMock.mockImplementation(async () => {
      templateRows = [{ id: 'tmpl-1', title: 'ДЗ по уроку', lesson_id: 'lesson-1', created_at: '2026-07-24T10:00:00Z' }]
      versionRows = [{ id: 'ver-1', version: 1 }]
      itemRows = [{
        catalog_task_id: 'task-1',
        custom_number: null,
        max_score: null,
        grading_mode: 'manual',
        grading_spec: {},
        ai_check_enabled: false,
        catalog_tasks: catalogTask,
      }]
      return { template_id: 'tmpl-1', template_version_id: 'ver-1', version: 1 }
    })
  })

  it('создаёт lesson-level Homework V2 из каталога и показывает карточку внутри урока', async () => {
    render(
      <LessonHomeworkV2Card
        lessonId="lesson-1"
        courseId="course-1"
        topicId="topic-1"
        topicTitle="Тема 1"
        canEdit
      />,
    )

    await waitFor(() => expect(screen.getByText('Домашнее задание пока не добавлено')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Создать ДЗ'))
    fireEvent.click(screen.getByRole('button', { name: /Из каталога/i }))
    fireEvent.click(screen.getByRole('button', { name: 'mock-add-task' }))
    fireEvent.change(screen.getByDisplayValue('Домашняя работа: Тема 1'), { target: { value: 'ДЗ по уроку' } })
    fireEvent.click(screen.getByRole('button', { name: /Сохранить ДЗ/i }))

    await waitFor(() => expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
      templateId: null,
      courseId: 'course-1',
      topicId: 'topic-1',
      title: 'ДЗ по уроку',
    })))
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ lesson_id: 'lesson-1' }))
    await waitFor(() => expect(screen.getByText('ДЗ по уроку')).toBeInTheDocument())
    expect(screen.getByText('1 задач')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Открыть/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Редактировать/i })).toBeInTheDocument()
  })
})
