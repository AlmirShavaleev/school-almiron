/**
 * §206. Кнопка «Скачать PDF» в общей оболочке разбора.
 *
 * Оболочку открывают обе стороны, поэтому здесь проверяется главное правило
 * видимости: ученик получает кнопку только после вердикта, преподаватель —
 * всегда, а на попытке без размечаемых файлов кнопки нет вовсе (собирать
 * нечего).
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { AttemptPdfReport } from '@/lib/attemptPdfReport'

vi.mock('@/components/courseProgram/SolutionReferencePanel', () => ({
  SolutionReferencePanel: () => <div />,
  useTopicSolutionMaterials: () => ({ materials: [], loading: false }),
}))

vi.mock('@/components/SubmissionReviewer', () => ({
  default: () => <div data-testid="submission-reviewer" />,
}))

vi.mock('@/components/ui/SignedFileLink', () => ({
  SignedFileLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

const toastError = vi.fn()
vi.mock('@/store/toastStore', () => ({ toast: { error: (msg: string) => toastError(msg) } }))

import { AttemptAnnotationOverlay } from '@/components/courseProgram/AttemptAnnotationOverlay'

const FILES = [{
  id: 'f1', attempt_id: 'a1', storage_path: 'a1/page.jpg', file_name: 'page.jpg',
  mime_type: 'image/jpeg', size_bytes: 10, position: 0, created_at: '',
}]

const REPORT: AttemptPdfReport = {
  studentName: 'Иванов Иван',
  homeworkTitle: 'ДЗ №3',
  topicTitle: 'Тема',
  submittedAt: '2026-09-18T12:00:00.000Z',
  reviewedAt: null,
  decision: null,
  score: null,
  scoreMax: 5,
  comment: null,
  tasks: [],
}

function renderOverlay(props: Partial<React.ComponentProps<typeof AttemptAnnotationOverlay>>) {
  return render(
    <AttemptAnnotationOverlay
      attemptId="a1"
      files={FILES}
      title="ДЗ"
      onClose={() => {}}
      {...props}
    />,
  )
}

describe('кнопка «Скачать PDF»', () => {
  it('у ученика до вердикта кнопки нет', () => {
    renderOverlay({ readOnly: true, pdfAudience: 'student', pdfReport: REPORT })
    expect(screen.queryByTestId('attempt-pdf-download')).toBeNull()
  })

  it('у ученика после вердикта кнопка есть', () => {
    renderOverlay({
      readOnly: true,
      pdfAudience: 'student',
      pdfReport: { ...REPORT, decision: 'accepted', reviewedAt: '2026-09-19T07:00:00.000Z' },
    })
    expect(screen.getByTestId('attempt-pdf-download')).toHaveTextContent('Скачать PDF')
  })

  it('у преподавателя кнопка есть и до вердикта — он скачивает свой черновик', () => {
    renderOverlay({ pdfAudience: 'staff', pdfReport: REPORT })
    expect(screen.getByTestId('attempt-pdf-download')).toBeInTheDocument()
  })

  it('без данных разбора кнопки нет', () => {
    renderOverlay({ pdfAudience: 'staff' })
    expect(screen.queryByTestId('attempt-pdf-download')).toBeNull()
  })

  it('размечать нечего — кнопки нет: собирать не из чего', () => {
    renderOverlay({
      pdfAudience: 'staff',
      pdfReport: REPORT,
      files: [{ ...FILES[0], storage_path: 'a1/work.docx', file_name: 'work.docx', mime_type: null }],
    })
    expect(screen.queryByTestId('attempt-pdf-download')).toBeNull()
  })

  it('страницы ещё не загрузились — честная ошибка, а не пустой файл', async () => {
    toastError.mockClear()
    renderOverlay({ pdfAudience: 'staff', pdfReport: REPORT })
    fireEvent.click(screen.getByTestId('attempt-pdf-download'))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toContain('ещё не загрузились')
  })
})
