import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TopicHomeworkReview } from '@/components/courseProgram/TopicHomeworkReview'
import { TopicHomeworkStudent } from '@/components/courseProgram/TopicHomeworkStudent'
import {
  groupAttemptsByStudent,
  type TopicHomeworkAttemptFileRow,
  type TopicHomeworkAttemptRow,
  type TopicHomeworkAttemptStatus,
  type TopicHomeworkReviewRow,
} from '@/lib/topicHomework'

const onReview = vi.fn()

const attempt = (
  id: string,
  student: string,
  n: number,
  status: TopicHomeworkAttemptStatus,
): TopicHomeworkAttemptRow => ({
  id, homework_id: 'hw1', student_id: student, attempt_number: n, status,
  submitted_at: status === 'draft' ? null : '2026-07-26T10:00:00Z',
  created_at: '2026-07-26T09:00:00Z', updated_at: '2026-07-26T10:00:00Z',
})

const file = (id: string, attemptId: string, name: string): TopicHomeworkAttemptFileRow => ({
  id, attempt_id: attemptId, storage_path: `${attemptId}/${name}`, file_name: name,
  mime_type: null, size_bytes: null, position: 0, created_at: '',
})

const NAMES = { s1: 'Иванов Пётр', s2: 'Петрова Анна' }

function renderReview(attempts: TopicHomeworkAttemptRow[], opts: {
  files?: TopicHomeworkAttemptFileRow[]
  reviews?: TopicHomeworkReviewRow[]
  gradeScale?: 'five' | 'hundred' | null
} = {}) {
  return render(
    <TopicHomeworkReview
      attempts={attempts}
      attemptFiles={opts.files ?? []}
      reviews={opts.reviews ?? []}
      studentNames={NAMES}
      gradeScale={opts.gradeScale}
      onReview={onReview}
    />,
  )
}

beforeEach(() => {
  onReview.mockReset().mockResolvedValue(undefined)
})

describe('Проверка ДЗ — преподаватель видит отправленные работы', () => {
  it('показывает ученика со статусом «На проверке», номер и дату попытки', () => {
    renderReview([attempt('a1', 's1', 1, 'submitted')])

    expect(screen.getByText('Иванов Пётр')).toBeInTheDocument()
    expect(screen.getByText('На проверке')).toBeInTheDocument()
    expect(screen.getByText(/Попытка №1/)).toBeInTheDocument()
  })

  it('показывает прикреплённые файлы работы', () => {
    renderReview([attempt('a1', 's1', 1, 'submitted')], { files: [file('f1', 'a1', 'scan.jpg')] })
    expect(screen.getByText('scan.jpg')).toBeInTheDocument()
  })

  it('черновые попытки преподавателю не показываются', () => {
    renderReview([attempt('a1', 's1', 1, 'draft')])
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument()
    expect(screen.getByText('Работ пока нет')).toBeInTheDocument()
  })

  it('пустой список — когда RLS ничего не отдал (чужой преподаватель)', () => {
    renderReview([])
    expect(screen.getByText('Работ пока нет')).toBeInTheDocument()
    expect(screen.queryByText('Принять')).not.toBeInTheDocument()
  })
})

