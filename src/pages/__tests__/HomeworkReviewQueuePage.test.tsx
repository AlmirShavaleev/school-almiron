import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { countByTab, rowsOfTab, type QueueRow, type QueueTab } from '@/lib/homeworkQueue'

const state = {
  all: [] as QueueRow[],
  attemptFiles: [] as any[],
  reviews: [] as any[],
  studentNames: {} as Record<string, string>,
  loading: false,
  error: null as string | null,
}
const reviewAttempt = vi.fn()

// Хук отдаёт странице строки ВКЛАДКИ и счётчики по всем состояниям — здесь
// это воспроизводится теми же чистыми функциями, чтобы тест проверял разбор
// по вкладкам, а не мок.
vi.mock('@/hooks/useHomeworkReviewQueue', () => ({
  useHomeworkReviewQueue: (tab: QueueTab = 'submitted') => ({
    rows: rowsOfTab(state.all, tab),
    all: state.all,
    counts: countByTab(state.all),
    attemptFiles: state.attemptFiles,
    reviews: state.reviews,
    studentNames: state.studentNames,
    loading: state.loading,
    error: state.error,
    reload: vi.fn(),
    reviewAttempt,
  }),
}))

// Аннотатор тянет pdfjs — в этом тесте нас интересует только то, ЧТО открылось.
vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', () => ({
  AttemptAnnotationOverlay: ({ title, subtitle, footer }: { title: string; subtitle?: string; footer?: any }) => (
    <div data-testid="attempt-annotation-overlay">
      <span>{title}</span>
      <span>{subtitle}</span>
      {footer?.({ publishing: false, published: false, publishAnnotations: async () => true })}
    </div>
  ),
  splitAnnotatableFiles: (files: any[]) => ({ annotatable: files, other: [] }),
}))

import { HomeworkReviewQueuePage } from '@/pages/HomeworkReviewQueuePage'

function queueRow(over: Partial<QueueRow> = {}, attemptOver: Record<string, unknown> = {}): QueueRow {
  return {
    attempt: {
      id: 'a1', homework_id: 'hw1', student_id: 's1', attempt_number: 1,
      status: 'submitted', submitted_at: '2026-07-28T20:40:00Z',
      created_at: '2026-07-28T20:00:00Z', updated_at: '2026-07-28T20:40:00Z',
      ...attemptOver,
    } as any,
    history: [],
    homeworkId: 'hw1',
    homeworkTitle: 'Домашнее задание',
    gradeScale: 'five',
    dueAt: null,
    topicId: 't1',
    topicTitle: 'Новая тема1',
    courseId: 'c1',
    courseTitle: 'Тестовый курс',
    ...over,
  }
}

/** Клик по строке: обработчик висит на кнопке с именем ученика, не на `<li>`. */
function openRow(studentName = 'Ученик') {
  fireEvent.click(screen.getByText(studentName))
}

