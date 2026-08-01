import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

const addMaterial = vi.fn()
const deleteMaterial = vi.fn()
const toggleVisibility = vi.fn()
const moveMaterial = vi.fn()
const uploadMaterialFile = vi.fn()
let materials: TopicMaterial[] = []
let loading = false

vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({
    materials, loading, error: null, reload: vi.fn(),
    uploadMaterialFile, addMaterial, deleteMaterial, toggleVisibility, moveMaterial,
  }),
}))

const TOPIC = 'f0000000-0000-0000-0000-000000000001'

const text = (id: string, title: string, position = 0, isVisible = true): TopicMaterial =>
  ({ kind: 'text', id, title, position, isVisible, section: null, content: 'Текст ' + title })

function renderItems(canManage: boolean) {
  return render(<TopicMaterialItems topicId={TOPIC} canManage={canManage} />)
}

beforeEach(() => {
  materials = []
  loading = false
  addMaterial.mockReset().mockResolvedValue(undefined)
  deleteMaterial.mockReset().mockResolvedValue(undefined)
  toggleVisibility.mockReset().mockResolvedValue(undefined)
  moveMaterial.mockReset().mockResolvedValue(undefined)
  uploadMaterialFile.mockReset()
})

describe('Материалы темы — преподаватель', () => {
  it('показывает форму добавления', () => {
    renderItems(true)
    expect(screen.getByText('Добавить материал')).toBeInTheDocument()
  })

  it('добавляет текстовый материал', async () => {
    renderItems(true)
    fireEvent.click(screen.getByText('Добавить материал'))
    fireEvent.change(screen.getByLabelText('Заголовок материала'), { target: { value: 'Конспект' } })
    fireEvent.change(screen.getByLabelText('Текст материала'), { target: { value: 'Скорость — вектор' } })
    fireEvent.click(screen.getByText('Добавить'))

    await waitFor(() =>
      expect(addMaterial).toHaveBeenCalledWith({ kind: 'text', title: 'Конспект', content: 'Скорость — вектор' }),
    )
  })

  it('переключает тип на ссылку и добавляет её', async () => {
    renderItems(true)
    fireEvent.click(screen.getByText('Добавить материал'))
    fireEvent.click(screen.getByText('Ссылка'))
    fireEvent.change(screen.getByLabelText('Ссылка'), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByText('Добавить'))

    await waitFor(() =>
      expect(addMaterial).toHaveBeenCalledWith({ kind: 'link', title: '', url: 'example.com' }),
    )
  })

  it('доступны все четыре типа материала', () => {
    renderItems(true)
    fireEvent.click(screen.getByText('Добавить материал'))
    for (const label of ['Текст', 'Видео', 'Ссылка', 'Файл']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('скрывает и показывает отдельный материал', async () => {
    materials = [text('m1', 'Конспект')]
    renderItems(true)

    fireEvent.click(screen.getByLabelText('Скрыть материал'))
    await waitFor(() => expect(toggleVisibility).toHaveBeenCalledWith('m1', false))
  })

  it('помечает скрытый материал и предлагает показать', () => {
    materials = [text('m1', 'Конспект', 0, false)]
    renderItems(true)

    expect(screen.getByText('Скрыт')).toBeInTheDocument()
    expect(screen.getByLabelText('Показать материал')).toBeInTheDocument()
  })

  it('меняет порядок материалов', async () => {
    materials = [text('m1', 'Первый', 0), text('m2', 'Второй', 1)]
    renderItems(true)

    const down = screen.getAllByLabelText('Опустить ниже')
    fireEvent.click(down[0])
    await waitFor(() => expect(moveMaterial).toHaveBeenCalledWith('m1', 'down'))

    const up = screen.getAllByLabelText('Поднять выше')
    fireEvent.click(up[1])
    await waitFor(() => expect(moveMaterial).toHaveBeenCalledWith('m2', 'up'))
  })

  it('крайние материалы нельзя сдвинуть за границы списка', () => {
    materials = [text('m1', 'Первый', 0), text('m2', 'Второй', 1)]
    renderItems(true)

    expect(screen.getAllByLabelText('Поднять выше')[0]).toBeDisabled()
    expect(screen.getAllByLabelText('Опустить ниже')[1]).toBeDisabled()
  })

  it('удаляет материал', async () => {
    materials = [text('m1', 'Конспект')]
    renderItems(true)

    fireEvent.click(screen.getByLabelText('Удалить материал'))
    await waitFor(() => expect(deleteMaterial).toHaveBeenCalledWith('m1'))
  })

  it('показывает пустое состояние', () => {
    renderItems(true)
    expect(screen.getByText('Материалов пока нет')).toBeInTheDocument()
  })
})

describe('Материалы темы — ученик', () => {
  it('видит материалы, но не видит управления', () => {
    materials = [text('m1', 'Конспект')]
    renderItems(false)

    expect(screen.getByText('Конспект')).toBeInTheDocument()
    expect(screen.getByText('Текст Конспект')).toBeInTheDocument()
    expect(screen.queryByText('Добавить материал')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Удалить материал')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Скрыть материал')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Поднять выше')).not.toBeInTheDocument()
  })

  it('порядок отображения совпадает с порядком из БД', () => {
    materials = [text('m1', 'Первый', 0), text('m2', 'Второй', 1), text('m3', 'Третий', 2)]
    renderItems(false)

    const titles = screen.getAllByText(/^(Первый|Второй|Третий)$/).map(el => el.textContent)
    expect(titles).toEqual(['Первый', 'Второй', 'Третий'])
  })

  it('своё пустое состояние, без предложения что-то добавить', () => {
    renderItems(false)
    expect(screen.getByText('Преподаватель ещё не добавил материалы')).toBeInTheDocument()
    expect(screen.queryByText('Добавить материал')).not.toBeInTheDocument()
  })

  it('скрытые материалы не приходят из БД, поэтому бейджа «Скрыт» нет', () => {
    // Отсекает RLS: topic_material_items_student_select требует is_visible.
    materials = [text('m1', 'Видимый')]
    renderItems(false)
    expect(screen.queryByText('Скрыт')).not.toBeInTheDocument()
  })
})

// ─── Группировка по рубрикам на странице ученика (§42) ───────────────────────
//
// До правки ученик получал плоский список, где каждый файл был подписан словом
// «Файл»: рубрика в БД была, но до UI не доезжала. Тесты закрепляют оба
// исправления — заголовок по имени файла и порядок рубрик.

const fileItem = (
  id: string,
  fileName: string,
  section: TopicMaterial['section'],
  position = 0,
): TopicMaterial => ({
  kind: 'file',
  id,
  title: null,
  position,
  isVisible: true,
  section,
  storagePath: `topics/${TOPIC}/${id}.pdf`,
  fileName,
  sizeBytes: 1024,
})

function renderStudent(solutionLock?: { reason: string } | null) {
  return render(
    <TopicMaterialItems topicId={TOPIC} canManage={false} solutionLock={solutionLock} />,
  )
}

describe('Материалы темы — рубрики у ученика', () => {
  it('файл без заголовка подписан именем файла без расширения', () => {
    materials = [fileItem('m1', 'КОНСПЕКТ ЗСИ.pdf', 'notes')]
    renderStudent()

    expect(screen.getByText('КОНСПЕКТ ЗСИ')).toBeInTheDocument()
    // Раньше в шапке стояло родовое слово «Файл» — и так у всех карточек сразу.
    expect(screen.queryByText('Файл')).not.toBeInTheDocument()
  })

  it('рубрики идут учебным маршрутом, а не порядком строк из БД', () => {
    materials = [
      fileItem('m1', 'Решение.pdf', 'solution', 0),
      fileItem('m2', 'Задачи.pdf', 'tasks', 1),
      fileItem('m3', 'Теория.pdf', 'theory', 2),
      fileItem('m4', 'Конспект.pdf', 'notes', 3),
    ]
    const { container } = renderStudent()

    const headings = Array.from(container.querySelectorAll('section'))
      .map(s => s.querySelector('span')?.textContent?.trim())
    expect(headings).toEqual(['Теория', 'Конспект', 'Задачи', 'Решение ДЗ'])
  })

  it('материал без рубрики уезжает в «Другие материалы», а не теряется', () => {
    materials = [fileItem('m1', 'Без рубрики.pdf', null)]
    renderStudent()

    expect(screen.getByText('Другие материалы')).toBeInTheDocument()
    expect(screen.getByText('Без рубрики')).toBeInTheDocument()
  })

  it('видео не дублируется списком: плеер темы уже стоит выше на странице', () => {
    materials = [
      { kind: 'video', id: 'v1', title: 'Урок', position: 0, isVisible: true, section: null,
        url: 'https://youtu.be/abc' },
      fileItem('m1', 'Кинематика.pdf', 'notes', 1),
    ]
    renderStudent()

    expect(screen.queryByText('Урок')).not.toBeInTheDocument()
    // Имя файла, а не слово «Конспект»: иначе матчился бы и заголовок рубрики.
    expect(screen.getByText('Кинематика')).toBeInTheDocument()
  })

  it('закрытое «Решение ДЗ» показывает причину и не даёт ссылки на файл', () => {
    materials = [fileItem('m1', 'Разбор.pdf', 'solution')]
    const { container } = renderStudent({ reason: 'Сначала сдайте ДЗ.' })

    expect(screen.getByText('Сначала сдайте ДЗ.')).toBeInTheDocument()
    expect(screen.getByText('закрыто')).toBeInTheDocument()
    // Имя файла остаётся видно — ученик знает, что разбор существует…
    expect(screen.getByText('Разбор')).toBeInTheDocument()
    // …но открыть его нечем.
    expect(container.querySelector('a')).toBeNull()
  })

  it('без замка решение открывается ссылкой', () => {
    materials = [fileItem('m1', 'Разбор.pdf', 'solution')]
    const { container } = renderStudent(null)

    expect(screen.queryByText('закрыто')).not.toBeInTheDocument()
    expect(container.querySelector('a')).not.toBeNull()
  })

  it('замок не трогает остальные рубрики', () => {
    materials = [
      fileItem('m1', 'Задачи.pdf', 'tasks', 0),
      fileItem('m2', 'Разбор.pdf', 'solution', 1),
    ]
    const { container } = renderStudent({ reason: 'Сначала сдайте ДЗ.' })

    // Ровно одна ссылка — на задачи; разбор закрыт.
    expect(container.querySelectorAll('a')).toHaveLength(1)
  })
})
