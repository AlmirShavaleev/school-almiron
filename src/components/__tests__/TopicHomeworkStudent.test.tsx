import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TopicHomeworkStudent } from '@/components/courseProgram/TopicHomeworkStudent'
import type {
  TopicHomeworkAttemptRow,
  TopicHomeworkAttemptStatus,
  TopicHomeworkFileRow,
  TopicHomeworkReviewRow,
  TopicHomeworkRow,
} from '@/lib/topicHomework'

const startAttempt = vi.fn()
const submitAttempt = vi.fn()
const uploadAttemptFiles = vi.fn()
const removeAttemptFile = vi.fn()

let homework: TopicHomeworkRow | null = null
let files: TopicHomeworkFileRow[] = []
let attempts: TopicHomeworkAttemptRow[] = []
let attemptFiles: any[] = []
let reviews: TopicHomeworkReviewRow[] = []
let loading = false

vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework, files, attempts, attemptFiles, reviews, loading, error: null, reload: vi.fn(),
    createHomework: vi.fn(), updateHomework: vi.fn(), uploadHomeworkFile: vi.fn(),
    startAttempt, uploadAttemptFiles, removeAttemptFile, submitAttempt,
  }),
}))

const TOPIC = 'f0000000-0000-0000-0000-000000000001'

const hw = (): TopicHomeworkRow => ({
  id: 'hw1', topic_id: TOPIC, title: 'ДЗ по кинематике',
  instructions: 'Решите 5 задач', is_published: true, created_by: 'teacher',
  created_at: '', updated_at: '',
})

const attempt = (n: number, status: TopicHomeworkAttemptStatus): TopicHomeworkAttemptRow => ({
  id: 'att-' + n, homework_id: 'hw1', student_id: 'stu', attempt_number: n, status,
  submitted_at: status === 'draft' ? null : '2026-07-26T10:00:00Z',
  created_at: '2026-07-26T09:00:00Z', updated_at: '2026-07-26T10:00:00Z',
})

beforeEach(() => {
  homework = hw()
  files = []
  attempts = []
  attemptFiles = []
  reviews = []
  loading = false
  startAttempt.mockReset().mockResolvedValue('att-new')
  submitAttempt.mockReset().mockResolvedValue(undefined)
  uploadAttemptFiles.mockReset().mockResolvedValue([])
  removeAttemptFile.mockReset().mockResolvedValue(undefined)
})

const renderStudent = () => render(<TopicHomeworkStudent topicId={TOPIC} />)

describe('ДЗ ученику — просмотр', () => {
  it('показывает название и инструкцию', () => {
    renderStudent()
    expect(screen.getByText('ДЗ по кинематике')).toBeInTheDocument()
    expect(screen.getByText('Решите 5 задач')).toBeInTheDocument()
  })

  it('даёт скачать PDF задания', () => {
    files = [{
      id: 'f1', homework_id: 'hw1', storage_path: `${TOPIC}/zadanie.pdf`,
      original_filename: 'zadanie.pdf', mime_type: 'application/pdf',
      size_bytes: 2048, position: 0, created_at: '',
    }]
    renderStudent()
    expect(screen.getByText('zadanie.pdf')).toBeInTheDocument()
    expect(screen.getByText('(2 КБ)')).toBeInTheDocument()
  })

  it('если ДЗ не пришло из БД — блок не рисуется вовсе', () => {
    homework = null
    const { container } = renderStudent()
    expect(container.firstChild).toBeNull()
  })
})

