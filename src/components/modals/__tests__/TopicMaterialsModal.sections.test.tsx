import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TopicMaterial } from '@/lib/topicMaterialItems'
import { TOPIC_SECTION_ORDER, isTopicSectionVisible } from '@/lib/topicMaterialItems'

/**
 * §100. Вкладка «Материалы» показывала десять рубрик, а карточки ВНУТРИ окна
 * темы — старые семь: перечень у окна был свой и отстал от §95. Проверяем не
 * «какой список написан в файле», а что видно в окне и куда уходит клик.
 */

const materials: TopicMaterial[] = []
const uploadMaterialFile = vi.fn()
const addMaterial = vi.fn()

vi.mock('@/hooks/useTopicMaterials', () => ({
  useTopicMaterials: () => ({
    materials: [], loading: false,
    saveMaterial: vi.fn(), uploadFile: vi.fn(), createLinkMaterial: vi.fn(), deleteMaterial: vi.fn(),
  }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({
    materials, loading: false, error: null, reload: vi.fn(),
    uploadMaterialFile, addMaterial,
    deleteMaterial: vi.fn(), toggleVisibility: vi.fn(), moveMaterial: vi.fn(),
  }),
}))
vi.mock('@/lib/storage', () => ({
  forgetSignedUrl: () => {},
  SIGNED_URL_TTL_S: 3600,
  SHORT_SIGNED_URL_TTL_S: 300,
  UPLOAD_CACHE_CONTROL_S: '31536000',
  getSignedFileUrl: vi.fn().mockResolvedValue('https://signed/p.png'),
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

const TOPIC = 'f0000000-0000-0000-0000-000000000001'

/** Три рубрики, добавленные в §95 и потерянные окном темы. */
const NEW_TILES = [
  { key: 'task_solution', label: 'Решение задач' },
  { key: 'worksheet_tasks', label: 'Рабочий лист задач' },
  { key: 'worksheet_homework', label: 'Рабочий лист ДЗ' },
] as const

function renderModal() {
  render(
    <TopicMaterialsModal
      open
      onClose={vi.fn()}
      topicId={TOPIC}
      topicTitle="Тема 1"
      moduleTitle="Модуль 1"
    />,
  )
}

function pasteScreenshot() {
  const file = new File([new Uint8Array(8)], 'image.png', { type: 'image/png' })
  const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(e, 'clipboardData', {
    value: {
      items: [{ kind: 'file', getAsFile: () => file }],
      files: [],
      getData: () => '',
    },
  })
  act(() => { document.dispatchEvent(e) })
}

describe('Карточки рубрик в окне темы (§100)', () => {
  beforeEach(() => {
    materials.length = 0
    uploadMaterialFile.mockReset().mockResolvedValue({
      storagePath: `${TOPIC}/1_p.png`, fileName: 'скриншот-1.png', mimeType: 'image/png', sizeBytes: 8,
    })
    addMaterial.mockReset().mockResolvedValue(undefined)
    useAuthStore.setState({ profile: { id: 'u1', role: 'teacher' } as any })
  })

  /*
   * Число НЕ зашито. Было `10`, и тест покраснел, когда владелец 12.08 убрал
   * с темы рубрику тестов (`TOPIC_SECTIONS_HIDDEN`): карточек стало девять.
   * Проверять надо не «сколько их сегодня», а что окно показывает ровно те
   * рубрики, которые перечень считает видимыми, — иначе следующая правка
   * перечня снова уронит тест, ничего не сломав в продукте.
   */
  it('карточек столько же, сколько видимых рубрик в перечне', () => {
    renderModal()
    const visible = TOPIC_SECTION_ORDER.filter(isTopicSectionVisible)
    expect(screen.getAllByTestId(/^topic-tile-/)).toHaveLength(visible.length)
  })

  it.each(NEW_TILES)('рубрика «$label» на месте', ({ key, label }) => {
    renderModal()
    expect(screen.getByTestId(`topic-tile-${key}`)).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it.each(NEW_TILES)('«$label» открывается и грузит файл в СВОЮ рубрику', async ({ key, label }) => {
    renderModal()
    fireEvent.click(screen.getByTestId(`topic-tile-${key}`))

    // Заголовок панели — подпись той же рубрики, а не соседней.
    expect(screen.getAllByText(label).length).toBeGreaterThan(1)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'лист.pdf', { type: 'application/pdf' })] } })

    await waitFor(() => expect(addMaterial).toHaveBeenCalled())
    expect(addMaterial.mock.calls[0][0]).toMatchObject({ kind: 'file', section: key })
  })

  it.each(NEW_TILES)('в «$label» работает Ctrl+V', async ({ key }) => {
    renderModal()
    fireEvent.click(screen.getByTestId(`topic-tile-${key}`))

    pasteScreenshot()

    await waitFor(() => expect(uploadMaterialFile).toHaveBeenCalled())
    expect(uploadMaterialFile.mock.calls[0][0].name).toBe('скриншот-1.png')
    await waitFor(() => expect(addMaterial.mock.calls[0][0]).toMatchObject({ section: key }))
  })

  it('картинка в новой рубрике показывается превью, а не строкой', async () => {
    materials.push({
      kind: 'file', id: 'm1', title: null, position: 0, isVisible: true,
      section: 'worksheet_tasks', storagePath: `${TOPIC}/1_p.png`,
      fileName: 'скриншот-1.png', sizeBytes: 8,
    })
    renderModal()
    fireEvent.click(screen.getByTestId('topic-tile-worksheet_tasks'))

    expect(await screen.findByTestId('signed-image')).toBeInTheDocument()
  })

  it('заполненная новая рубрика помечается точкой', () => {
    materials.push({
      kind: 'file', id: 'm1', title: null, position: 0, isVisible: true,
      section: 'task_solution', storagePath: `${TOPIC}/1_p.pdf`,
      fileName: 'решение.pdf', sizeBytes: 8,
    })
    renderModal()

    const tile = screen.getByTestId('topic-tile-task_solution')
    expect(tile.querySelector('[data-testid="topic-tile-filled"]')).not.toBeNull()
    expect(screen.getByTestId('topic-tile-theory').querySelector('[data-testid="topic-tile-filled"]')).toBeNull()
  })

  it('ДЗ по-прежнему открывает редактор ДЗ, а не рубрику материалов', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('topic-tile-homework'))
    expect(screen.getByText('Домашнее задание')).toBeInTheDocument()
  })
})
