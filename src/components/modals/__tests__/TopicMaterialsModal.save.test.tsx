import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §98. В модалке темы нет и не может быть кнопки «Сохранить»: файл уходит на
 * сервер в момент выбора, дедлайн и баллы — по потере фокуса. Кнопка внизу
 * закрывает окно, а факт сохранения подтверждает тост. Проверяем оба конца
 * этого договора.
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
  const onClose = vi.fn()
  render(
    <TopicMaterialsModal
      open
      onClose={onClose}
      topicId={TOPIC}
      topicTitle="Тема 1"
      moduleTitle="Модуль 1"
      {...props}
    />,
  )
  return { onClose }
}

describe('Модалка темы — подтверждение сохранения (§98)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useAuthStore.setState({ profile: { id: 'u1', role: 'teacher' } as any })
  })

  it('внизу «Готово», а не «Сохранить»', () => {
    renderModal()
    expect(screen.getByTestId('topic-modal-done')).toHaveTextContent('Готово')
    expect(screen.queryByText('Сохранить')).not.toBeInTheDocument()
  })

  it('«Готово» закрывает окно', () => {
    const { onClose } = renderModal()
    fireEvent.click(screen.getByTestId('topic-modal-done'))
    expect(onClose).toHaveBeenCalled()
  })

  it('тумблер открытости подтверждается тостом', async () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    renderModal({ onSaveTopicMeta })

    fireEvent.click(screen.getByTestId('topic-open-toggle'))

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map(t => t.message)).toContain('Успешно сохранено'))
  })

  it('неудачное сохранение тостом не подтверждается', async () => {
    const onSaveTopicMeta = vi.fn().mockRejectedValue(new Error('нет прав'))
    renderModal({ onSaveTopicMeta })

    fireEvent.click(screen.getByTestId('topic-open-toggle'))

    // Молчать нельзя: до §98 отказ уходил в unhandled rejection, и на экране
    // не менялось ничего — это читалось как успешное сохранение.
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map(t => t.type)).toContain('error'))
    expect(useToastStore.getState().toasts.map(t => t.message)).not.toContain('Успешно сохранено')
  })

  it('ученику кнопки «Готово» нет — ему нечего сохранять', () => {
    useAuthStore.setState({ profile: { id: 'u2', role: 'student' } as any })
    renderModal()
    expect(screen.queryByTestId('topic-modal-done')).not.toBeInTheDocument()
  })
})
