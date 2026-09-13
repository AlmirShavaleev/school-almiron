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
const reorderAttemptFiles = vi.fn()

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
    startAttempt, uploadAttemptFiles, removeAttemptFile, reorderAttemptFiles, submitAttempt,
  }),
}))

const TOPIC = 'f0000000-0000-0000-0000-000000000001'

const hw = (): TopicHomeworkRow => ({
  id: 'hw1', topic_id: TOPIC, title: 'ДЗ по кинематике',
  instructions: 'Решите 5 задач', is_published: true, created_by: 'teacher',
  due_at: null, grade_scale: null,
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
  reorderAttemptFiles.mockReset().mockResolvedValue(undefined)
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
      score: null,
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

describe('ДЗ ученику — способы приложить работу', () => {
  beforeEach(() => {
    attempts = [attempt(1, 'draft')]
  })

  it('показывает зону перетаскивания и подсказку про Ctrl+V', () => {
    // Владелец: «модалка загрузки ДЗ у ученика очень неудобно сделана».
    // Скриншот уже лежит в буфере — сохранять его файлом ради загрузки лишнее.
    renderStudent()
    expect(screen.getByTestId('hw-dropzone')).toBeInTheDocument()
    expect(screen.getByText(/Ctrl\+V/)).toBeInTheDocument()
  })

  it('принимает файлы перетаскиванием', async () => {
    renderStudent()
    const photo = new File(['x'], 'фото.png', { type: 'image/png' })

    fireEvent.drop(screen.getByTestId('hw-dropzone'), { dataTransfer: { files: [photo] } })

    await waitFor(() =>
      expect(uploadAttemptFiles).toHaveBeenCalledWith('att-1', [photo], expect.any(Function)))
  })

  it('принимает скриншот из буфера и даёт ему понятное имя', async () => {
    renderStudent()
    const shot = new File(['x'], 'image.png', { type: 'image/png' })

    fireEvent.paste(document, { clipboardData: { files: [shot] } })

    await waitFor(() => expect(uploadAttemptFiles).toHaveBeenCalled())
    const sent = uploadAttemptFiles.mock.calls[0][1] as File[]
    expect(sent[0].name).toBe('Снимок экрана 1.png')
  })

  it('неподходящий файл отклоняет с понятным сообщением и не грузит', async () => {
    renderStudent()

    fireEvent.drop(screen.getByTestId('hw-dropzone'), {
      dataTransfer: { files: [new File(['x'], 'архив.zip', { type: 'application/zip' })] },
    })

    expect(await screen.findByText(/Можно приложить только PDF и картинки/)).toBeInTheDocument()
    expect(uploadAttemptFiles).not.toHaveBeenCalled()
  })

  it('вставку в поле ввода не перехватывает — там печатают текст', () => {
    renderStudent()
    const field = document.createElement('textarea')
    document.body.appendChild(field)

    fireEvent.paste(field, {
      clipboardData: { files: [new File(['x'], 'image.png', { type: 'image/png' })] },
    })

    expect(uploadAttemptFiles).not.toHaveBeenCalled()
    field.remove()
  })
})

/**
 * Порядок страниц (§113).
 *
 * До этой правки под кнопкой отправки было написано «порядок можно менять
 * перетаскиванием», а обработчиков перетаскивания не существовало ни одного.
 * Тесты держат оба способа и, главное, номера страниц: они и есть
 * подтверждение, что перестановка случилась.
 */
describe('ДЗ ученику — порядок страниц', () => {
  const page = (n: number) => ({
    id: `af${n}`, attempt_id: 'att-1', storage_path: `att-1/page-${n}.jpg`,
    file_name: `page-${n}.jpg`, mime_type: 'image/jpeg', size_bytes: 10,
    position: n - 1, created_at: '',
  })

  beforeEach(() => {
    attempts = [attempt(1, 'draft')]
    attemptFiles = [page(1), page(2), page(3)]
  })

  /** Прямоугольники в jsdom нулевые — расставляем плитки в ряд руками. */
  function layOutThumbs() {
    for (const el of screen.getAllByTestId('hw-page-thumb')) {
      const index = Number((el as HTMLElement).dataset.pageIndex)
      ;(el as HTMLElement).getBoundingClientRect = () => ({
        left: index * 100, right: index * 100 + 80, top: 0, bottom: 112,
        width: 80, height: 112, x: index * 100, y: 0, toJSON: () => ({}),
      }) as DOMRect
    }
  }

  it('стрелки — настоящие кнопки с понятной подписью', () => {
    renderStudent()

    expect(screen.getByLabelText('Сдвинуть страницу 2 влево').tagName).toBe('BUTTON')
    expect(screen.getByLabelText('Сдвинуть страницу 2 вправо').tagName).toBe('BUTTON')
    // У крайних двигать некуда — кнопка есть, но заблокирована.
    expect(screen.getByLabelText('Сдвинуть страницу 1 влево')).toBeDisabled()
    expect(screen.getByLabelText('Сдвинуть страницу 3 вправо')).toBeDisabled()
  })

  it('стрелка влево переставляет страницу и отдаёт новый порядок', async () => {
    renderStudent()

    fireEvent.click(screen.getByLabelText('Сдвинуть страницу 2 влево'))

    await waitFor(() => expect(reorderAttemptFiles).toHaveBeenCalledWith('att-1', ['af2', 'af1', 'af3']))
  })

  it('стрелка вправо двигает в другую сторону', async () => {
    renderStudent()

    fireEvent.click(screen.getByLabelText('Сдвинуть страницу 1 вправо'))

    await waitFor(() => expect(reorderAttemptFiles).toHaveBeenCalledWith('att-1', ['af2', 'af1', 'af3']))
  })

  it('перетаскивание пальцем за ручку меняет порядок и номера сразу', async () => {
    renderStudent()
    layOutThumbs()

    const handles = screen.getAllByTestId('hw-page-handle')
    // Тянем третью страницу на место первой.
    fireEvent.pointerDown(handles[2], { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 50 })
    fireEvent.pointerMove(screen.getAllByTestId('hw-page-thumb')[2], {
      pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 50,
    })

    // Ещё до отпускания видно будущий порядок: страницы переставлены, а
    // номера пересчитаны по новому месту — это и есть подтверждение.
    const thumbs = screen.getAllByTestId('hw-page-thumb') as HTMLElement[]
    expect(thumbs.map(el => el.dataset.fileId)).toEqual(['af3', 'af1', 'af2'])
    expect(thumbs.map(el => el.dataset.pageNumber)).toEqual(['1', '2', '3'])

    fireEvent.pointerUp(screen.getAllByTestId('hw-page-thumb')[0], {
      pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 50,
    })

    await waitFor(() => expect(reorderAttemptFiles).toHaveBeenCalledWith('att-1', ['af3', 'af1', 'af2']))
  })

  it('мышью тянется вся плитка, а не только ручка', async () => {
    renderStudent()
    layOutThumbs()

    const thumbs = screen.getAllByTestId('hw-page-thumb')
    fireEvent.pointerDown(thumbs[0], { pointerId: 2, pointerType: 'mouse', clientX: 10, clientY: 50 })
    fireEvent.pointerMove(thumbs[0], { pointerId: 2, pointerType: 'mouse', clientX: 210, clientY: 50 })
    fireEvent.pointerUp(thumbs[0], { pointerId: 2, pointerType: 'mouse', clientX: 210, clientY: 50 })

    await waitFor(() => expect(reorderAttemptFiles).toHaveBeenCalledWith('att-1', ['af2', 'af3', 'af1']))
  })

  it('касание плитки мимо ручки прокрутку не отнимает — перетаскивание не начинается', () => {
    renderStudent()
    layOutThumbs()

    const thumbs = screen.getAllByTestId('hw-page-thumb')
    fireEvent.pointerDown(thumbs[0], { pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 50 })
    fireEvent.pointerMove(thumbs[0], { pointerId: 3, pointerType: 'touch', clientX: 210, clientY: 50 })
    fireEvent.pointerUp(thumbs[0], { pointerId: 3, pointerType: 'touch', clientX: 210, clientY: 50 })

    expect(reorderAttemptFiles).not.toHaveBeenCalled()
  })

  it('крестик удаления перетаскивание не запускает', () => {
    renderStudent()
    layOutThumbs()

    fireEvent.pointerDown(screen.getByLabelText('Убрать страницу 1'), {
      pointerId: 4, pointerType: 'mouse', clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(screen.getAllByTestId('hw-page-thumb')[0], {
      pointerId: 4, pointerType: 'mouse', clientX: 210, clientY: 50,
    })
    fireEvent.pointerUp(screen.getAllByTestId('hw-page-thumb')[0], {
      pointerId: 4, pointerType: 'mouse', clientX: 210, clientY: 50,
    })

    expect(reorderAttemptFiles).not.toHaveBeenCalled()
  })

  it('ошибку записи показывает человеку, а не откатывает молча', async () => {
    reorderAttemptFiles.mockRejectedValue(new Error('Не удалось сохранить порядок страниц'))
    renderStudent()

    fireEvent.click(screen.getByLabelText('Сдвинуть страницу 2 влево'))

    expect(await screen.findByText('Не удалось сохранить порядок страниц')).toBeInTheDocument()
  })

  it('подпись обещает ровно то, что экран умеет', () => {
    renderStudent()
    expect(screen.getByText(/порядок меняется стрелками ← → или перетаскиванием/)).toBeInTheDocument()
  })

  it('на одной странице переставлять нечего — обещания нет', () => {
    attemptFiles = [page(1)]
    renderStudent()
    expect(screen.queryByText(/порядок меняется/)).not.toBeInTheDocument()
  })
})

/**
 * §159. Мобильный пакет 2: сдача ДЗ с телефона.
 *
 * «Телефон» определяется по вводу (`pointer: coarse`), не по ширине окна —
 * jsdom по умолчанию отдаёт `matches: false` для любого `matchMedia`, и это
 * ровно то, на чём держались все тесты выше: они ничего не мокали и остались
 * зелёными без единой правки — coarse-ветка для них просто не существует.
 */
function mockCoarsePointer(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches,
    media: '(pointer: coarse)',
    addEventListener: (_: string, fn: any) => listeners.add(fn),
    removeEventListener: (_: string, fn: any) => listeners.delete(fn),
    addListener: (fn: any) => listeners.add(fn),
    removeListener: (fn: any) => listeners.delete(fn),
    dispatchEvent: () => true,
    onchange: null,
  }
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql))
  return mql
}

describe('ДЗ ученику — мобильный экран (§159)', () => {
  const page = (n: number) => ({
    id: `af${n}`, attempt_id: 'att-1', storage_path: `att-1/page-${n}.jpg`,
    file_name: `page-${n}.jpg`, mime_type: 'image/jpeg', size_bytes: 10,
    position: n - 1, created_at: '',
  })

  beforeEach(() => {
    attempts = [attempt(1, 'draft')]
    mockCoarsePointer(true)
  })

  it('вместо дропзоны — две кнопки, обещаний про перетаскивание и Ctrl+V нет', () => {
    renderStudent()
    expect(screen.getByTestId('hw-camera-button')).toBeInTheDocument()
    expect(screen.getByTestId('hw-gallery-button')).toBeInTheDocument()
    expect(screen.queryByTestId('hw-dropzone')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ctrl\+V/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Перетащите/)).not.toBeInTheDocument()
  })

  it('кнопка «Снять фото» — прямой вход в камеру устройства', () => {
    renderStudent()
    const input = screen.getByLabelText('Снять фото страницы') as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.accept).toBe('image/*')
    expect(input.getAttribute('capture')).toBe('environment')
  })

  it('на десктопе (fine pointer) кнопок камеры нет — дропзона как раньше', () => {
    mockCoarsePointer(false)
    renderStudent()
    expect(screen.queryByTestId('hw-camera-button')).not.toBeInTheDocument()
    expect(screen.getByTestId('hw-dropzone')).toBeInTheDocument()
  })

  it('ручка перетаскивания скрыта, стрелки — 44px, подпись без «перетаскиванием»', () => {
    attemptFiles = [page(1), page(2)]
    renderStudent()

    // Ручка есть в разметке (номер страницы виден), но не интерактивна —
    // pointerdown по ней ничего не запускает.
    fireEvent.pointerDown(screen.getAllByTestId('hw-page-handle')[0], {
      pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 10,
    })
    fireEvent.pointerMove(screen.getAllByTestId('hw-page-thumb')[0], {
      pointerId: 9, pointerType: 'touch', clientX: 300, clientY: 10,
    })
    fireEvent.pointerUp(screen.getAllByTestId('hw-page-thumb')[0], {
      pointerId: 9, pointerType: 'touch', clientX: 300, clientY: 10,
    })
    expect(reorderAttemptFiles).not.toHaveBeenCalled()

    const left = screen.getAllByLabelText(/Сдвинуть страницу \d влево/)[0]
    expect(left.className).toMatch(/h-11 w-11/)
    const del = screen.getAllByLabelText(/Убрать страницу \d/)[0]
    expect(del.className).toMatch(/h-11 w-11/)

    expect(screen.getByText(/порядок меняется стрелками ← →/)).toBeInTheDocument()
    expect(screen.queryByText(/или перетаскиванием/)).not.toBeInTheDocument()
  })

  it('кнопка «Отправить на проверку» — на всю ширину', () => {
    attemptFiles = [page(1)]
    renderStudent()
    expect(screen.getByText('Отправить на проверку').closest('button')?.className).toMatch(/w-full/)
  })

  it('HEIC с айфона не отклоняется — уходит на загрузку как есть', async () => {
    renderStudent()
    const heic = new File(['x'], 'IMG_0001.heic', { type: 'image/heic' })
    fireEvent.change(screen.getByLabelText('Выбрать файлы работы'), { target: { files: [heic] } })

    await waitFor(() => expect(uploadAttemptFiles).toHaveBeenCalledWith('att-1', [heic], expect.any(Function)))
    expect(screen.queryByText(/Можно приложить только PDF и картинки/)).not.toBeInTheDocument()
  })

  /**
   * Главный сценарий задачи: съёмка тетради постранично. Камера — вход
   * одноразовый по природе (одно фото на нажатие), поэтому второе нажатие
   * обязано ДОПИСАТЬ страницу в конец, а не заменить первую — и кнопка
   * съёмки обязана остаться на месте (её узел в DOM идёт ПЕРЕД сеткой
   * миниатюр, а не после: миниатюры растут вниз под ней, кнопке некуда
   * «уехать» при появлении новых страниц).
   */
  it('снял — снял ещё раз: вторая страница дописывается, кнопка не двигается', async () => {
    const { rerender } = renderStudent()
    const cameraInput = () => screen.getByLabelText('Снять фото страницы') as HTMLInputElement

    const shot1 = new File(['1'], 'photo1.jpg', { type: 'image/jpeg' })
    fireEvent.change(cameraInput(), { target: { files: [shot1] } })
    await waitFor(() => expect(uploadAttemptFiles).toHaveBeenCalledTimes(1))
    expect(uploadAttemptFiles).toHaveBeenNthCalledWith(1, 'att-1', [shot1], expect.any(Function))

    // Сервер вернул первую страницу — перерисовываем с ней, как в жизни.
    attemptFiles = [page(1)]
    rerender(<TopicHomeworkStudent topicId={TOPIC} />)

    // Кнопка съёмки видна и стоит ПЕРЕД сеткой — не съехала вниз за страницей.
    const order = Array.from(document.querySelectorAll('[data-testid="hw-camera-button"], [data-testid="hw-page-grid"]'))
      .map(el => el.getAttribute('data-testid'))
    expect(order).toEqual(['hw-camera-button', 'hw-page-grid'])
    expect(screen.getAllByTestId('hw-page-thumb')).toHaveLength(1)

    const shot2 = new File(['2'], 'photo2.jpg', { type: 'image/jpeg' })
    fireEvent.change(cameraInput(), { target: { files: [shot2] } })
    await waitFor(() => expect(uploadAttemptFiles).toHaveBeenCalledTimes(2))
    // Второй вызов несёт ТОЛЬКО новый снимок — дописывание, а не пересборка
    // всего списка заново (иначе первая страница ушла бы вторым вызовом ещё раз).
    expect(uploadAttemptFiles).toHaveBeenNthCalledWith(2, 'att-1', [shot2], expect.any(Function))

    attemptFiles = [page(1), page(2)]
    rerender(<TopicHomeworkStudent topicId={TOPIC} />)

    expect(screen.getAllByTestId('hw-page-thumb')).toHaveLength(2)
    expect(screen.getByTestId('hw-camera-button')).toBeInTheDocument()
  })
})
