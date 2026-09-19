import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
  SolutionReferencePanel: ({ widthPercent, widthFromLaptop }: { widthPercent?: string; widthFromLaptop?: boolean }) => (
    <div
      data-testid="solution-reference-panel"
      data-width={widthPercent}
      data-from-laptop={widthFromLaptop ? 'true' : 'false'}
    />
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

  it('границу видно с ноутбука и не видно на узком экране', () => {
    renderOverlay()
    // §208. Ниже 1024 колонки идут друг под другом — там делить нечего, и
    // ручка спрятана классом, а не удалена: состояние ширины не теряется.
    // Выше — граница есть, владелец работает как раз на 1280–1440.
    expect(screen.getByTestId('solution-split-handle').className).toContain('hidden')
    expect(screen.getByTestId('solution-split-handle').className).toContain('lg:block')
    expect(screen.getByTestId('solution-split-handle').className).not.toContain('2xl:block')
  })

  it('пока границу не двигали, на ноутбуке раскладка прежняя', () => {
    renderOverlay()
    // §140: между 1024 и 1536 доля в 40 % отдала бы документу ~436 px. Само
    // открытие работы раскладку не меняет — её меняет только человек.
    expect(screen.getByTestId('solution-reference-panel')).toHaveAttribute('data-from-laptop', 'false')
  })

  it('подвинутая граница действует и на ноутбуке, и в следующий раз', () => {
    renderOverlay()
    fireEvent.keyDown(screen.getByTestId('solution-split-handle'), { key: 'ArrowRight' })

    const panel = screen.getByTestId('solution-reference-panel')
    expect(panel).toHaveAttribute('data-width', '42.0%')
    expect(panel).toHaveAttribute('data-from-laptop', 'true')

    cleanup()
    renderOverlay()
    const again = screen.getByTestId('solution-reference-panel')
    expect(again).toHaveAttribute('data-width', '42.0%')
    expect(again).toHaveAttribute('data-from-laptop', 'true')
  })

  it('кнопка «Решение» прячет и панель, и границу', () => {
    renderOverlay()
    fireEvent.click(screen.getByTestId('attempt-solution-toggle'))

    expect(screen.queryByTestId('solution-reference-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solution-split-handle')).not.toBeInTheDocument()
  })
})
