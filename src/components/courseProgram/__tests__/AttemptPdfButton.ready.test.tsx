/**
 * §209.1. Кнопка «Скачать PDF» не отдаёт файл, пока работа открыта не вся.
 *
 * Тонкость, ради которой этот файл и заведён: фотографии работы появляются
 * в слепке сразу, а страницы PDF — через секунду-две, пока их читает движок.
 * В этот промежуток слепок выглядит совершенно исправным — просто в нём нет
 * половины работы. Проверка «есть хоть одна страница» такой файл пропускает,
 * и преподаватель уходит уверенный, что отправил всё. Пропажу обнаруживает
 * уже ученик, и доказать её нечем.
 *
 * Поэтому проверяется не «кнопка выключена», а поведение: при неготовом
 * слепке сборка не запускается вовсе и человек получает честное «подождите».
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { AttemptPdfReport } from '@/lib/attemptPdfReport'
import type { AttemptExportSnapshot } from '@/lib/attemptPdfSource'

const toastError = vi.fn()
vi.mock('@/store/toastStore', () => ({ toast: { error: (msg: string) => toastError(msg) } }))

const buildAttemptPdf = vi.fn(async () => new Blob(['pdf']))
const downloadBlob = vi.fn()
vi.mock('@/lib/attemptPdfRender', () => ({
  buildAttemptPdf: (...args: unknown[]) => buildAttemptPdf(...(args as [])),
  downloadBlob: (...args: unknown[]) => downloadBlob(...(args as [])),
}))

import { AttemptPdfButton } from '@/components/courseProgram/AttemptPdfButton'

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

function surface(globalPage: number) {
  return {
    globalPage,
    kind: 'image' as const,
    quarter: 0 as const,
    url: `signed://p${globalPage}.jpg`,
    page: 1,
    ratio: 0.7,
    pdf: null,
  }
}

function renderButton(snapshot: AttemptExportSnapshot) {
  const ref = { current: () => snapshot }
  render(<AttemptPdfButton audience="staff" report={REPORT} sourceRef={ref} />)
  return ref
}

describe('§209.1 — «Скачать PDF» ждёт, пока работа откроется целиком', () => {
  beforeEach(() => {
    toastError.mockClear()
    buildAttemptPdf.mockClear()
    downloadBlob.mockClear()
  })

  it('часть страниц ещё читается — сборка не запускается и человеку говорят подождать', async () => {
    // Ровно опасный случай: фотография уже есть, страницы PDF ещё нет.
    renderButton({ surfaces: [surface(1)], regions: [], ready: false })

    fireEvent.click(screen.getByTestId('attempt-pdf-download'))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0][0]).toContain('ещё не загрузились')
    expect(buildAttemptPdf).not.toHaveBeenCalled()
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('работа открыта целиком — файл собирается и скачивается', async () => {
    renderButton({ surfaces: [surface(1), surface(2)], regions: [], ready: true })

    fireEvent.click(screen.getByTestId('attempt-pdf-download'))

    await waitFor(() => expect(downloadBlob).toHaveBeenCalled())
    expect(buildAttemptPdf).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })
})
