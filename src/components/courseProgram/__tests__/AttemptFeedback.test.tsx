import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReviewTaskRow, ReviewTaskVerdict } from '@/lib/homeworkReviewTasks'
import type { TopicHomeworkAttemptRow, TopicHomeworkReviewRow } from '@/lib/topicHomework'

/**
 * §239. «Разбор» проверенной попытки у ученика: итог, сообщение учителя,
 * задания с вырезками своих страниц, миниатюры, общие замечания.
 *
 * Данные экрана — опубликованные рамки (`annotation_sets`) и профиль
 * проверяющего; оба читаются через supabase, который здесь подменён.
 */

let annotationRows: unknown[] = []
let profileRows: unknown[] = []
const queried: string[] = []

function chain(table: string) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.then = (f: (v: unknown) => unknown) => {
    queried.push(table)
    const data = table === 'annotation_sets' ? annotationRows : table === 'profiles' ? profileRows : []
    return Promise.resolve({ data, error: null }).then(f)
  }
  return c
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => chain(table) } }))
vi.mock('@/lib/storage', () => ({
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async (_b: string, p: string) => `blob://${p}`,
}))
vi.mock('@/hooks/useSignedPdf', () => ({
  loadSignedPdf: () => Promise.reject(new Error('нет pdf в тесте')),
}))

import { AttemptFeedback, teacherDisplayName, type AttemptFeedbackProps } from '@/components/courseProgram/AttemptFeedback'

const attempt = (status: TopicHomeworkAttemptRow['status']): TopicHomeworkAttemptRow => ({
  id: 'att-2', homework_id: 'hw1', student_id: 'stu', attempt_number: 2, status,
  submitted_at: '2026-09-11T06:30:00Z', created_at: '2026-09-11T06:00:00Z', updated_at: '2026-09-11T10:00:00Z',
})

const review = (over: Partial<TopicHomeworkReviewRow> = {}): TopicHomeworkReviewRow => ({
  id: 'r1', attempt_id: 'att-2', reviewer_id: 'teacher-1', decision: 'returned_for_revision',
  comment: 'Задачи 3 и 7 — ошибка в знаке ускорения.', score: null, created_at: '2026-09-11T10:00:00Z', ...over,
})

const row = (no: string, verdict: ReviewTaskVerdict, student: string, expected: string, note: string | null = null): ReviewTaskRow => ({
  id: `row-${no}`, attempt_id: 'att-2', no, verdict, student_answer: student, expected_answer: expected,
  note, position: Number(no) * 10, updated_by: null, updated_at: '',
})

const ROWS = [
  row('1', 'correct', '4 м/с²', '4 м/с²'),
  row('3', 'wrong', '5 м/с²', '−5 м/с²', 'Знак ускорения при торможении отрицательный'),
  row('7', 'partial', '18 м', '18 м'),
  row('9', 'correct', '2,5 с', '2,5 с'),
]

const FILES = [1, 2].map(n => ({
  id: `f${n}`, attempt_id: 'att-2', storage_path: `att-2/photo-${n}.jpg`, file_name: `IMG_${n}.jpg`,
  mime_type: 'image/jpeg', size_bytes: 1, position: n, created_at: '',
})) as unknown as AttemptFeedbackProps['files']

const PAGES = [
  { file_path: 'att-2/photo-1.jpg', page: 1, data: { objects: [
    { id: 'm1', type: 'region', category: 'error', task: '3', text: 'Задача 3: пересчитай проекцию', rect: { x: 0.1, y: 0.3, w: 0.6, h: 0.08 } },
    { id: 'm2', type: 'region', category: 'praise', text: 'Аккуратное «Дано»', rect: { x: 0.1, y: 0.05, w: 0.4, h: 0.06 } },
  ] } },
  { file_path: 'att-2/photo-2.jpg', page: 1, data: { objects: [
    { id: 'm3', type: 'region', category: 'inaccuracy', text: 'Задача 7: нет графика v(t)', rect: { x: 0.1, y: 0.4, w: 0.6, h: 0.06 } },
  ] } },
]

function renderFeedback(over: Partial<AttemptFeedbackProps> = {}) {
  const props: AttemptFeedbackProps = {
    homework: { title: 'ДЗ', due_at: '2026-10-02', grade_scale: 'five' },
    attempt: attempt('returned_for_revision'),
    review: review(),
    files: FILES,
    rows: ROWS,
    resubmit: { onClick: vi.fn() },
    onOpenPage: vi.fn(),
    today: '2026-09-28',
    ...over,
  }
  render(<AttemptFeedback {...props} />)
  return props
}

beforeEach(() => {
  annotationRows = PAGES
  profileRows = [{ full_name: 'Преображенский Всеволод Аристархович' }]
  queried.length = 0
})

