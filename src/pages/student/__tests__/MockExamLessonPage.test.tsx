import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §221. Пробник у ученика: экран верит базе, а не часам устройства.
 * Проверяем последствия — что показано и что ушло в базу, а не текст кода.
 */

const EXAM = 'e0000000-0000-0000-0000-000000000003'
const STUDENT = 's0000000-0000-0000-0000-000000000051'
const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()

let examState: Record<string, unknown>
let resultState: Record<string, unknown>
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
const storageUploads: string[] = []
const confirmSpy = vi.fn(() => true)

function state(over: Record<string, unknown> = {}) {
  return {
    id: EXAM, title: 'Пробник №3', group_id: 'g1', student_id: STUDENT, template_title: 'ЕГЭ математика, профиль',
    task_count: 19, part1_last: 12, part2_max: [2, 3, 2, 2, 3, 4, 4],
    starts_at: iso(now - 3600_000), ends_at: iso(now + 3 * 3600_000), photos_until: iso(now + 3 * 3600_000 + 15 * 60_000),
    server_now: iso(now), condition_path: `${EXAM}/condition/1_v3.pdf`,
    answers: ['12', '0,75', '-3', '49', '0,2', '6', '27', '5', null, '144', '0,35', '4'],
    submitted_at: null, updated_at: iso(now - 60_000), notified: false, photos: [],
    ...over,
  }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'my_mock_exam') return Promise.resolve({ data: examState, error: null })
      if (fn === 'my_mock_exam_result') return Promise.resolve({ data: resultState, error: null })
      if (fn === 'save_mock_exam_answer') return Promise.resolve({ data: { task: args.p_task, answer: args.p_answer, saved_at: iso(Date.now()) }, error: null })
      if (fn === 'submit_mock_exam') return Promise.resolve({ data: { submitted_at: iso(Date.now()) }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    storage: {
      from: () => ({
        createSignedUploadUrl: () => Promise.resolve({ data: null, error: { message: 'no' } }),
        upload: (path: string) => { storageUploads.push(path); return Promise.resolve({ error: null }) },
        remove: () => Promise.resolve({ error: null }),
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://x/y' }, error: null }),
      }),
    },
  },
}))

vi.mock('@/lib/imageCompression', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/imageCompression')>()),
  compressImageFile: async (file: File) => file,
}))

import { MockExamLessonPage } from '@/pages/student/MockExamLessonPage'

function mount() {
  return render(
    <MemoryRouter initialEntries={[`/my-course/g1/mock/${EXAM}`]}>
      <Routes><Route path="/my-course/:groupId/mock/:examId" element={<MockExamLessonPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  examState = state()
  resultState = { status: 'pending' }
  rpcCalls.length = 0
  storageUploads.length = 0
  confirmSpy.mockClear()
  window.confirm = confirmSpy
})

describe('до начала', () => {
  it('ни условия, ни бланка, ни загрузки — только когда откроется', async () => {
    examState = state({ starts_at: iso(now + 3600_000), ends_at: iso(now + 5 * 3600_000), photos_until: iso(now + 5 * 3600_000 + 900_000), condition_path: null, answers: [] })
    mount()
    await waitFor(() => expect(screen.getByTestId('mock-lesson-upcoming')).toBeInTheDocument())
    expect(screen.getByText(/Откроется/)).toBeInTheDocument()
    expect(screen.queryByTestId('mock-lesson-sheet')).toBeNull()
    expect(screen.queryByTestId('mock-lesson-condition')).toBeNull()
    expect(screen.queryByTestId('mock-lesson-photos')).toBeNull()
  })

  it('часы устройства ушли вперёд — экран всё равно «до начала»: считает от часов базы', async () => {
    // База говорит «сейчас» = now, начало через час; телефон думает, что уже +2 ч.
    examState = state({ starts_at: iso(now + 3600_000), ends_at: iso(now + 5 * 3600_000), photos_until: iso(now + 5 * 3600_000 + 900_000), condition_path: null, answers: [] })
    const realNow = Date.now
    Date.now = () => realNow() + 2 * 3600_000
    try {
      mount()
      await waitFor(() => expect(screen.getByTestId('mock-lesson-page')).toHaveAttribute('data-status', 'upcoming'))
    } finally {
      Date.now = realNow
    }
  })
})

describe('во время', () => {
  it('бланк на 12 полей первой части, условие по ссылке', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByTestId('mock-lesson-answer')).toHaveLength(12))
    expect(screen.getByTestId('mock-lesson-condition')).toBeInTheDocument()
    expect(screen.getByTestId('mock-lesson-clock').textContent).toMatch(/^[23]:\d\d:\d\d$/)
  })

  it('ответ сохраняется сам — одним полем', async () => {
    mount()
    const inputs = await screen.findAllByTestId('mock-lesson-answer')
    fireEvent.change(inputs[8], { target: { value: '3' } })
    fireEvent.blur(inputs[8])
    await waitFor(() => expect(rpcCalls.some(c => c.fn === 'save_mock_exam_answer' && c.args.p_task === 9 && c.args.p_answer === '3')).toBe(true))
  })

  it('сдача — подтверждение внутри страницы с пустыми номерами, без confirm()', async () => {
    mount()
    fireEvent.click(await screen.findByTestId('mock-lesson-submit'))
    const box = screen.getByTestId('mock-lesson-confirm')
    expect(box).toHaveTextContent('Заполнено 11 ответов из 12')
    expect(box).toHaveTextContent('Пустой ответ №9 засчитается как нерешённый')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(rpcCalls.some(c => c.fn === 'submit_mock_exam')).toBe(false)
    await act(async () => { fireEvent.click(screen.getByTestId('mock-lesson-submit-yes')) })
    await waitFor(() => expect(rpcCalls.some(c => c.fn === 'submit_mock_exam')).toBe(true))
  })

  it('.dng отклоняется при выборе с подсказкой про RAW — в хранилище ничего не ушло', async () => {
    mount()
    const input = await screen.findByTestId('mock-lesson-file-input')
    const dng = new File(['raw'], 'IMG_0001.DNG', { type: 'image/x-adobe-dng' })
    await act(async () => { fireEvent.change(input, { target: { files: [dng] } }) })
    await waitFor(() => expect(screen.getByTestId('mock-lesson-rejected')).toHaveTextContent(/IMG_0001\.DNG.*Выключи RAW/))
    expect(storageUploads).toEqual([])
    expect(rpcCalls.some(c => c.fn === 'add_mock_exam_photo')).toBe(false)
    // Подсказка есть и до ошибки — прямо над загрузкой.
    expect(screen.getByTestId('mock-lesson-photos')).toHaveTextContent('не ProRAW')
  })
})

