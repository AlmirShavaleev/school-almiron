import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SOLUTION_FRACTION_STORAGE_KEY } from '@/lib/reviewPaneLayout'

/**
 * §140. Эталон занимает долю рабочей области (≈40 %), а не фиксированные
 * 384 px, и границу можно двигать. Тест держит именно поведение раскладки:
 * ширина приходит в панель, граница тянется и запоминается, а на узком экране
 * делить нечего.
 */

const materials = [{
  kind: 'file' as const, id: 'm1', title: 'Решение', position: 0, isVisible: false,
  section: 'solution' as const, storagePath: 't1/solution.pdf', fileName: 'solution.pdf', sizeBytes: 10,
}]

vi.mock('@/components/courseProgram/SolutionReferencePanel', () => ({
  SolutionReferencePanel: ({ widthPercent }: { widthPercent?: string }) => (
    <div data-testid="solution-reference-panel" data-width={widthPercent} />
  ),
  useTopicSolutionMaterials: () => ({ materials, loading: false }),
}))

vi.mock('@/components/SubmissionReviewer', () => ({
  default: () => <div data-testid="submission-reviewer" />,
}))

vi.mock('@/components/ui/SignedFileLink', () => ({
  SignedFileLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'

const files = [{
  id: 'f1', attempt_id: 'a1', storage_path: 'a1/page.jpg', file_name: 'page.jpg',
  mime_type: 'image/jpeg', size_bytes: 10, position: 0, created_at: '',
}]

function renderOverlay() {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={files}
      title="ДЗ"
      solutionTopicId="t1"
      onClose={() => {}}
    />,
  )
}

describe('ширина панели решения', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('по умолчанию эталон получает 40 % рабочей области', () => {
    renderOverlay()
    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-width', '40.0%')
  })

  it('запомненная ширина применяется при следующем открытии', () => {
    window.localStorage.setItem(SOLUTION_FRACTION_STORAGE_KEY, '0.55')
    renderOverlay()
    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-width', '55.0%')
  })

  it('граница тянется указателем и ширина сохраняется', () => {
    renderOverlay()
    const handle = screen.getByTestId('solution-split-handle')
    const row = handle.parentElement as HTMLElement
    row.getBoundingClientRect = () => ({
      left: 0, width: 1000, right: 1000, top: 0, bottom: 800, height: 800, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 })

    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-width', '50.0%')
    expect(window.localStorage.getItem(SOLUTION_FRACTION_STORAGE_KEY)).toBe('0.5')
  })

  it('граница двигается с клавиатуры — это ползунок, а не декорация', () => {
    renderOverlay()
    const handle = screen.getByTestId('solution-split-handle')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-width', '42.0%')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-width', '40.0%')
  })

  it('за границы диапазона не уезжает', () => {
    renderOverlay()
    const handle = screen.getByTestId('solution-split-handle')
    for (let i = 0; i < 30; i += 1) fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-width', '60.0%')

    for (let i = 0; i < 60; i += 1) fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-width', '25.0%')
  })

  it('границу видно только там, где панель занимает долю', () => {
    renderOverlay()
    // Ниже 1536 панель фиксированной ширины: тянуть нечего, ручка спрятана
    // классом, а не удалена — состояние ширины при этом не теряется.
    expect(screen.getByTestId('solution-split-handle').className).toContain('hidden')
    expect(screen.getByTestId('solution-split-handle').className).toContain('2xl:block')
  })

  it('кнопка «Решение» прячет и панель, и границу', () => {
    renderOverlay()
    fireEvent.click(screen.getByTestId('attempt-solution-toggle'))

    expect(screen.queryByTestId('solution-reference-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-split-handle')).not.toBeInTheDocument()
  })
})
