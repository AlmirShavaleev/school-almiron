import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §240. Пять состояний ученического экрана проверочной/контрольной — по
 * СЕРВЕРНОМУ времени (useServerNow подменён). Кнопки сдачи вне окна нет;
 * после проверки — разбор без пересдачи, решение и критерии.
 */

const OPENS = '2026-10-02T07:00:00.000Z' // 10:00 МСК
const CLOSES = '2026-10-02T07:45:00.000Z' // 10:45 МСК
const clock = { now: Date.parse(OPENS) }

const hw = {
  homework: { id: 'hw1', topic_id: 't1', title: 'Контрольная работа', instructions: null, is_published: true, due_at: null, grade_scale: 'five', opens_at: OPENS, closes_at: CLOSES },
  files: [] as any[],
  attempts: [] as any[],
  attemptFiles: [] as any[],
  reviews: [] as any[],
}
const startAttempt = vi.fn(async () => 'att-new')
const uploadAttemptFiles = vi.fn(async () => [])
const submitAttempt = vi.fn(async () => {})

vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    ...hw, loading: false, error: null, reload: vi.fn(),
    startAttempt, uploadAttemptFiles, submitAttempt,
    removeAttemptFile: vi.fn(), reorderAttemptFiles: vi.fn(),
  }),
}))
vi.mock('@/hooks/useTimedWork', () => ({
  useMyTimedWindow: (_id: string | null, fallback: { opensAt: string | null; closesAt: string | null }) => ({
    window: { ...fallback, personal: false }, offsetMs: 0, reload: vi.fn(),
  }),
  useServerNow: () => clock.now,
}))
vi.mock('@/hooks/useHomeworkReviewTasks', () => ({ useReviewTasksOfAttempts: () => [] }))
vi.mock('@/store/staffModeStore', () => ({ usePreviewMode: () => false, PREVIEW_NOOP_MESSAGE: 'Предпросмотр' }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({
  TopicMaterialItems: ({ section }: { section: string }) => <div data-testid={`materials-${section}`} />,
}))
const feedbackProps = vi.fn()
vi.mock('@/components/courseProgram/AttemptFeedback', () => ({
  AttemptFeedback: (props: any) => { feedbackProps(props); return <div data-testid="attempt-feedback" /> },
}))
vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', () => ({ AttemptAnnotationOverlay: () => null }))
vi.mock('@/lib/imageCompression', () => ({ compressImageFile: async (f: File) => f }))

import { TopicTimedWorkStudent } from '@/components/courseProgram/TopicTimedWorkStudent'

const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'att1', homework_id: 'hw1', student_id: 's1', attempt_number: 1, status: 'draft', submitted_at: null,
  auto_submitted: false, created_at: OPENS, updated_at: OPENS, ...over,
})
const photo = (n: number) => ({ id: `f${n}`, attempt_id: 'att1', storage_path: `att1/p${n}.jpg`, file_name: `p${n}.jpg`, mime_type: 'image/jpeg', size_bytes: 1, position: n, created_at: OPENS })

function renderAt(iso: string, onOpenSection = vi.fn()) {
  clock.now = Date.parse(iso)
  render(<TopicTimedWorkStudent topicId="t1" kind="control" onOpenSection={onOpenSection} />)
  return { onOpenSection }
}

