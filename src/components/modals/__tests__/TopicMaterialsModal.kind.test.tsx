import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

/**
 * §240. Выбор типа темы в окне темы: урок / проверочная / контрольная. У
 * работы по времени рубрики подписаны по-своему, настройки работы получают
 * тип и признак шаблона (время в шаблоне не ставится).
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
vi.mock('@/components/courseProgram/TopicHomeworkEditor', () => ({
  TopicHomeworkEditor: ({ kind, isTemplate, isOpen, availableFrom }: { kind: string; isTemplate: boolean; isOpen: boolean | null; availableFrom: string | null }) => (
    <div data-testid="hw-editor" data-kind={kind} data-template={String(isTemplate)} data-open={String(isOpen)} data-from={String(availableFrom)} />
  ),
}))
vi.mock('@/components/courseProgram/TopicTemplateBanner', () => ({ TopicTemplateBanner: () => null }))
vi.mock('@/components/courseProgram/TopicTrainingEditor', () => ({ TopicTrainingEditor: () => null }))
vi.mock('@/store/toastStore', () => ({ toast: { saved: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() } }))

import { TopicMaterialsModal } from '@/components/modals/TopicMaterialsModal'
import { useAuthStore } from '@/store/authStore'

function renderModal(props: Partial<React.ComponentProps<typeof TopicMaterialsModal>> = {}) {
  const onSaveTopicMeta = vi.fn(async () => {})
  render(
    <TopicMaterialsModal open onClose={vi.fn()} topicId="t1" topicTitle="Кинематика" moduleTitle="Механика" onSaveTopicMeta={onSaveTopicMeta} {...props} />,
  )
  return { onSaveTopicMeta }
}

describe('Тип темы в окне темы (§240)', () => {
  beforeEach(() => { useAuthStore.setState({ profile: { id: 'u1', role: 'teacher' } as any }) })

  it('по умолчанию — урок; выбор «Контрольная работа» сохраняется', async () => {
    const { onSaveTopicMeta } = renderModal()
    expect(screen.getByTestId('topic-kind-lesson')).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { fireEvent.click(screen.getByTestId('topic-kind-control')) })
    expect(onSaveTopicMeta).toHaveBeenCalledWith({ kind: 'control' })
    expect(screen.getByTestId('topic-kind-control')).toHaveAttribute('aria-pressed', 'true')
  })

  it('сбой сохранения — выбор откатывается', async () => {
    const onSaveTopicMeta = vi.fn(async () => { throw new Error('нет прав') })
    renderModal({ onSaveTopicMeta })
    await act(async () => { fireEvent.click(screen.getByTestId('topic-kind-check')) })
    expect(screen.getByTestId('topic-kind-lesson')).toHaveAttribute('aria-pressed', 'true')
  })

  it('у контрольной только три плитки: «Условие», «Решение», «Ответы и критерии» (§240.1)', () => {
    renderModal({ kind: 'control' })
    expect(screen.getByTestId('topic-tile-worksheet_homework')).toHaveTextContent('Условие')
    expect(screen.getByTestId('topic-tile-solution')).toHaveTextContent('Решение')
    expect(screen.getByTestId('topic-tile-criteria')).toHaveTextContent('Ответы и критерии')
    expect(screen.getByTestId('topic-tile-worksheet_homework')).toHaveTextContent('с начала работы')
    expect(screen.getByTestId('topic-tile-criteria')).toHaveTextContent('после проверки')
    for (const hidden of ['theory', 'notes', 'tasks', 'task_solution', 'worksheet_tasks', 'homework', 'video', 'test']) {
      expect(screen.queryByTestId(`topic-tile-${hidden}`)).not.toBeInTheDocument()
    }
  })

  it('настройки работы по времени видны сразу, без плитки, и получают тип и признак шаблона', () => {
    renderModal({ kind: 'check', isTemplate: true })
    expect(screen.getByTestId('topic-timed-settings')).toBeInTheDocument()
    expect(screen.getByTestId('hw-editor')).toHaveAttribute('data-kind', 'check')
    expect(screen.getByTestId('hw-editor')).toHaveAttribute('data-template', 'true')
  })

  // §243. Выдано ли ДЗ, решает открытость темы: блок ДЗ получает тумблер и дату.
  it('блок ДЗ получает открытость темы — тумблер и дату', () => {
    renderModal({ kind: 'lesson', initialTile: 'homework', isOpen: null, availableFrom: '2026-10-06' })
    expect(screen.getByTestId('hw-editor')).toHaveAttribute('data-open', 'null')
    expect(screen.getByTestId('hw-editor')).toHaveAttribute('data-from', '2026-10-06')
  })

  it('открытие окна сразу на «ДЗ» у контрольной не рисует лишнюю панель', () => {
    renderModal({ kind: 'control', initialTile: 'homework' })
    expect(screen.getAllByTestId('hw-editor')).toHaveLength(1)
  })

  it('у урока подписи прежние', () => {
    renderModal({ kind: 'lesson' })
    expect(screen.getByTestId('topic-tile-worksheet_homework')).toHaveTextContent('Рабочий лист ДЗ')
    expect(screen.getByTestId('topic-tile-theory')).toBeInTheDocument()
    expect(screen.getByTestId('topic-tile-homework')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-kind-materials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('topic-timed-settings')).not.toBeInTheDocument()
  })
})