describe('Разбор: вернули на доработку', () => {
  it('итог одной фразой, чипы по заданиям, срок и кнопка пересдачи', async () => {
    const props = renderFeedback()
    expect(screen.getByTestId('feedback-headline')).toHaveTextContent('Исправь 2 задания и пришли заново')
    expect(screen.getAllByTestId('feedback-chip').map(c => c.getAttribute('data-verdict')))
      .toEqual(['correct', 'wrong', 'partial', 'correct'])
    expect(screen.getByTestId('feedback-due')).toHaveTextContent(/Пересдать до .*2 октября/)
    fireEvent.click(screen.getByTestId('hw-resubmit'))
    expect(props.resubmit!.onClick).toHaveBeenCalledTimes(1)
  })

  it('на доработке блока ответов нет: ни своего (§209), ни верного', () => {
    renderFeedback()
    const card = screen.getAllByTestId('feedback-task').find(c => c.getAttribute('data-no') === '3')!
    expect(within(card).getByText('Неверно')).toBeInTheDocument()
    expect(screen.queryByText('Твой ответ')).not.toBeInTheDocument()
    expect(screen.queryByText('Верный ответ')).not.toBeInTheDocument()
    expect(screen.queryByText('после пересдачи')).not.toBeInTheDocument()
    expect(screen.queryByText('5 м/с²')).not.toBeInTheDocument()
    expect(screen.queryByText('−5 м/с²')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feedback-answer-expected')).not.toBeInTheDocument()
  })

  it('раскрытые засчитанные тоже без своего ответа', () => {
    renderFeedback()
    fireEvent.click(within(screen.getByTestId('feedback-correct')).getByRole('button', { name: 'Показать' }))
    expect(screen.queryByText('4 м/с²')).not.toBeInTheDocument()
    expect(screen.queryByText('2,5 с')).not.toBeInTheDocument()
  })

  it('засчитанные — одной свёрнутой строкой', () => {
    renderFeedback()
    const ok = screen.getByTestId('feedback-correct')
    expect(ok).toHaveTextContent('№1 и №9 засчитаны')
    expect(screen.queryAllByTestId('feedback-correct-row')).toHaveLength(0)
    fireEvent.click(within(ok).getByRole('button', { name: 'Показать' }))
    expect(screen.getAllByTestId('feedback-correct-row')).toHaveLength(2)
  })

  it('под заданием — вырезка его рамки; рамка без задания — в общих замечаниях', async () => {
    renderFeedback()
    await waitFor(() => expect(screen.getAllByTestId('feedback-crop')).toHaveLength(2))
    const card3 = screen.getAllByTestId('feedback-task').find(c => c.getAttribute('data-no') === '3')!
    expect(within(card3).getByText('Пересчитай проекцию')).toBeInTheDocument()
    expect(within(card3).getByText('Пометка 1 · стр. 1')).toBeInTheDocument()
    expect(within(card3).getByTestId('feedback-crop')).toBeInTheDocument()
    const general = screen.getAllByTestId('feedback-general-item')
    expect(general).toHaveLength(1)
    expect(general[0]).toHaveTextContent('Аккуратное «Дано»')
    expect(general[0]).toHaveAttribute('data-praise', 'true')
  })

  it('миниатюры страниц вместо файлов-ссылок', async () => {
    renderFeedback()
    await waitFor(() => expect(screen.getAllByTestId('feedback-page-thumb')).toHaveLength(2))
    expect(screen.getByText('Стр. 1 · 2 пометки')).toBeInTheDocument()
    expect(screen.getByText('Стр. 2 · 1 пометка')).toBeInTheDocument()
    expect(screen.queryByText('IMG_1.jpg')).not.toBeInTheDocument()
  })

  it('«Вся страница →» открывает просмотр на странице рамки', async () => {
    const props = renderFeedback()
    const card7 = await waitFor(() => {
      const card = screen.getAllByTestId('feedback-task').find(c => c.getAttribute('data-no') === '7')!
      expect(within(card).getByTestId('feedback-open-page')).toBeInTheDocument()
      return card
    })
    fireEvent.click(within(card7).getByTestId('feedback-open-page'))
    expect(props.onOpenPage).toHaveBeenCalledWith({ page: 2, regionId: 'm3' })
  })

  it('миниатюра открывает свою страницу', async () => {
    const props = renderFeedback()
    const thumbs = await screen.findAllByTestId('feedback-page-thumb')
    fireEvent.click(thumbs[1])
    expect(props.onOpenPage).toHaveBeenCalledWith({ page: 2 })
  })

  it('сообщение учителя подписано «Имя Отчество · учитель»', async () => {
    renderFeedback()
    expect(screen.getByTestId('feedback-message')).toHaveTextContent('Задачи 3 и 7 — ошибка в знаке ускорения.')
    await waitFor(() => expect(screen.getByTestId('feedback-reviewer')).toHaveTextContent('Всеволод Аристархович · учитель'))
  })

  it('имя проверяющего не отдали — подпись «Учитель»', async () => {
    profileRows = []
    renderFeedback()
    await waitFor(() => expect(queried).toContain('profiles'))
    expect(screen.getByTestId('feedback-reviewer')).toHaveTextContent(/^Учитель$/)
  })

  it('срок уже прошёл — строки срока нет', () => {
    renderFeedback({ homework: { title: 'ДЗ', due_at: '2026-09-20', grade_scale: 'five' } })
    expect(screen.queryByTestId('feedback-due')).not.toBeInTheDocument()
  })

  it('срока нет — строки нет', () => {
    renderFeedback({ homework: { title: 'ДЗ', due_at: null, grade_scale: null } })
    expect(screen.queryByTestId('feedback-due')).not.toBeInTheDocument()
  })
})

describe('Разбор: без таблицы и без рамок', () => {
  it('нет таблицы и рамок — только итог и комментарий', async () => {
    annotationRows = []
    renderFeedback({ rows: [] })
    await waitFor(() => expect(queried).toContain('annotation_sets'))
    expect(screen.getByTestId('feedback-headline')).toHaveTextContent('Работа на доработке')
    expect(screen.getByTestId('feedback-message')).toBeInTheDocument()
    expect(screen.queryAllByTestId('feedback-chip')).toHaveLength(0)
    expect(screen.queryAllByTestId('feedback-task')).toHaveLength(0)
    expect(screen.queryAllByTestId('feedback-page-thumb')).toHaveLength(0)
    expect(screen.queryAllByTestId('feedback-general-item')).toHaveLength(0)
  })

  it('нет таблицы, есть рамки — все рамки в общих замечаниях', async () => {
    renderFeedback({ rows: [] })
    await waitFor(() => expect(screen.getAllByTestId('feedback-general-item')).toHaveLength(3))
    expect(screen.queryAllByTestId('feedback-crop')).toHaveLength(0)
  })

  it('таблица есть, рамок нет — ни миниатюр, ни вырезок', async () => {
    annotationRows = []
    renderFeedback()
    await waitFor(() => expect(queried).toContain('annotation_sets'))
    expect(screen.getAllByTestId('feedback-task')).toHaveLength(2)
    expect(screen.queryAllByTestId('feedback-page-thumb')).toHaveLength(0)
    expect(screen.queryAllByTestId('feedback-crop')).toHaveLength(0)
    // Заметка таблицы остаётся текстом.
    expect(screen.getByText('Знак ускорения при торможении отрицательный')).toBeInTheDocument()
  })
})

describe('Разбор: приняли', () => {
  const acceptedProps = (over: Partial<AttemptFeedbackProps> = {}): Partial<AttemptFeedbackProps> => ({
    attempt: attempt('accepted'),
    review: review({ decision: 'accepted', score: 4, comment: 'Молодец.' }),
    resubmit: null,
    ...over,
  })

  it('балл как раньше, верный ответ открыт, кнопки пересдачи нет', () => {
    renderFeedback(acceptedProps())
    expect(screen.getByTestId('feedback-score')).toHaveTextContent('4из 5')
    const card = screen.getAllByTestId('feedback-task').find(c => c.getAttribute('data-no') === '3')!
    expect(within(card).getByTestId('feedback-answer-expected')).toHaveTextContent('−5 м/с²')
    // Свой ответ (прочитанный ИИ) не показывается и после принятия (§209).
    expect(screen.queryByText('Твой ответ')).not.toBeInTheDocument()
    expect(screen.queryByText('5 м/с²')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hw-resubmit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('feedback-due')).not.toBeInTheDocument()
  })

  it('без шкалы балл не показывается — «Работа принята»', () => {
    renderFeedback(acceptedProps({ homework: { title: 'ДЗ', due_at: null, grade_scale: null } }))
    expect(screen.queryByTestId('feedback-score')).not.toBeInTheDocument()
    expect(screen.getByTestId('feedback-headline')).toHaveTextContent('Работа принята')
  })

  it('решение открыто — строка «Авторское решение» ведёт в раздел', () => {
    const onOpen = vi.fn()
    renderFeedback(acceptedProps({ solution: { onOpen } }))
    fireEvent.click(screen.getByTestId('feedback-solution'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('решение не открыто (нет пропа) — строки нет', () => {
    renderFeedback(acceptedProps({ solution: null }))
    expect(screen.queryByTestId('feedback-solution')).not.toBeInTheDocument()
  })

  it('у возвращённой работы строки решения нет, даже если его передали', () => {
    renderFeedback({ solution: { onOpen: vi.fn() } })
    expect(screen.queryByTestId('feedback-solution')).not.toBeInTheDocument()
  })
})

describe('имя учителя', () => {
  it('«Фамилия Имя Отчество» → «Имя Отчество», короткое — как есть', () => {
    expect(teacherDisplayName('Иванова Наталья Сергеевна')).toBe('Наталья Сергеевна')
    expect(teacherDisplayName('Ли Ян')).toBe('Ли Ян')
  })
})
