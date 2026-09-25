import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §216. Поле «номера заданий ЕГЭ» в редакторе темы.
 *
 * Владельцу предстоит проставить номера у сотни тем по ходу работы, поэтому
 * поле стоит первым блоком окна, а не внутри рубрики. Проверяем ровно то, за
 * что оно отвечает: что уходит в базу, что показывается при ошибке и что поле
 * не ходит в базу зря.
 */

vi.mock('@/hooks/useTopicMaterials', () => ({
  useTopicMaterials: () => ({
    materials: [], loading: false,
    saveMaterial: vi.fn(), uploadFile: vi.fn(), createLinkMaterial: vi.fn(), deleteMaterial: vi.fn(),
  }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: [], loading: false, error: null }),
}))
vi.mock('@/hooks/useTopicTest', () => ({
  useTopicTestAssignment: () => ({ assignment: null, loading: false }),
  useTestBank: () => ({ tests: [], loading: false }),
}))
vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({ homework: null, files: [], loading: false, error: null }),
}))

import { TopicMaterialsModal } from '@/components/modals/TopicMaterialsModal'
import { useAuthStore } from '@/store/authStore'
import { useToastStore } from '@/store/toastStore'

const TOPIC = 'f0000000-0000-0000-0000-000000000001'

function renderModal(props: Partial<Parameters<typeof TopicMaterialsModal>[0]> = {}) {
  render(
    <TopicMaterialsModal
      open
      onClose={vi.fn()}
      topicId={TOPIC}
      topicTitle="Тема 1"
      moduleTitle="Модуль 1"
      {...props}
    />,
  )
}

describe('Номера заданий ЕГЭ в редакторе темы (§216)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useAuthStore.setState({ profile: { id: 'u1', role: 'teacher' } as any })
  })

  it('поле показывает уже проставленные номера списком', () => {
    renderModal({ egeTaskNumbers: [13, 14, 15] })
    expect((screen.getByTestId('topic-ege-numbers-input') as HTMLInputElement).value).toBe('13, 14, 15')
  })

  it('пусто — поле пустое, а не «0»', () => {
    renderModal({ egeTaskNumbers: [] })
    expect((screen.getByTestId('topic-ege-numbers-input') as HTMLInputElement).value).toBe('')
  })

  it('введённый список уходит в базу массивом', async () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    renderModal({ egeTaskNumbers: [], onSaveTopicMeta })

    const input = screen.getByTestId('topic-ege-numbers-input')
    fireEvent.change(input, { target: { value: '13, 14, 15' } })
    fireEvent.blur(input)

    await waitFor(() => expect(onSaveTopicMeta).toHaveBeenCalledWith({ ege_task_numbers: [13, 14, 15] }))
  })

  it('диапазон разворачивается в номера', async () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    renderModal({ egeTaskNumbers: [], onSaveTopicMeta })

    const input = screen.getByTestId('topic-ege-numbers-input')
    fireEvent.change(input, { target: { value: '22-23' } })
    fireEvent.blur(input)

    await waitFor(() => expect(onSaveTopicMeta).toHaveBeenCalledWith({ ege_task_numbers: [22, 23] }))
  })

  it('мусор объясняется под полем и в базу не идёт', async () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    renderModal({ egeTaskNumbers: [], onSaveTopicMeta })

    const input = screen.getByTestId('topic-ege-numbers-input')
    fireEvent.change(input, { target: { value: 'оптика' } })
    fireEvent.blur(input)

    expect(await screen.findByTestId('topic-ege-numbers-error')).toHaveTextContent('не номер задания')
    expect(onSaveTopicMeta).not.toHaveBeenCalled()
  })

  it('то же самое значение в базу не переписывается', () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    renderModal({ egeTaskNumbers: [13, 14], onSaveTopicMeta })

    const input = screen.getByTestId('topic-ege-numbers-input')
    fireEvent.change(input, { target: { value: '14, 13' } })
    fireEvent.blur(input)

    expect(onSaveTopicMeta).not.toHaveBeenCalled()
  })

  it('пустое поле у темы с номерами стирает их', async () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    renderModal({ egeTaskNumbers: [13], onSaveTopicMeta })

    const input = screen.getByTestId('topic-ege-numbers-input')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    await waitFor(() => expect(onSaveTopicMeta).toHaveBeenCalledWith({ ege_task_numbers: [] }))
  })

  it('подсказка из названия появляется только у пустого поля', () => {
    renderModal({ topicTitle: '№13 — Методы решения', egeTaskNumbers: [] })
    expect(screen.getByTestId('topic-ege-numbers-from-title')).toHaveTextContent('Из названия: 13')
  })

  it('у заполненного поля подсказки нет — перебивать проставленное нельзя', () => {
    renderModal({ topicTitle: '№13 — Методы решения', egeTaskNumbers: [7] })
    expect(screen.queryByTestId('topic-ege-numbers-from-title')).not.toBeInTheDocument()
  })

  it('ученику поля нет вовсе', () => {
    useAuthStore.setState({ profile: { id: 'u2', role: 'student' } as any })
    renderModal({ egeTaskNumbers: [13] })
    expect(screen.queryByTestId('topic-ege-numbers-input')).not.toBeInTheDocument()
  })
})