describe('ДЗ ученику — цикл сдачи', () => {
  it('без попыток предлагает загрузить работу', async () => {
    renderStudent()
    fireEvent.click(screen.getByText('Загрузить работу'))
    await waitFor(() => expect(startAttempt).toHaveBeenCalled())
  })

  it('в черновике можно приложить файл и отправить', async () => {
    attempts = [attempt(1, 'draft')]
    attemptFiles = [{ id: 'af1', attempt_id: 'att-1', storage_path: 'att-1/scan.jpg', file_name: 'scan.jpg', mime_type: null, size_bytes: null, position: 0, created_at: '' }]
    renderStudent()

    expect(screen.getAllByText('Черновик').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Отправить на проверку'))
    await waitFor(() => expect(submitAttempt).toHaveBeenCalledWith('att-1'))
  })

  it('пустой черновик отправить нельзя — кнопка заблокирована', () => {
    attempts = [attempt(1, 'draft')]
    renderStudent()
    expect(screen.getByText('Отправить на проверку').closest('button')).toBeDisabled()
  })

  it('пикер принимает несколько файлов сразу (не только один, не только PDF)', () => {
    attempts = [attempt(1, 'draft')]
    renderStudent()
    const input = screen.getByLabelText('Файлы работы') as HTMLInputElement
    expect(input.multiple).toBe(true)
    expect(input.accept).toBe('application/pdf,image/*')
  })

  it('выбор нескольких фото сразу уходит одним вызовом с индикатором загрузки', async () => {
    attempts = [attempt(1, 'draft')]
    let resolveUpload: (v: unknown) => void = () => {}
    uploadAttemptFiles.mockImplementation(
      () => new Promise(resolve => { resolveUpload = resolve }),
    )
    renderStudent()

    const photo1 = new File(['a'], 'photo1.jpg', { type: 'image/jpeg' })
    const photo2 = new File(['b'], 'photo2.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Файлы работы'), { target: { files: [photo1, photo2] } })

    await waitFor(() =>
      expect(uploadAttemptFiles).toHaveBeenCalledWith('att-1', [photo1, photo2], expect.any(Function)),
    )
    // Индикатор загрузки: имя каждого файла + кнопка «Отправить» заблокирована,
    // пока сдача не завершена — иначе можно нажать «Отправить» на середине загрузки.
    expect(screen.getByText('photo1.jpg')).toBeInTheDocument()
    expect(screen.getByText('photo2.jpg')).toBeInTheDocument()
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
    expect(screen.getByText('Отправить на проверку').closest('button')).toBeDisabled()

    resolveUpload([])
    await waitFor(() => expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument())
  })

  it('после отправки показывает «Отправлено» и ждёт проверки', () => {
    attempts = [attempt(1, 'submitted')]
    renderStudent()
    expect(screen.getAllByText('Отправлено').length).toBeGreaterThan(0)
    expect(screen.getByText(/ждёт проверки/)).toBeInTheDocument()
    expect(screen.queryByText('Отправить на проверку')).not.toBeInTheDocument()
  })

  it('после возврата предлагает сдать заново и показывает комментарий', () => {
    attempts = [attempt(1, 'returned_for_revision')]
    reviews = [{
      id: 'r1', attempt_id: 'att-1', reviewer_id: 'teacher',
      decision: 'returned_for_revision', comment: 'Задача 3 решена неверно',
      created_at: '2026-07-26T11:00:00Z',
    }]
    renderStudent()

    expect(screen.getByText('Сдать заново')).toBeInTheDocument()
    expect(screen.getAllByText('На доработке').length).toBeGreaterThan(0)
    expect(screen.getByText('Задача 3 решена неверно')).toBeInTheDocument()
  })

  it('после принятия кнопки новой сдачи нет', () => {
    attempts = [attempt(1, 'returned_for_revision'), attempt(2, 'accepted')]
    renderStudent()

    expect(screen.getAllByText('Принято').length).toBeGreaterThan(0)
    expect(screen.queryByText('Сдать заново')).not.toBeInTheDocument()
    expect(screen.queryByText('Загрузить работу')).not.toBeInTheDocument()
  })

  it('пока есть незавершённая попытка, второй сдачи не предлагает', () => {
    attempts = [attempt(1, 'submitted')]
    renderStudent()
    expect(screen.queryByText('Сдать заново')).not.toBeInTheDocument()
  })
})

describe('ДЗ ученику — история попыток', () => {
  it('показывает все попытки от новой к старой', () => {
    attempts = [attempt(1, 'returned_for_revision'), attempt(2, 'accepted')]
    renderStudent()

    const items = screen.getAllByText(/Попытка №\d/).map(el => el.textContent)
    expect(items[0]).toBe('Попытка №2')
    expect(items[items.length - 1]).toBe('Попытка №1')
  })

  it('история не теряется после пересдачи', () => {
    attempts = [attempt(1, 'returned_for_revision'), attempt(2, 'draft')]
    renderStudent()
    expect(screen.getByText('История попыток')).toBeInTheDocument()
    expect(screen.getAllByText(/Попытка №1/).length).toBeGreaterThan(0)
  })
})
