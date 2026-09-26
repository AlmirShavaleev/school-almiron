/**
 * §229. Ученик пишет (экран 6 макета): задания видны на странице — страницы
 * условия своего варианта с листанием; на телефоне вкладки «Задания / Бланк /
 * Фото · N»; таймер с «Вариант N»; «Сдать работу» — окно на весь экран
 * (role=dialog, aria-modal, Esc, фокус); PDF вместо фото — плитка «PDF · N стр.»;
 * фото, которое не открылось, окно сдачи называет.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useEffect } from 'react'

const EXAM = 'e0000000-0000-0000-0000-000000000007'
const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()
let examState: Record<string, unknown>
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []

function state(over: Record<string, unknown> = {}) {
  return {
    id: EXAM, title: 'Пробник №4', group_id: 'g1', student_id: 's1', template_title: 'ЕГЭ', task_count: 19, part1_last: 12,
    part2_max: [2, 3, 2, 2, 3, 4, 4],
    starts_at: iso(now - 3600_000), ends_at: iso(now + 72 * 60_000 + 30_000), photos_until: iso(now + 87 * 60_000),
    server_now: iso(now), condition_path: `${EXAM}/v2/condition/1_var2.pdf`,
    answers: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    submitted_at: null, updated_at: iso(now - 60_000), notified: false, photos: [],
    variant: { position: 2, label: null }, variant_count: 3,
    ...over,
  }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'my_mock_exam') return Promise.resolve({ data: examState, error: null })
      if (fn === 'submit_mock_exam') return Promise.resolve({ data: { submitted_at: iso(Date.now()) }, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://x/y' }, error: null }) }) },
  },
}))
vi.mock('@/hooks/useSignedPdf', () => ({
  useSignedPdf: (_b: string, path: string | null) => (path ? { status: 'ready', doc: { numPages: 3 }, pages: 3 } : { status: 'idle', doc: null, pages: 0 }),
}))
vi.mock('@/components/pdf/PdfPageView', () => ({
  PdfPageView: ({ page }: { page: number }) => <div data-testid="pdf-page-view" data-page={page} />,
}))
// Картинка «не открылась», если в пути есть broken — как битый файл или HEIC в Chrome.
vi.mock('@/components/ui/SignedImage', () => ({
  SignedImage: ({ path, onFailed }: { path: string; onFailed?: () => void }) => {
    useEffect(() => { if (path.includes('broken')) onFailed?.() }, [path, onFailed])
    return <img alt="" data-path={path} />
  },
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
  rpcCalls.length = 0
})

describe('ученик пишет', () => {
  it('таймер с «Вариант 2»; задания — страницами своего варианта, листаются', async () => {
    mount()
    expect(await screen.findByTestId('mock-lesson-timer-meta')).toHaveTextContent('Пробник №4 · Вариант 2 · до')
    expect(screen.getByTestId('mock-lesson-tasks')).toHaveTextContent('Задания · Вариант 2')
    expect(screen.getByTestId('mock-lesson-page-no')).toHaveTextContent('стр. 1 из 3')
    fireEvent.click(screen.getByTestId('mock-lesson-page-next'))
    expect(screen.getByTestId('mock-lesson-page-no')).toHaveTextContent('стр. 2 из 3')
    expect(screen.getByTestId('pdf-page-view')).toHaveAttribute('data-page', '2')
    // Ссылка «Открыть PDF» — всегда.
    expect(screen.getByTestId('mock-lesson-condition')).toBeInTheDocument()
  })

  it('телефон: вкладки «Задания / Бланк / Фото · N»; невыбранные спрятаны (на ноутбуке видны все)', async () => {
    examState = state({ photos: [{ id: 'p1', storage_path: `${EXAM}/photos/s1/1_a.webp`, file_name: 'a.webp', mime_type: 'image/webp', size_bytes: 1, position: 0, created_at: iso(now) }] })
    mount()
    const tabs = await screen.findByTestId('mock-lesson-tabs')
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['Задания', 'Бланк', 'Фото · 1'])
    expect(within(tabs).getByRole('tab', { name: 'Задания' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('mock-lesson-tasks-panel').className).not.toMatch(/(^| )hidden( |$)/)
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Бланк' }))
    expect(screen.getByTestId('mock-lesson-tasks-panel').className).toMatch(/(^| )hidden( |$)/)
    expect(screen.getByTestId('mock-lesson-tasks-panel').className).toContain('lg:block')
    // Бланк не пересоздаётся: поля на месте.
    expect(screen.getAllByTestId('mock-lesson-answer')).toHaveLength(12)
  })

  it('«Сдать работу» — окно: «Закончить раньше времени?», сколько осталось, итог, фокус на «Вернуться», Esc закрывает', async () => {
    mount()
    const btn = await screen.findByTestId('mock-lesson-submit')
    btn.focus()
    fireEvent.click(btn)
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('Закончить пробник раньше времени?')
    expect(dlg).toHaveTextContent('До конца ещё 1 ч 12 мин')
    expect(dlg).toHaveTextContent('Бланк: 12 из 12')
    expect(dlg).toHaveTextContent('Фото второй части: нет')
    expect(dlg).toHaveTextContent('Пустых ответов нет. Фото второй части нет — номера 13–19 останутся без баллов.')
    expect(screen.getByTestId('mock-lesson-submit-back')).toHaveFocus()
    fireEvent.keyDown(dlg, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(btn).toHaveFocus()
    expect(rpcCalls.some(c => c.fn === 'submit_mock_exam')).toBe(false)
    // Прежнего встроенного блока подтверждения нет.
    expect(screen.queryByText('Сдать сейчас?')).toBeNull()
  })

  it('время почти вышло — «Сдать работу?»; «Да, сдать работу» сдаёт и закрывает окно', async () => {
    examState = state({ ends_at: iso(now + 30_000) })
    mount()
    fireEvent.click(await screen.findByTestId('mock-lesson-submit'))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Сдать работу?')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-lesson-submit-yes')) })
    await waitFor(() => expect(rpcCalls.some(c => c.fn === 'submit_mock_exam')).toBe(true))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('PDF во второй части — плитка «PDF · 3 стр.», не битая картинка; фото, которое не открылось, окно сдачи называет', async () => {
    examState = state({
      photos: [
        { id: 'p1', storage_path: `${EXAM}/photos/s1/1_scan.pdf`, file_name: 'scan.pdf', mime_type: 'application/pdf', size_bytes: 1, position: 0, created_at: iso(now) },
        { id: 'p2', storage_path: `${EXAM}/photos/s1/2_broken.jpg`, file_name: 'broken.jpg', mime_type: 'image/jpeg', size_bytes: 1, position: 1, created_at: iso(now) },
      ],
    })
    mount()
    const tile = await screen.findByTestId('mock-lesson-pdf-tile')
    expect(tile).toHaveTextContent('PDF')
    expect(tile).toHaveTextContent('3 стр.')
    expect(screen.getByTestId('mock-lesson-thumbs')).toHaveTextContent('файл 1 · PDF')
    fireEvent.click(screen.getByTestId('mock-lesson-submit'))
    await waitFor(() => expect(screen.getByTestId('mock-lesson-confirm-broken')).toHaveTextContent('Фото 2 не открывается — переснимите или загрузите JPG'))
    expect(screen.getByRole('dialog')).toHaveTextContent('Фото второй части: 2')
  })

  it('один вариант — «Вариант 1» нигде не пишется', async () => {
    examState = state({ variant: { position: 1, label: null }, variant_count: 1 })
    mount()
    expect(await screen.findByTestId('mock-lesson-timer-meta')).not.toHaveTextContent('Вариант')
    expect(screen.getByTestId('mock-lesson-tasks')).toHaveTextContent(/^Задания/)
  })
})