describe('Проверка ДЗ — решения', () => {
  it('принимает работу без баллов; комментарий необязателен', async () => {
    renderReview([attempt('a1', 's1', 1, 'submitted')])

    fireEvent.click(screen.getByText('Принять'))
    await waitFor(() => expect(onReview).toHaveBeenCalledWith('a1', 'accepted', '', null))
  })

  it('принимает работу с баллами; балл обязателен если задана шкала', async () => {
    renderReview([attempt('a1', 's1', 1, 'submitted')], { gradeScale: 'five' })

    // Кнопка принять должна быть заблокирована пока балл не введён
    expect(screen.getByText('Принять').closest('button')).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Балл (0–5)'), { target: { value: '4' } })
    fireEvent.click(screen.getByText('Принять'))

    await waitFor(() => expect(onReview).toHaveBeenCalledWith('a1', 'accepted', '', 4))
  })

  it('возвращает на доработку с комментарием', async () => {
    renderReview([attempt('a1', 's1', 1, 'submitted')])

    fireEvent.change(screen.getByLabelText('Комментарий к работе'), {
      target: { value: 'Задача 3 решена неверно' },
    })
    fireEvent.click(screen.getByText('Вернуть на доработку'))

    await waitFor(() =>
      expect(onReview).toHaveBeenCalledWith('a1', 'returned_for_revision', 'Задача 3 решена неверно', null),
    )
  })

  it('возврат без комментария заблокирован', () => {
    renderReview([attempt('a1', 's1', 1, 'submitted')])

    expect(screen.getByText('Вернуть на доработку').closest('button')).toBeDisabled()
    expect(screen.getByText('Для возврата нужен комментарий')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Вернуть на доработку'))
    expect(onReview).not.toHaveBeenCalled()
  })

  it('пробелы за комментарий не считаются', () => {
    renderReview([attempt('a1', 's1', 1, 'submitted')])
    fireEvent.change(screen.getByLabelText('Комментарий к работе'), { target: { value: '   ' } })
    expect(screen.getByText('Вернуть на доработку').closest('button')).toBeDisabled()
  })
})

describe('Проверка ДЗ — статусы разделены', () => {
  it('«На доработке» показывается отдельно и без кнопок решения', () => {
    renderReview([attempt('a1', 's1', 1, 'returned_for_revision')])

    expect(screen.getByText('На доработке')).toBeInTheDocument()
    expect(screen.queryByText('Принять')).not.toBeInTheDocument()
    expect(screen.queryByText('Вернуть на доработку')).not.toBeInTheDocument()
  })

  it('«Принято» показывается отдельно и без кнопок решения', () => {
    renderReview([attempt('a1', 's1', 1, 'accepted')])

    expect(screen.getByText('Принято')).toBeInTheDocument()
    expect(screen.queryByText('Принять')).not.toBeInTheDocument()
  })

  it('ждущие проверки идут первыми в списке', () => {
    const rows = [attempt('a1', 's1', 1, 'accepted'), attempt('a2', 's2', 1, 'submitted')]
    renderReview(rows)

    const names = screen.getAllByText(/Иванов Пётр|Петрова Анна/).map(n => n.textContent)
    expect(names[0]).toBe('Петрова Анна')
    expect(groupAttemptsByStudent(rows)[0].latest.status).toBe('submitted')
  })
})

describe('Проверка ДЗ — история попыток', () => {
  it('прячет предыдущие попытки за раскрывашкой и показывает комментарии', () => {
    const rows = [attempt('a1', 's1', 1, 'returned_for_revision'), attempt('a2', 's1', 2, 'submitted')]
    const reviews: TopicHomeworkReviewRow[] = [{
      id: 'r1', attempt_id: 'a1', reviewer_id: 'teacher',
      decision: 'returned_for_revision', comment: 'Переделайте задачу 3', score: null,
      created_at: '2026-07-26T11:00:00Z',
    }]
    renderReview(rows, { reviews, files: [file('f1', 'a1', 'old.jpg')] })

    expect(screen.queryByText('Переделайте задачу 3')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/Предыдущие попытки \(1\)/))
    expect(screen.getByText('Переделайте задачу 3')).toBeInTheDocument()
    expect(screen.getByText('old.jpg')).toBeInTheDocument()
  })
})

// ─── Ученик не получает интерфейс проверки ────────────────────────────────────

vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework: {
      id: 'hw1', topic_id: 't1', title: 'ДЗ', instructions: null,
      is_published: true, created_by: 'teacher', created_at: '', updated_at: '',
    },
    files: [], attempts: [attempt('a1', 's1', 1, 'submitted')], attemptFiles: [], reviews: [],
    studentNames: NAMES, loading: false, error: null, reload: vi.fn(),
    createHomework: vi.fn(), updateHomework: vi.fn(), uploadHomeworkFile: vi.fn(),
    startAttempt: vi.fn(), uploadAttemptFiles: vi.fn(), removeAttemptFile: vi.fn(),
    submitAttempt: vi.fn(), reviewAttempt: vi.fn(),
  }),
}))

describe('Ученик не получает интерфейс проверки', () => {
  it('на ученической странице нет кнопок решения и чужих имён', () => {
    render(<TopicHomeworkStudent topicId="t1" />)

    expect(screen.queryByText('Принять')).not.toBeInTheDocument()
    expect(screen.queryByText('Вернуть на доработку')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Комментарий к работе')).not.toBeInTheDocument()
    expect(screen.queryByText('Работы учеников')).not.toBeInTheDocument()
    expect(screen.queryByText('Иванов Пётр')).not.toBeInTheDocument()
  })

  it('ученику тот же статус называется «Отправлено», а не «На проверке»', () => {
    render(<TopicHomeworkStudent topicId="t1" />)
    expect(screen.getAllByText('Отправлено').length).toBeGreaterThan(0)
    expect(screen.queryByText('На проверке')).not.toBeInTheDocument()
  })
})
