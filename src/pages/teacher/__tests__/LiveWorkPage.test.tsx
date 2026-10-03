import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §263. «Проверочная вживую» у учителя: шапка с таймером по серверу,
 * счётчики, фильтры, таблица, «Открыть заново»; после конца — итог. Чужая
 * работа (42501) — «нет доступа».
 */
const OPENS = '2026-10-03T05:45:00.000Z' // 08:45 МСК
const CLOSES = '2026-10-03T06:30:00.000Z' // 09:30 МСК
const clock = vi.hoisted(() => ({ now: 0 }))
const rpc = vi.hoisted(() => ({ data: null as unknown, error: null as null | { message: string } }))
const setPersonalWindow = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/lib/safeRpc', () => ({ safeRpc: vi.fn(async () => ({ data: rpc.data, error: rpc.error })) }))
vi.mock('@/hooks/useTimedWork', () => ({ useServerNow: () => clock.now, setPersonalWindow }))

import { LiveWorkPage } from '@/pages/teacher/LiveWorkPage'

const t = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(2026, 9, 3, h - 3, m)).toISOString()
}
const s = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  student_id: id, full_name: name, opened_at: null, attempt_status: null, submitted_at: null, auto_submitted: false,
  photos: 0, last_photo_at: null, away_count: 0, away_seconds: 0, window_opens_at: OPENS, window_closes_at: CLOSES, personal: false, ...over,
})
const LIVE = {
  homework_id: 'hw1', topic_id: 'tp1', course_id: 'c1', title: 'Движение по окружности', kind: 'check', group_name: '10А',
  opens_at: OPENS, closes_at: CLOSES, server_now: t('09:22'),
  students: [
    s('1', 'Шарипов К.', { opened_at: t('08:46'), attempt_status: 'submitted', submitted_at: t('09:21'), photos: 3, last_photo_at: t('09:20') }),
    s('2', 'Мурин А.', { opened_at: t('08:47'), attempt_status: 'draft', photos: 2, last_photo_at: t('09:19'), away_count: 2, away_seconds: 70 }),
    s('3', 'Гильфанов А.', { opened_at: t('08:48'), away_count: 5, away_seconds: 240 }),
    s('4', 'Мударисов Р.', { opened_at: t('08:47') }),
    s('5', 'Аминов А.'),
    s('6', 'Винокуров М.'),
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/live-work/hw1']}>
      <Routes><Route path="/live-work/:homeworkId" element={<LiveWorkPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('Проверочная вживую (§263)', () => {
  beforeEach(() => {
    rpc.data = LIVE
    rpc.error = null
    clock.now = Date.parse(t('09:22')) + 18_000 // 09:22:18 — до конца 07:42
    setPersonalWindow.mockClear()
  })

  it('идёт: шапка, таймер до конца, счётчики как в макете', async () => {
    renderPage()
    expect(await screen.findByTestId('live-work-title')).toHaveTextContent('Движение по окружности')
    expect(screen.getByTestId('live-work-head')).toHaveTextContent('Идёт проверочная · 10А')
    expect(screen.getByTestId('live-work-head')).toHaveTextContent('08:45–09:30 · условие открыто в 08:45')
    expect(screen.getByTestId('live-work-timer')).toHaveTextContent('07:42')
    expect(screen.getByTestId('live-count-opened')).toHaveTextContent('4пишут · открыли условие')
    expect(screen.getByTestId('live-count-nophoto')).toHaveTextContent('2без фото — в 09:30 работа не уйдёт')
    expect(screen.getByTestId('live-count-photos')).toHaveTextContent('1загрузили фото, не сдали')
    expect(screen.getByTestId('live-count-submitted')).toHaveTextContent('1сдали')
    expect(screen.getByTestId('live-count-notopened')).toHaveTextContent('2не открывали')
    expect(screen.getByTestId('live-work-note')).toHaveTextContent('каждые 15 секунд')
  })

  it('таблица: открыл условие, фото, последнее фото, уходы; «Открыть заново» — только у не открывавших', async () => {
    renderPage()
    const rows = await screen.findAllByTestId('live-work-row')
    expect(rows.map(r => r.getAttribute('data-status'))).toEqual(['submitted', 'photos', 'writing', 'writing', 'not_opened', 'not_opened'])
    const murin = rows[1]
    expect(murin).toHaveTextContent('Мурин А.')
    expect(murin).toHaveTextContent('фото есть')
    expect(murin).toHaveTextContent('08:47')
    expect(murin).toHaveTextContent('09:19')
    expect(within(murin).getByTestId('live-work-away')).toHaveTextContent('2 раза · 1 мин 10 с')
    expect(within(rows[2]).getByTestId('live-work-status')).toHaveTextContent('пишет, фото нет')
    expect(within(rows[2]).queryByTestId('live-work-reopen')).not.toBeInTheDocument()
    expect(within(rows[4]).getByTestId('live-work-reopen')).toHaveTextContent('Открыть заново')
  })

  it('фильтры «Без фото» / «Не открывали» / «Уходили со страницы» с числами', async () => {
    renderPage()
    await screen.findAllByTestId('live-work-row')
    const filters = screen.getByTestId('live-work-filters')
    expect(filters).toHaveTextContent('Без фото · 2')
    expect(filters).toHaveTextContent('Не открывали · 2')
    expect(filters).toHaveTextContent('Уходили со страницы · 2')
    fireEvent.click(within(filters).getByRole('button', { name: 'Без фото · 2' }))
    expect(screen.getAllByTestId('live-work-row').map(r => r.textContent)).toEqual([
      expect.stringContaining('Гильфанов А.'), expect.stringContaining('Мударисов Р.'),
    ])
    fireEvent.click(within(filters).getByRole('button', { name: 'Уходили со страницы · 2' }))
    expect(screen.getAllByTestId('live-work-row')).toHaveLength(2)
    expect(within(filters).getByRole('button', { name: 'Уходили со страницы · 2' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('«Открыть заново» — личное окно §240 ученику (дата и время по Москве, длительность — как у общего)', async () => {
    renderPage()
    const rows = await screen.findAllByTestId('live-work-row')
    fireEvent.click(within(rows[4]).getByTestId('live-work-reopen'))
    fireEvent.click(screen.getByTestId('live-work-reopen-save'))
    await vi.waitFor(() => expect(setPersonalWindow).toHaveBeenCalled())
    const [hw, student, opens, closes] = setPersonalWindow.mock.calls[0] as unknown as [string, string, string, string]
    expect([hw, student]).toEqual(['hw1', '5'])
    expect(Date.parse(closes) - Date.parse(opens)).toBe(45 * 60e3)
    expect(Date.parse(opens)).toBeGreaterThanOrEqual(clock.now)
  })

  it('после конца — итог: сдал сам / ушло автоматически / не писал; без таймера', async () => {
    rpc.data = {
      ...LIVE,
      students: [
        LIVE.students[0],
        { ...LIVE.students[1], attempt_status: 'submitted', auto_submitted: true, submitted_at: CLOSES },
        LIVE.students[2], LIVE.students[4],
      ],
    }
    clock.now = Date.parse(t('09:40'))
    renderPage()
    expect(await screen.findByTestId('live-work-head')).toHaveTextContent('Проверочная работа · итог · 10А')
    expect(screen.queryByTestId('live-work-timer')).not.toBeInTheDocument()
    expect(screen.getByTestId('live-work-counters')).toHaveAttribute('data-mode', 'after')
    expect(screen.getByTestId('live-count-self')).toHaveTextContent('1сдал сам')
    expect(screen.getByTestId('live-count-auto')).toHaveTextContent('1ушло автоматически')
    expect(screen.getByTestId('live-count-missed')).toHaveTextContent('2не писал или без фото')
    const statuses = screen.getAllByTestId('live-work-status').map(x => x.textContent)
    expect(statuses).toEqual(['сдал 09:21', 'ушло автоматически 09:30', 'не писал', 'открыл, не сдал'])
  })

  it('чужая работа (42501) — «нет доступа», данных нет', async () => {
    rpc.data = null
    rpc.error = { message: 'Нет прав на эту работу' }
    renderPage()
    expect(await screen.findByTestId('live-work-error')).toHaveTextContent('Нет доступа к этой работе')
  })
})
