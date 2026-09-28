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
  TopicHomeworkEditor: ({ kind, isTemplate }: { kind: string; isTemplate: boolean }) => (
    <div data-testid="hw-editor" data-kind={kind} data-template={String(isTemplate)} />
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

  it('у контрольной рубрики — «Работа», «Условие», «Решение», «Ответы и критерии»', () => {
    renderModal({ kind: 'control' })
    expect(screen.getByTestId('topic-tile-homework')).toHaveTextContent('Работа')
    expect(screen.getByTestId('topic-tile-worksheet_homework')).toHaveTextContent('Условие')
    expect(screen.getByTestId('topic-tile-solution')).toHaveTextContent('Решение')
    expect(screen.getByTestId('topic-tile-criteria')).toHaveTextContent('Ответы и критерии')
    expect(screen.getByTestId('topic-kind-materials')).toHaveTextContent('после проверки')
  })

  it('настройки работы получают тип и признак шаблона', () => {
    renderModal({ kind: 'check', isTemplate: true })
    fireEvent.click(screen.getByTestId('topic-tile-homework'))
    expect(screen.getByTestId('hw-editor')).toHaveAttribute('data-kind', 'check')
    expect(screen.getByTestId('hw-editor')).toHaveAttribute('data-template', 'true')
  })

  it('у урока подписи прежние', () => {
    renderModal({ kind: 'lesson' })
    expect(screen.getByTestId('topic-tile-worksheet_homework')).toHaveTextContent('Рабочий лист ДЗ')
    expect(screen.queryByTestId('topic-kind-materials')).not.toBeInTheDocument()
  })
})
