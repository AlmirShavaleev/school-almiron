import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

/**
 * §258. Поле «Название темы» в окне темы: сохранение по Enter и по уходу из
 * поля, пробелы по краям срезаются, пустое не сохраняется, ошибка — под
 * полем. Заголовок окна берёт новое название у родителя (как программа курса).
 */

vi.mock('@/hooks/useTopicMaterials', () => ({
  useTopicMaterials: () => ({ materials: [], loading: false, saveMaterial: vi.fn(), uploadFile: vi.fn(), createLinkMaterial: vi.fn(), deleteMaterial: vi.fn() }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: [], loading: false, error: null, reload: vi.fn(), uploadMaterialFile: vi.fn(), addMaterial: vi.fn(), deleteMaterial: vi.fn(), toggleVisibility: vi.fn(), moveMaterial: vi.fn() }),
}))
vi.mock('@/hooks/useTopicTest', () => ({
  useTopicTestAssignment: () => ({ assignment: null, loading: false }),
  useTestBank: () => ({ tests: [], loading: false }),
}))
vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({ homework: null, files: [], loading: false, error: null }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkEditor', () => ({ TopicHomeworkEditor: () => null }))
vi.mock('@/components/courseProgram/TopicTemplateBanner', () => ({ TopicTemplateBanner: () => null }))
vi.mock('@/components/courseProgram/TopicTrainingEditor', () => ({ TopicTrainingEditor: () => null }))
const toastMock = vi.hoisted(() => ({ saved: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: toastMock }))

import { TopicMaterialsModal } from '@/components/modals/TopicMaterialsModal'
import { useAuthStore } from '@/store/authStore'

/** Родитель как в программе курса: после сохранения название приходит назад пропом. */
function Host({ save, isTemplate = false }: { save: (v: { title?: string }) => Promise<void>; isTemplate?: boolean }) {
  const [title, setTitle] = useState('Кинематика')
  return (
    <>
      <span data-testid="program-row">{title}</span>
      <TopicMaterialsModal
        open onClose={vi.fn()} topicId="t1" topicTitle={title} moduleTitle="Механика" isTemplate={isTemplate}
        onSaveTopicMeta={async values => { await save(values); if (values.title) setTitle(values.title) }}
      />
    </>
  )
}

const input = () => screen.getByTestId('topic-title-input') as HTMLInputElement

describe('Название темы в окне темы (§258)', () => {
  beforeEach(() => {
    useAuthStore.setState({ profile: { id: 'u1', role: 'teacher' } as any })
    toastMock.saved.mockClear()
  })

  it('стоит первым блоком и показывает текущее название', () => {
    render(<Host save={vi.fn(async () => {})} />)
    expect(input()).toHaveValue('Кинематика')
    const field = screen.getByTestId('topic-title-field')
    const numbers = screen.getByTestId('topic-ege-numbers')
    expect(field.compareDocumentPosition(numbers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Enter — сохраняет обрезанное название; заголовок окна и строка программы обновляются', async () => {
    const save = vi.fn(async () => {})
    render(<Host save={save} />)
    fireEvent.change(input(), { target: { value: '  Кинематика: равноускоренное движение  ' } })
    input().focus()
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter' }) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ title: 'Кинематика: равноускоренное движение' })
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Кинематика: равноускоренное движение')
    expect(screen.getByTestId('program-row')).toHaveTextContent('Кинематика: равноускоренное движение')
    expect(input()).toHaveValue('Кинематика: равноускоренное движение')
    expect(toastMock.saved).toHaveBeenCalled()
  })

  it('уход из поля — тоже сохраняет; без изменений — не пишет', async () => {
    const save = vi.fn(async () => {})
    render(<Host save={save} />)
    await act(async () => { fireEvent.blur(input()) })
    expect(save).not.toHaveBeenCalled()
    fireEvent.change(input(), { target: { value: 'Динамика' } })
    await act(async () => { fireEvent.blur(input()) })
    expect(save).toHaveBeenCalledWith({ title: 'Динамика' })
  })

  it('пустое (или из пробелов) — не сохраняется, ошибка под полем, заголовок прежний', async () => {
    const save = vi.fn(async () => {})
    render(<Host save={save} />)
    fireEvent.change(input(), { target: { value: '   ' } })
    await act(async () => { fireEvent.blur(input()) })
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByTestId('topic-title-error')).toHaveTextContent('Название не может быть пустым')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Кинематика')
    // Набор нового текста снимает ошибку.
    fireEvent.change(input(), { target: { value: 'Д' } })
    expect(screen.queryByTestId('topic-title-error')).not.toBeInTheDocument()
  })

  it('сбой сохранения — ошибка под полем, набранное остаётся, заголовок прежний', async () => {
    const save = vi.fn(async () => { throw Object.assign(new Error('permission denied for table topics'), { code: '42501' }) })
    render(<Host save={save} />)
    fireEvent.change(input(), { target: { value: 'Динамика' } })
    await act(async () => { fireEvent.blur(input()) })
    expect(screen.getByTestId('topic-title-error')).toHaveTextContent('Недостаточно прав, чтобы переименовать тему')
    expect(input()).toHaveValue('Динамика')
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Кинематика')
    expect(toastMock.saved).not.toHaveBeenCalled()
  })

  it('прочий сбой — текст ошибки сервера', async () => {
    render(<Host save={vi.fn(async () => { throw new Error('network down') })} />)
    fireEvent.change(input(), { target: { value: 'Динамика' } })
    await act(async () => { fireEvent.blur(input()) })
    expect(screen.getByTestId('topic-title-error')).toHaveTextContent('Не удалось сохранить название: network down')
  })

  it('Escape — возвращает прежнее название без записи', async () => {
    const save = vi.fn(async () => {})
    render(<Host save={save} />)
    fireEvent.change(input(), { target: { value: 'Черновик' } })
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(input()).toHaveValue('Кинематика')
    await act(async () => { fireEvent.blur(input()) })
    expect(save).not.toHaveBeenCalled()
  })

  it('курс-шаблон: подсказка, что название уйдёт в классы-копии', () => {
    render(<Host save={vi.fn(async () => {})} isTemplate />)
    expect(screen.getByTestId('topic-title-field')).toHaveTextContent('название обновится и в классах-копиях')
  })
})
