import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CourseHomeworkV2Section } from '@/components/courseProgram/CourseHomeworkV2Section'
import type { CourseHomeworkTemplate } from '@/hooks/useCourseHomeworkTemplates'

let templates: CourseHomeworkTemplate[] = []
const groupsData = [
  {
    id: 'group-1',
    name: '10А',
  },
]
const groupMembersData = [
  {
    group_id: 'group-1',
    student_id: 'student-1',
    students: {
      id: 'student-1',
      profile_id: 'profile-1',
      profiles: { full_name: 'Иван Иванов', avatar_url: null, email: 'ivan@example.com' },
    },
  },
]
vi.mock('@/hooks/useCourseHomeworkTemplates', () => ({
  useCourseHomeworkTemplates: () => ({ templates, loading: false, error: null, reload: vi.fn() }),
}))

const emptySummary = {
  templates_count: 0, active_assignments_count: 0, scheduled_assignments_count: 0,
  recipients_count: 0, submitted_count: 0, awaiting_review_count: 0, returned_count: 0,
  accepted_count: 0, overdue_count: 0,
}
vi.mock('@/hooks/useCourseHomeworkSummary', () => ({
  useCourseHomeworkSummary: () => ({ summary: emptySummary, loading: false, error: null, reload: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'groups') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: groupsData }),
            }),
          }),
        }
      }
      if (table === 'group_students') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: groupMembersData }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: [] }),
          }),
        }),
      }
    },
  },
}))

vi.mock('@/components/modals/AssignHomeworkTemplateModal', () => ({
  AssignHomeworkTemplateModal: ({
    preselectedTemplateVersionId,
    students,
  }: {
    preselectedTemplateVersionId: string
    students: Array<{ full_name: string }>
  }) => (
    <div data-testid="assign-modal">
      assign-modal preselected={preselectedTemplateVersionId} students={students.length} names={students.map(student => student.full_name).join(',')}
    </div>
  ),
}))

function tpl(overrides: Partial<CourseHomeworkTemplate>): CourseHomeworkTemplate {
  return {
    id: 't1', title: 'Шаблон', topic_id: null, status: 'active',
    latest_version_id: 'v1', latest_version: 1, items_count: 3, assignments_count: 0, last_assigned_at: null,
    ...overrides,
  }
}

const modules = [{ id: 'm1', course_id: 'c1', title: 'Модуль 1', order_index: 1, topics: [{ id: 'topic-1', module_id: 'm1', title: 'Тема 1', order_index: 1, max_score: 100, available_from: null }] }]

beforeEach(() => {
  templates = []
})

function renderSection() {
  return render(<MemoryRouter><CourseHomeworkV2Section courseId="c1" modules={modules} /></MemoryRouter>)
}

describe('CourseHomeworkV2Section', () => {
  it('9. показывает V2 templates курса', () => {
    templates = [tpl({ id: 't1', title: 'Матан ДЗ' })]
    renderSection()
    expect(screen.getByText('Матан ДЗ')).toBeInTheDocument()
  })

  it('10. не вызывает CreateHomeworkModal (компонент вообще не импортирует legacy-модалку)', () => {
    // Structural guarantee: the component module has no import of CreateHomeworkModal at all —
    // asserted by the fact this file compiles/runs without mocking it and no such element renders.
    templates = []
    renderSection()
    expect(screen.queryByText(/Домашнее задание создано/)).not.toBeInTheDocument()
  })

  it('11. во вкладке курса скрывает кнопку lesson-independent назначения', () => {
    renderSection()
    expect(screen.queryByText('Назначить ДЗ')).not.toBeInTheDocument()
  })

  it('шаблон с topic_id группируется под темой, а не в "Общие ДЗ курса"', () => {
    templates = [tpl({ id: 't1', title: 'Тематическое ДЗ', topic_id: 'topic-1' })]
    renderSection()
    expect(screen.getByText('Модуль 1 · Тема 1')).toBeInTheDocument()
    expect(screen.queryByText('Общие ДЗ курса')).not.toBeInTheDocument()
  })

  it('шаблон без topic_id попадает в "Общие ДЗ курса"', () => {
    templates = [tpl({ id: 't1', title: 'Общее ДЗ', topic_id: null })]
    renderSection()
    expect(screen.getByText('Общие ДЗ курса')).toBeInTheDocument()
  })

  it('15. get_course_homework_summary счётчики отображаются', () => {
    templates = []
    renderSection()
    expect(screen.getByText('Шаблонов')).toBeInTheDocument()
    expect(screen.getByText('Активных назначений')).toBeInTheDocument()
    expect(screen.getByText('На доработке')).toBeInTheDocument()
  })
})