describe('после сдачи', () => {
  it('бланк закрыт, фото ещё можно, кнопки «Сдать» нет', async () => {
    examState = state({ submitted_at: iso(now - 600_000) })
    mount()
    await waitFor(() => expect(screen.getByTestId('mock-lesson-closed')).toHaveTextContent('Работа сдана'))
    for (const i of screen.getAllByTestId('mock-lesson-answer')) expect(i).toBeDisabled()
    expect(screen.getByTestId('mock-lesson-drop')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-lesson-submit')).toBeNull()
  })
})

describe('результат', () => {
  it('до «Уведомить» функцию результата не зовём и ничего не показываем — «на проверке»', async () => {
    examState = state({ starts_at: iso(now - 6 * 3600_000), ends_at: iso(now - 2 * 3600_000), photos_until: iso(now - 105 * 60_000), submitted_at: iso(now - 3 * 3600_000) })
    mount()
    await waitFor(() => expect(screen.getByTestId('mock-lesson-checking')).toHaveTextContent('На проверке'))
    expect(screen.queryByTestId('mock-lesson-result')).toBeNull()
    expect(rpcCalls.some(c => c.fn === 'my_mock_exam_result')).toBe(false)
  })

  it('после — ответы рядом с верными, баллы второй части, решение', async () => {
    examState = state({ starts_at: iso(now - 30 * 3600_000), ends_at: iso(now - 26 * 3600_000), photos_until: iso(now - 25 * 3600_000), submitted_at: iso(now - 27 * 3600_000), notified: true })
    resultState = {
      status: 'ready', title: 'Пробник №3', notified_at: iso(now - 3600_000), score: 18, max_score: 32,
      primary_score: 18, part1_score: 10, part2_score: 8, part1_last: 12, solution_path: `${EXAM}/solution/1_s.pdf`,
      tasks: [
        ...Array.from({ length: 12 }, (_, i) => ({ n: i + 1, max: 1, points: i === 8 || i === 10 ? 0 : 1, answer: i === 8 ? null : String(i), correct: String(i) })),
        ...[2, 3, 2, 2, 3, 4, 4].map((m, k) => ({ n: 13 + k, max: m, points: [2, 1, 2, 2, 1, 0, 0][k], answer: null, correct: null })),
      ],
    }
    mount()
    await waitFor(() => expect(screen.getByTestId('mock-lesson-result')).toBeInTheDocument())
    // §228: итог крупно (без таблицы перевода — первичный) и строка «первичный · части».
    expect(screen.getByTestId('mock-lesson-big')).toHaveTextContent('18')
    expect(screen.getByTestId('mock-lesson-primary')).toHaveTextContent('Первичный 18 из 32 · часть 1: 10 из 12 · часть 2: 8 из 20')
    // «По номерам» — метки формой: 12 + 7 номеров; №9 и №11 — ноль, №18 — ноль, №14 — частично.
    const marks = screen.getByTestId('mock-lesson-marks').querySelectorAll('[data-mark]')
    expect(marks).toHaveLength(19)
    expect(marks[8].getAttribute('data-mark')).toBe('bad')
    expect(marks[13].getAttribute('data-mark')).toBe('part')
    expect(marks[12].getAttribute('data-mark')).toBe('ok')
    expect(screen.getByTestId('mock-lesson-part1').querySelectorAll('tbody tr')).toHaveLength(12)
    expect(screen.getByTestId('mock-lesson-part2').querySelectorAll('tbody tr')).toHaveLength(7)
    expect(screen.getByTestId('mock-lesson-solution')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-lesson-sheet')).toBeNull()
  })
})
