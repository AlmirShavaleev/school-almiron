/**
 * §248. Меню «…» в шапке спокойного экрана проверки. Сюда переехали кнопки,
 * которые владелец назвал шумом, — «Файлы», «Скачать PDF», «Очистить
 * пометки», «Эталон снизу, а не сбоку», — и они обязаны РАБОТАТЬ из меню:
 * полоса файлов раскрывается, подтверждение очистки открывает аннотатор,
 * пункты экрана («Все задания таблицей») зовут свой обработчик. Шапка —
 * одна строка, второй сводки в ней нет.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'

vi.mock('@/components/courseProgram/SolutionReferencePanel', async importOriginal => {
  const real = await importOriginal<typeof import('@/components/courseProgram/SolutionReferencePanel')>()
  return {
    ...real,
    useTopicSolutionMaterials: (topicId?: string | null) => ({
      materials: topicId ? [{ kind: 'text', id: 'm1', title: null, position: 0, isVisible: false, section: 'solution', content: 'решение' }] : [],
      loading: false,
    }),
  }
})

/** Аннотатор-заглушка: как настоящий, отдаёт ручку очистки и её доступность. */
const clearMarks = vi.fn()
let clearAvailable = true
vi.mock('@/components/SubmissionReviewer', () => ({
  default: ({ clearMarksRef, onClearMarksAvailableChange, calm }: {
    clearMarksRef?: { current: (() => void) | null }
    onClearMarksAvailableChange?: (value: boolean) => void
    calm?: boolean
  }) => {
    useEffect(() => {
      if (clearMarksRef) clearMarksRef.current = clearMarks
      onClearMarksAvailableChange?.(clearAvailable)
    })
    return <div data-testid="submission-reviewer" data-calm={calm ? 'true' : undefined} />
  },
}))

vi.mock('@/components/ui/SignedFileLink', () => ({
  SignedFileLink: ({ children }: { children: React.ReactNode }) => <span data-testid="file-link">{children}</span>,
}))

import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'
import type { AttemptPdfReport } from '@/lib/attemptPdfReport'

const files = [
  { id: 'f1', attempt_id: 'a1', storage_path: 'a1/p1.jpg', file_name: 'p1.jpg', mime_type: 'image/jpeg', size_bytes: 1, position: 0, created_at: '' },
  { id: 'f2', attempt_id: 'a1', storage_path: 'a1/p2.jpg', file_name: 'p2.jpg', mime_type: 'image/jpeg', size_bytes: 1, position: 1, created_at: '' },
]

const report: AttemptPdfReport = { studentName: 'Артём', homeworkTitle: 'ДЗ', topicTitle: 'Тема', scoreMax: 5 }

function renderCalm(extra: Record<string, unknown> = {}) {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={files}
      title="ДЗ"
      lead="Артём · Проверочная «Производная»"
      subtitle="11А · сдано 28 сент., в срок"
      backLabel="Очередь · 1 из 25"
      headerAside={<button type="button" data-testid="review-next">Следующая работа →</button>}
      solutionTopicId="t1"
      pdfReport={report}
      reviewPanel={() => <div data-testid="tasks">задание</div>}
      reviewBar={() => <div data-testid="bar">балл</div>}
      onClose={() => {}}
      {...extra}
    />,
  )
}

const menu = () => screen.getByTestId('attempt-more-menu-list')
const openMenu = () => fireEvent.click(screen.getByTestId('attempt-more-menu'))

