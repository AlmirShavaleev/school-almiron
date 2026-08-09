import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'
import type { TopicMaterial } from '@/lib/topicMaterialItems'
import { useToastStore } from '@/store/toastStore'

const addMaterial = vi.fn()
const deleteMaterial = vi.fn()
const toggleVisibility = vi.fn()
const moveMaterial = vi.fn()
const uploadMaterialFile = vi.fn()
let materials: TopicMaterial[] = []
let loading = false

const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }))
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...(args as [])) },
}))

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
  return render(
    <TopicMaterialItems
      topicId={TOPIC}
      canManage={canManage}
    />
  )
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


/**
 * §98. Файл уходит на сервер в момент выбора — кнопки «Сохранить» тут нет и
 * быть не может. Единственное подтверждение для преподавателя — тост, поэтому
 * он проверяется тестом, а не глазами.
 */
describe('Материалы темы — подтверждение сохранения', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  function pickFile(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('после загрузки файла показывает «Успешно сохранено»', async () => {
    uploadMaterialFile.mockResolvedValue({ filePath: 'p.png', fileName: 'p.png', fileSize: 10 })
    const { container } = renderItems(true)

    pickFile(container, new File(['x'], 'p.png', { type: 'image/png' }))

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map(t => t.message)).toContain('Успешно сохранено'))
  })

  it('провалившаяся загрузка не подтверждается сохранением', async () => {
    uploadMaterialFile.mockRejectedValue(new Error('нет прав'))
    const { container } = renderItems(true)

    pickFile(container, new File(['x'], 'p.png', { type: 'image/png' }))

    await waitFor(() => expect(screen.getByText(/Не загружено/)).toBeInTheDocument())
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('добавленный текстовый материал тоже подтверждается', async () => {
    renderItems(true)
    fireEvent.click(screen.getByText('Добавить материал'))
    fireEvent.change(screen.getByLabelText('Заголовок материала'), { target: { value: 'Конспект' } })
    fireEvent.change(screen.getByLabelText('Текст материала'), { target: { value: 'Текст' } })
    fireEvent.click(screen.getByText('Добавить'))

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map(t => t.message)).toContain('Успешно сохранено'))
  })
})

const fileMat = (id: string, section: string | null = 'notes'): TopicMaterial =>
  ({ kind: 'file', id, title: null, position: 0, isVisible: true, section: section as never,
     storagePath: `${TOPIC}/1_a.pdf`, fileName: 'конспект.pdf', sizeBytes: 10 })

/**
 * Врезка §107: открытие файла учеником считается для аналитики. Учёт не имеет
 * права мешать открытию, поэтому проверяем и вызов, и молчание при отказе.
 */
describe('Учёт просмотров материала', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: null, error: null })
  })

  it('ученик открывает файл — просмотр засчитывается', async () => {
    materials = [fileMat('m1')]
    renderItems(false)

    fireEvent.click(screen.getByText('конспект.pdf'))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('record_material_view', { p_item_id: 'm1' }))
  })

  it('преподавателю просмотры не считаются', async () => {
    materials = [fileMat('m1')]
    renderItems(true)

    fireEvent.click(screen.getByText('конспект.pdf'))

    await waitFor(() => expect(uploadMaterialFile).not.toHaveBeenCalled())
    expect(rpc).not.toHaveBeenCalled()
  })

  it('отказ RPC не мешает открыть файл', async () => {
    rpc.mockRejectedValue(new Error('нет такой функции'))
    materials = [fileMat('m1')]
    renderItems(false)

    // Клик не должен приводить к необработанному отказу обещания.
    expect(() => fireEvent.click(screen.getByText('конспект.pdf'))).not.toThrow()
    await waitFor(() => expect(rpc).toHaveBeenCalled())
  })
})
