import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * §263. Экран работы во время окна: предупреждение «Учитель видит, если ты
 * уходишь со страницы работы» (без счётчика уходов), зона условия — «свой»
 * уход; сдал — режим работы сайта перечитывается сразу.
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
const refreshWorkMode = vi.hoisted(() => vi.fn())
vi.mock('@/store/workModeStore', () => ({ refreshWorkMode }))
vi.mock('@/lib/imageCompression', () => ({ compressImageFile: async (f: File) => f }))

import { TopicTimedWorkStudent } from '@/components/courseProgram/TopicTimedWorkStudent'

const attempt = (over: Record<string, unknown> = {}) => ({
  id: 'att1', homework_id: 'hw1', student_id: 's1', attempt_number: 1, status: 'draft', submitted_at: null,
  auto_submitted: false, created_at: OPENS, updated_at: OPENS, ...over,
})
const photo = (n: number) => ({ id: `f${n}`, attempt_id: 'att1', storage_path: `att1/p${n}.jpg`, file_name: `p${n}.jpg`, mime_type: 'image/jpeg', size_bytes: 1, position: n, created_at: OPENS })

function renderAt(iso: string) {
  clock.now = Date.parse(iso)
  return render(<TopicTimedWorkStudent topicId="t1" kind="check" />)
}

describe('Работа по времени: режим работы (§263)', () => {
  beforeEach(() => {
    hw.attempts = []
    hw.attemptFiles = []
    submitAttempt.mockClear()
    refreshWorkMode.mockClear()
  })

  it('идёт: предупреждение без счётчика; зона условия помечена как «свой» уход', () => {
    renderAt('2026-10-02T07:10:00.000Z')
    const notice = screen.getByTestId('work-mode-notice')
    expect(notice).toHaveTextContent('Пока идёт работа, остальной сайт закрыт. Учитель видит, если ты уходишь со страницы работы.')
    expect(notice.textContent).not.toMatch(/\d/)
    expect(screen.getByTestId('timed-condition')).toHaveAttribute('data-away-ok')
  })

  it('до начала — предупреждения нет', () => {
    renderAt('2026-10-01T07:10:00.000Z')
    expect(screen.queryByTestId('work-mode-notice')).not.toBeInTheDocument()
  })

  it('сдал — режим работы перечитан сразу', async () => {
    hw.attempts = [attempt()]
    hw.attemptFiles = [photo(1)]
    renderAt('2026-10-02T07:30:00.000Z')
    fireEvent.click(screen.getByTestId('timed-submit'))
    await act(async () => { fireEvent.click(screen.getByTestId('timed-submit-yes')) })
    expect(submitAttempt).toHaveBeenCalledWith('att1')
    expect(refreshWorkMode).toHaveBeenCalled()
  })

  it('окно закрылось, пока экран открыт, — режим перечитан', () => {
    const view = renderAt('2026-10-02T07:44:59.000Z')
    expect(refreshWorkMode).not.toHaveBeenCalled()
    clock.now = Date.parse('2026-10-02T07:46:00.000Z')
    view.rerender(<TopicTimedWorkStudent topicId="t1" kind="check" />)
    expect(screen.getByTestId('timed-work')).toHaveAttribute('data-phase', 'missed')
    expect(refreshWorkMode).toHaveBeenCalled()
  })
})
