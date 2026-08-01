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

function renderItems(
  canManage: boolean,
  opts?: { tabs?: boolean; solution?: { hasSolution: boolean; hasHomework: boolean; unlocked: boolean } }
) {
  return render(
    <TopicMaterialItems
      topicId={TOPIC}
      canManage={canManage}
      tabs={opts?.tabs}
      solution={opts?.solution}
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

describe('Режим вкладок', () => {
  // Фабрики материалов с section
  const materialWithSection = (
    id: string,
    title: string,
    section: 'notes' | 'theory' | 'tasks' | 'solution',
    position = 0,
    isVisible = true
  ): TopicMaterial =>
    ({ kind: 'text', id, title, position, isVisible, section, content: `Контент ${title}` })

  it('без пропса tabs список остаётся сплошным', () => {
    materials = [materialWithSection('m1', 'Конспект', 'notes')]
    renderItems(false, { tabs: false })

    expect(screen.getByText('Конспект')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('пустые рубрики не превращаются во вкладки', () => {
    materials = [materialWithSection('m1', 'Мой конспект', 'notes')]
    renderItems(false, { tabs: true })

    // Есть вкладка «Конспект» (notes) — на ней один материал
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument()
    // Нет вкладки «Теория» — нет материалов в theory
    expect(screen.queryByRole('tab', { name: /Теория/ })).not.toBeInTheDocument()
  })

  it('вкладки переключаются и показывают свои материалы', () => {
    materials = [
      materialWithSection('m1', 'Конспект номер 1', 'notes', 0),
      materialWithSection('m2', 'Задача номер 1', 'tasks', 1),
    ]
    renderItems(false, { tabs: true })

    // Изначально должен быть виден материал конспекта
    expect(screen.getByText('Конспект номер 1')).toBeInTheDocument()
    expect(screen.queryByText('Задача номер 1')).not.toBeInTheDocument()

    // Клик на вкладку «Задачи»
    fireEvent.click(screen.getByRole('tab', { name: /Задачи/ }))

    // Теперь видна задача, конспект скрыт
    expect(screen.getByText('Задача номер 1')).toBeInTheDocument()
    expect(screen.queryByText('Конспект номер 1')).not.toBeInTheDocument()
  })

  it('закрытое решение показывает вкладку без материалов', () => {
    materials = [materialWithSection('m1', 'Конспект', 'notes', 0)]
    renderItems(false, {
      tabs: true,
      solution: { hasSolution: true, hasHomework: true, unlocked: false },
    })

    // Вкладка «Решение ДЗ» присутствует
    expect(screen.getByRole('tab', { name: /Решение ДЗ/ })).toBeInTheDocument()

    // Клик на неё
    fireEvent.click(screen.getByRole('tab', { name: /Решение ДЗ/ }))

    // Видна стена с замком
    expect(screen.getByText('Решение пока закрыто')).toBeInTheDocument()
    // Не видно содержимого материалов (контента конспекта)
    expect(screen.queryByText('Контент Конспект')).not.toBeInTheDocument()
  })

  it('открытое решение показывает материалы, а не замок', () => {
    materials = [
      materialWithSection('m1', 'Конспект', 'notes', 0),
      materialWithSection('m2', 'Ответ на задачу', 'solution', 1),
    ]
    renderItems(false, {
      tabs: true,
      solution: { hasSolution: true, hasHomework: true, unlocked: true },
    })

    // Вкладка «Решение ДЗ» присутствует
    expect(screen.getByRole('tab', { name: /Решение ДЗ/ })).toBeInTheDocument()

    // Клик на неё
    fireEvent.click(screen.getByRole('tab', { name: /Решение ДЗ/ }))

    // Видна содержимое материала решения
    expect(screen.getByText('Ответ на задачу')).toBeInTheDocument()
    // Нет стены с замком
    expect(screen.queryByText('Решение пока закрыто')).not.toBeInTheDocument()
  })

  it('когда решения нет вовсе, вкладки «Решение ДЗ» нет', () => {
    materials = [materialWithSection('m1', 'Конспект', 'notes', 0)]
    renderItems(false, {
      tabs: true,
      solution: { hasSolution: false, hasHomework: true, unlocked: false },
    })

    // Вкладка «Решение ДЗ» не должна быть
    expect(screen.queryByRole('tab', { name: /Решение ДЗ/ })).not.toBeInTheDocument()
    // Видна только вкладка конспекта
    expect(screen.getByRole('tab', { name: /Конспект/ })).toBeInTheDocument()
  })
})