describe('HomeworkReviewQueuePage — список только для выбора работы', () => {
  beforeEach(() => {
    state.all = []
    state.attemptFiles = []
    state.reviews = []
    state.studentNames = { s1: 'Ученик' }
    state.loading = false
    state.error = null
    reviewAttempt.mockReset()
  })

  it('в списке нет формы вердикта — ни комментария, ни балла, ни кнопок', () => {
    // Владелец: «зачем вот здесь столько ненужного. Я должен видеть кто сдал
    // ДЗ, когда, просрочил ли он его — то есть только действительно важные
    // моменты, а потом проваливаясь внутрь я уже отмечаю ошибки».
    state.all = [queueRow()]
    render(<HomeworkReviewQueuePage />)

    expect(screen.queryByTestId('review-comment-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-score-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-accept-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-return-button')).not.toBeInTheDocument()
  })

  it('показывает кто сдал, что и когда', () => {
    state.all = [queueRow()]
    render(<HomeworkReviewQueuePage />)

    expect(screen.getByText('Ученик')).toBeInTheDocument()
    expect(screen.getByText('Новая тема1')).toBeInTheDocument()
    // День сдачи вынесен в заголовок группы, в строке остаётся только время.
    expect(screen.getByText(/28 июля 2026/)).toBeInTheDocument()
  })

  it('отмечает просроченную сдачу и выносит счёт в подзаголовок', () => {
    state.all = [queueRow({ dueAt: '2026-07-25T00:00:00Z' })]
    render(<HomeworkReviewQueuePage />)

    expect(screen.getByTestId('queue-late-badge')).toBeInTheDocument()
    expect(screen.getByTestId('queue-attempt-card')).toHaveAttribute('data-late', 'true')
    expect(screen.getByTestId('queue-count')).toHaveTextContent('просрочено: 1')
  })

  it('сданное в срок не помечается просроченным', () => {
    state.all = [queueRow({ dueAt: '2026-08-10T00:00:00Z' })]
    render(<HomeworkReviewQueuePage />)

    expect(screen.queryByTestId('queue-late-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('queue-count')).not.toHaveTextContent('просрочено')
  })

  it('клик по строке открывает разбор этой работы', () => {
    state.all = [queueRow({ dueAt: '2026-07-25T00:00:00Z' })]
    render(<HomeworkReviewQueuePage />)

    expect(screen.queryByTestId('attempt-annotation-overlay')).not.toBeInTheDocument()
    openRow()

    const overlay = screen.getByTestId('attempt-annotation-overlay')
    expect(overlay).toBeInTheDocument()
    // В шапке разбора — работа, от кого, тема, и отметка об опоздании.
    expect(overlay).toHaveTextContent('Домашнее задание')
    expect(overlay).toHaveTextContent('Ученик · Новая тема1 · сдано с опозданием')
  })

  it('повторную попытку помечает номером, первую — нет', () => {
    state.all = [queueRow({}, { attempt_number: 2 })]
    render(<HomeworkReviewQueuePage />)
    expect(screen.getByText('попытка №2')).toBeInTheDocument()
  })
})

/**
 * Вкладки состояний. Повод: страница показывала только ожидающих, и владелец
 * не видел ни того, что вернули на доработку, ни того, что уже принято, —
 * а таких работ на проде большинство.
 */
describe('HomeworkReviewQueuePage — вкладки состояний', () => {
  beforeEach(() => {
    state.all = [
      queueRow({}, { id: 'a1', status: 'submitted' }),
      queueRow({}, { id: 'a2', status: 'returned_for_revision' }),
      queueRow({}, { id: 'a3', status: 'accepted' }),
      queueRow({}, { id: 'a4', status: 'accepted' }),
    ]
    state.attemptFiles = []
    state.reviews = []
    state.studentNames = { s1: 'Ученик' }
    state.loading = false
    state.error = null
    reviewAttempt.mockReset()
  })

  it('у каждой вкладки свой счётчик по всем загруженным работам', () => {
    render(<HomeworkReviewQueuePage />)

    expect(screen.getByTestId('queue-tab-submitted')).toHaveTextContent('Ждут проверки1')
    expect(screen.getByTestId('queue-tab-returned_for_revision')).toHaveTextContent('На доработке1')
    expect(screen.getByTestId('queue-tab-accepted')).toHaveTextContent('Принятые2')
  })

  it('по умолчанию открыта «Ждут проверки» — в списке только ожидающие', () => {
    render(<HomeworkReviewQueuePage />)

    expect(screen.getByTestId('queue-tab-submitted')).toHaveAttribute('aria-selected', 'true')
    const cards = screen.getAllByTestId('queue-attempt-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveAttribute('data-status', 'submitted')
  })

  it('на «Принятых» — только принятые, кнопка «Открыть», без выбора и ИИ', () => {
    render(<HomeworkReviewQueuePage />)
    fireEvent.click(screen.getByTestId('queue-tab-accepted'))

    const cards = screen.getAllByTestId('queue-attempt-card')
    expect(cards).toHaveLength(2)
    expect(cards.every(c => c.getAttribute('data-status') === 'accepted')).toBe(true)

    expect(screen.getAllByRole('button', { name: 'Открыть' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Проверить' })).not.toBeInTheDocument()
    // Ни выбора работ, ни массовой ИИ-проверки: вердикт уже стоит.
    expect(screen.queryByTestId('queue-select')).not.toBeInTheDocument()
    expect(screen.queryByTestId('queue-bulk-bar')).not.toBeInTheDocument()
  })

  it('счётчик в шапке остаётся про ожидающих на любой вкладке', () => {
    render(<HomeworkReviewQueuePage />)
    expect(screen.getByTestId('queue-count')).toHaveTextContent('Ждут проверки: 1')

    fireEvent.click(screen.getByTestId('queue-tab-accepted'))
    expect(screen.getByTestId('queue-count')).toHaveTextContent('Ждут проверки: 1')
  })

  it('на пустой вкладке — свой текст, а не «Очередь пуста»', () => {
    state.all = [queueRow({}, { id: 'a1', status: 'submitted' })]
    render(<HomeworkReviewQueuePage />)

    fireEvent.click(screen.getByTestId('queue-tab-returned_for_revision'))
    expect(screen.getByTestId('queue-empty')).toHaveTextContent('Никого не вернули на доработку')
  })

  it('прошлые попытки — история внутри работы, а не строки вкладок', () => {
    // Цикл «сдал → вернули → пересдал → приняли» даёт две попытки, но работа
    // одна: до §83 она висела и на «На доработке», и на «Принятых».
    const history = [{
      id: 'a0', homework_id: 'hw1', student_id: 's1', attempt_number: 1,
      status: 'returned_for_revision', submitted_at: '2026-07-27T10:00:00Z',
      created_at: '2026-07-27T09:00:00Z', updated_at: '2026-07-27T10:00:00Z',
    }] as any
    state.all = [queueRow({ history }, { id: 'a5', attempt_number: 2, status: 'accepted' })]
    state.reviews = [{
      id: 'r0', attempt_id: 'a0', reviewer_id: 'p1', decision: 'returned_for_revision',
      comment: 'Переделай второй пункт', score: null, created_at: '2026-07-27T12:00:00Z',
    }]
    render(<HomeworkReviewQueuePage />)

    expect(screen.getByTestId('queue-tab-returned_for_revision')).toHaveTextContent('На доработке0')
    expect(screen.getByTestId('queue-tab-accepted')).toHaveTextContent('Принятые1')

    fireEvent.click(screen.getByTestId('queue-tab-returned_for_revision'))
    expect(screen.queryByTestId('queue-attempt-card')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('queue-tab-accepted'))
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))

    const past = screen.getByTestId('queue-attempt-history')
    expect(past).toHaveTextContent('Попытка №1')
    expect(past).toHaveTextContent('На доработке')
    expect(past).toHaveTextContent('Переделай второй пункт')
  })

  it('у пересданной работы прошлый вердикт виден над формой проверки', () => {
    const history = [{
      id: 'a0', homework_id: 'hw1', student_id: 's1', attempt_number: 1,
      status: 'returned_for_revision', submitted_at: '2026-07-27T10:00:00Z',
      created_at: '2026-07-27T09:00:00Z', updated_at: '2026-07-27T10:00:00Z',
    }] as any
    state.all = [queueRow({ history }, { id: 'a6', attempt_number: 2, status: 'submitted' })]
    state.reviews = [{
      id: 'r0', attempt_id: 'a0', reviewer_id: 'p1', decision: 'returned_for_revision',
      comment: 'Переделай второй пункт', score: null, created_at: '2026-07-27T12:00:00Z',
    }]
    render(<HomeworkReviewQueuePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))

    expect(screen.getByTestId('queue-attempt-history')).toHaveTextContent('Переделай второй пункт')
    // Форма вердикта на месте: работа снова ждёт решения.
    expect(screen.getByTestId('review-accept-button')).toBeInTheDocument()
  })

  it('у проверенной работы в разборе вердикт, а не форма', () => {
    // Второй вердикт база не примет (RPC меняет статус только у submitted),
    // поэтому вместо кнопок показываем принятое решение.
    state.reviews = [{
      id: 'r1', attempt_id: 'a3', reviewer_id: 'p1', decision: 'accepted',
      comment: 'Хорошая работа', score: 5, created_at: '2026-07-29T10:00:00Z',
    }]
    render(<HomeworkReviewQueuePage />)
    fireEvent.click(screen.getByTestId('queue-tab-accepted'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть' })[0])

    const verdict = screen.getByTestId('queue-verdict-summary')
    expect(verdict).toHaveTextContent('Принято')
    expect(verdict).toHaveTextContent('Оценка: 5/5')
    expect(verdict).toHaveTextContent('Хорошая работа')
    expect(screen.queryByTestId('review-accept-button')).not.toBeInTheDocument()
  })
})