describe('Работа по времени глазами ученика (§240)', () => {
  beforeEach(() => {
    hw.attempts = []
    hw.attemptFiles = []
    hw.reviews = []
    hw.homework.opens_at = OPENS
    hw.homework.closes_at = CLOSES
    startAttempt.mockClear(); uploadAttemptFiles.mockClear(); submitAttempt.mockClear(); feedbackProps.mockClear()
  })

  it('до начала: отсчёт, окно по Москве, условие под замком, сдавать нечем', () => {
    renderAt('2026-10-01T03:47:20.000Z')
    expect(screen.getByTestId('timed-work')).toHaveAttribute('data-phase', 'before')
    expect(screen.getByTestId('timed-countdown')).toHaveTextContent('1 д 03:12:40')
    expect(screen.getByTestId('timed-before')).toHaveTextContent('10:45')
    expect(screen.getByTestId('timed-lock-condition')).toHaveTextContent('откроется')
    expect(screen.queryByTestId('materials-worksheet_homework')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timed-submit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timed-gallery-input')).not.toBeInTheDocument()
  })

  it('идёт: таймер от сервера, условие, фото; «Сдать» выключена, пока фото нет', () => {
    renderAt('2026-10-02T07:12:46.000Z')
    expect(screen.getByTestId('timed-timer')).toHaveTextContent('32:14')
    expect(screen.getByTestId('timed-timer')).toHaveAttribute('data-warn', 'false')
    expect(screen.getByTestId('timed-timer')).toHaveTextContent('закроется в 10:45')
    expect(screen.getByTestId('materials-worksheet_homework')).toBeInTheDocument()
    expect(screen.getByTestId('timed-submit')).toBeDisabled()
  })

  it('за 5 минут до конца таймер красный', () => {
    renderAt('2026-10-02T07:41:00.000Z')
    expect(screen.getByTestId('timed-timer')).toHaveAttribute('data-warn', 'true')
  })

  it('первое фото само начинает попытку и уходит в неё', async () => {
    renderAt('2026-10-02T07:10:00.000Z')
    const file = new File([new Uint8Array(4)], 'p1.jpg', { type: 'image/jpeg' })
    await act(async () => {
      fireEvent.change(screen.getByTestId('timed-gallery-input'), { target: { files: [file] } })
    })
    await waitFor(() => expect(uploadAttemptFiles).toHaveBeenCalled())
    expect(startAttempt).toHaveBeenCalledTimes(1)
    expect((uploadAttemptFiles.mock.calls[0] as unknown[])[0]).toBe('att-new')
  })

  it('«Сдать работу» — с подтверждением, одна попытка', async () => {
    hw.attempts = [attempt()]
    hw.attemptFiles = [photo(1), photo(2)]
    renderAt('2026-10-02T07:30:00.000Z')
    fireEvent.click(screen.getByTestId('timed-submit'))
    expect(screen.getByTestId('timed-submit-confirm')).toHaveTextContent('Изменить работу после сдачи будет нельзя')
    await act(async () => { fireEvent.click(screen.getByTestId('timed-submit-yes')) })
    expect(submitAttempt).toHaveBeenCalledWith('att1')
  })

  it('окно закрылось с фото в черновике — «сдаётся автоматически», кнопки нет', () => {
    hw.attempts = [attempt()]
    hw.attemptFiles = [photo(1)]
    renderAt('2026-10-02T07:45:20.000Z')
    expect(screen.getByTestId('timed-sent')).toHaveTextContent('Сдаётся автоматически в 10:45')
    expect(screen.queryByTestId('timed-submit')).not.toBeInTheDocument()
  })

  it('время вышло без фото — «не сдано», кнопки сдачи нет', () => {
    renderAt('2026-10-02T08:00:00.000Z')
    expect(screen.getByTestId('timed-missed')).toHaveTextContent('фото не было загружено до 10:45')
    expect(screen.queryByTestId('timed-submit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('timed-gallery-input')).not.toBeInTheDocument()
  })

  it('сдано автоматически — время закрытия; решение и критерии под замком', () => {
    hw.attempts = [attempt({ status: 'submitted', submitted_at: CLOSES, auto_submitted: true })]
    renderAt('2026-10-02T09:00:00.000Z')
    expect(screen.getByTestId('timed-sent')).toHaveTextContent('Сдано автоматически в 10:45')
    expect(screen.getByTestId('timed-lock-solution')).toHaveTextContent('откроются после проверки')
  })

  it('проверено: разбор без пересдачи, решение и критерии открываются', () => {
    hw.attempts = [attempt({ status: 'accepted', submitted_at: '2026-10-02T07:41:00.000Z' })]
    const { onOpenSection } = renderAt('2026-10-03T09:00:00.000Z')
    expect(screen.getByTestId('timed-done')).toHaveTextContent('сдано в 10:41')
    expect(screen.getByTestId('attempt-feedback')).toBeInTheDocument()
    expect(feedbackProps.mock.calls[0][0].resubmit).toBeNull()
    fireEvent.click(screen.getByTestId('timed-open-criteria'))
    expect(onOpenSection).toHaveBeenCalledWith('criteria')
    fireEvent.click(screen.getByTestId('timed-open-solution'))
    expect(onOpenSection).toHaveBeenCalledWith('solution')
  })

  it('окно не назначено — «время не назначено», начать нельзя', () => {
    hw.homework.opens_at = null as unknown as string
    hw.homework.closes_at = null as unknown as string
    renderAt('2026-10-02T07:10:00.000Z')
    expect(screen.getByTestId('timed-unscheduled')).toBeInTheDocument()
    expect(screen.queryByTestId('timed-submit')).not.toBeInTheDocument()
  })
})
