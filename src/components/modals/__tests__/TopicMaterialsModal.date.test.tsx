import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §245. Дата «Открывается» в окне темы переводит тему на автоматику по дате.
 * Баг (владелец 30.09): у темы с ручным «Закрыта» поставленная дата молча не
 * действовала — писалась только available_from, is_open оставался false, и
 * «откроется …» нигде не появлялось.
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

const TOPIC = 'f0000000-0000-0000-0000-000000000002'

function renderModal(props: Partial<Parameters<typeof TopicMaterialsModal>[0]>) {
  const utils = render(
    <TopicMaterialsModal open onClose={vi.fn()} topicId={TOPIC} topicTitle="Тема" moduleTitle="Модуль" {...props} />,
  )
  const date = utils.container.querySelector('input[type="date"]') as HTMLInputElement
  return { ...utils, date }
}

describe('Окно темы — дата открытия (§245)', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    useAuthStore.setState({ profile: { id: 'u1', role: 'teacher' } as any })
  })

  it('дата у вручную закрытой темы переводит её на автоматику', async () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    const { date } = renderModal({ isOpen: false, availableFrom: null, onSaveTopicMeta })

    fireEvent.change(date, { target: { value: '2026-12-07' } })
    fireEvent.blur(date)

    await waitFor(() => expect(onSaveTopicMeta).toHaveBeenCalledWith({ available_from: '2026-12-07', is_open: null }))
  })

  it('после сохранения окно пишет, когда тема откроется', () => {
    renderModal({ isOpen: null, availableFrom: '2099-12-07', onSaveTopicMeta: vi.fn() })
    expect(screen.getByText(/Откроется сама 7 декабря/)).toBeInTheDocument()
  })

  it('стёртая дата не открывает закрытую тему: тумблер фиксируется как был', async () => {
    const onSaveTopicMeta = vi.fn().mockResolvedValue(undefined)
    const { date } = renderModal({ isOpen: null, availableFrom: '2099-12-07', onSaveTopicMeta })

    fireEvent.change(date, { target: { value: '' } })
    fireEvent.blur(date)

    await waitFor(() => expect(onSaveTopicMeta).toHaveBeenCalledWith({ available_from: null, is_open: false }))
  })

  it('у ручной темы подсказка говорит, что дата сработает', () => {
    renderModal({ isOpen: false, availableFrom: null, onSaveTopicMeta: vi.fn() })
    expect(screen.getByText(/Поставьте дату — тема откроется по ней/)).toBeInTheDocument()
  })
})