describe('§248 — шапка и меню «…»', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearMarks.mockReset()
    clearAvailable = true
  })

  it('шапка: «← Очередь · N из M», «Имя · ДЗ», группа и срок, «Эталон», «…», «Следующая»', async () => {
    renderCalm()
    expect(screen.getByTestId('attempt-back')).toHaveTextContent('← Очередь · 1 из 25')
    expect(screen.getByTestId('attempt-header-lead')).toHaveTextContent('Артём · Проверочная «Производная»')
    expect(screen.getByTestId('attempt-header-secondary')).toHaveTextContent('11А · сдано 28 сент., в срок')
    expect(screen.getByTestId('attempt-reference-toggle')).toHaveTextContent('Эталон')
    expect(screen.getByTestId('attempt-header-aside')).toContainElement(screen.getByTestId('review-next'))
    // Аннотатор — в спокойном виде.
    expect(await screen.findByTestId('submission-reviewer')).toHaveAttribute('data-calm', 'true')
  })

  it('меню закрыто, пока не нажали «…»; внутри — перенесённые действия', () => {
    renderCalm()
    expect(menu()).not.toBeVisible()
    openMenu()
    expect(screen.getByTestId('attempt-more-menu')).toHaveAttribute('aria-expanded', 'true')
    expect(menu()).toBeVisible()
    const labels = Array.from(menu().querySelectorAll('[role^="menuitem"]')).map(item => item.textContent?.trim())
    expect(labels).toEqual([
      'Файлы работы (2)',
      'Скачать PDF',
      'Эталон снизу, а не сбоку',
      'Очистить пометки',
      'Закрыть разбор',
    ])
    // Отдельных кнопок этих действий в шапке нет: каждая — одна, и та в меню.
    for (const id of ['attempt-files-toggle', 'attempt-pdf-download', 'clear-marks-button', 'reference-placement-toggle']) {
      expect(screen.getAllByTestId(id)).toHaveLength(1)
      expect(menu()).toContainElement(screen.getByTestId(id))
    }
    // Переключателя «Решение рядом/внизу» в шапке больше нет.
    expect(within(screen.getByRole('dialog')).queryByText(/Решение рядом|Решение внизу/)).not.toBeInTheDocument()
  })

  it('«Файлы работы» раскрывает полосу со ссылками на оригиналы', () => {
    renderCalm()
    expect(screen.queryByTestId('attempt-files-strip')).not.toBeInTheDocument()
    openMenu()
    fireEvent.click(screen.getByTestId('attempt-files-toggle'))
    expect(screen.getByTestId('attempt-files-strip')).toBeInTheDocument()
    expect(screen.getAllByTestId('file-link')).toHaveLength(2)
    expect(menu()).not.toBeVisible()
  })

  it('«Очистить пометки» зовёт подтверждение аннотатора; нечего чистить — пункт выключен', async () => {
    renderCalm()
    await screen.findByTestId('submission-reviewer')
    openMenu()
    fireEvent.click(screen.getByTestId('clear-marks-button'))
    expect(clearMarks).toHaveBeenCalledTimes(1)

    clearAvailable = false
    renderCalm()
    await waitFor(() => expect(screen.getAllByTestId('submission-reviewer')).toHaveLength(2))
    const buttons = screen.getAllByTestId('clear-marks-button')
    expect(buttons[buttons.length - 1]).toBeDisabled()
  })

  it('свои пункты экрана — в том же меню, нажатие зовёт обработчик', () => {
    const onTable = vi.fn()
    renderCalm({ menuExtras: [{ id: 'table', label: 'Все задания таблицей', testId: 'review-open-table', onSelect: onTable }] })
    openMenu()
    fireEvent.click(screen.getByTestId('review-open-table'))
    expect(onTable).toHaveBeenCalled()
    expect(menu()).not.toBeVisible()
  })

  it('Esc закрывает меню, а не разбор; «Закрыть разбор» — закрывает', () => {
    const onClose = vi.fn()
    renderCalm({ onClose })
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu()).not.toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
    openMenu()
    fireEvent.click(screen.getByTestId('attempt-annotation-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('на чтении (в работе коллега) «Очистить пометки» в меню нет', () => {
    renderCalm({ locked: true })
    openMenu()
    expect(screen.queryByTestId('clear-marks-button')).not.toBeInTheDocument()
  })
})
