import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * §243. «Тема открыта = ДЗ выдано»: в окне темы вместо «Черновик /
 * Опубликовано» и кнопки «Опубликовать» — статус выдачи по открытости темы и
 * строка «Сводка ученикам уйдёт в HH:MM», если кому-то сообщение ещё не ушло.
 * Флаг выдачи клиент не пишет вовсе.
 */

const state = { homework: null as any, files: [] as any[] }
const updateHomework = vi.fn(async () => {})
const rpc = vi.fn(async (..._a: unknown[]): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => { const c: any = {}; for (const m of ['select', 'eq', 'in', 'order']) c[m] = () => c; c.then = (f: any) => Promise.resolve({ data: [], error: null }).then(f); return c },
    rpc: (...args: unknown[]) => rpc(...(args as [])),
  },
}))
vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework: state.homework, files: state.files, loading: false, error: null,
    createHomework: vi.fn(), updateHomework,
    uploadHomeworkFile: vi.fn(), deleteHomeworkFile: vi.fn(),
    notifyStudents: vi.fn(), loadNotifyTargets: vi.fn().mockResolvedValue([]),
  }),
}))
vi.mock('@/store/toastStore', () => ({ toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { TopicHomeworkEditor } from '@/components/courseProgram/TopicHomeworkEditor'

const HW = { id: 'hw-1', topic_id: 't1', title: 'Домашнее задание', instructions: null, is_published: true, due_at: null, grade_scale: 'five', created_by: 'u', created_at: '', updated_at: '' }
const FILE = { id: 'f1', homework_id: 'hw-1', storage_path: 't1/a.pdf', original_filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10, position: 0, created_at: '' }

describe('Статус выдачи ДЗ в окне темы (§243)', () => {
  beforeEach(() => {
    // Только Date: «сегодня» — 5 октября, 13:00 по Москве; таймеры настоящие.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T10:00:00.000Z'))
    state.homework = { ...HW }
    state.files = [FILE]
    updateHomework.mockClear()
    rpc.mockReset().mockResolvedValue({ data: { pending: 0, due_at: null }, error: null })
  })
  afterEach(() => { vi.useRealTimers() })

  it('тема открыта и есть файл — «Выдано · тема открыта», кнопок публикации нет', () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} />)
    expect(screen.getByTestId('homework-issue-state')).toHaveTextContent('Выдано · тема открыта')
    expect(screen.queryByRole('button', { name: /Опубликовать|Снять с публикации/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Черновик')).not.toBeInTheDocument()
    // «Напомнить ученикам» (§75) остаётся у выданного ДЗ.
    expect(screen.getByText('Оповестить в Telegram')).toBeInTheDocument()
  })

  it('тема закрыта, открывается датой — «Не выдано · тема закрыта» и «откроется 6 октября»', () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={null} availableFrom="2026-10-06" />)
    const issue = screen.getByTestId('homework-issue')
    expect(issue).toHaveTextContent('Не выдано · тема закрыта')
    expect(issue).toHaveTextContent('откроется 6 октября')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('тема закрыта тумблером — без даты открытия; оповещения нет', () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={false} availableFrom="2026-10-06" />)
    const issue = screen.getByTestId('homework-issue')
    expect(issue).toHaveTextContent('Не выдано · тема закрыта')
    expect(issue).not.toHaveTextContent('откроется')
    expect(screen.queryByText('Оповестить в Telegram')).not.toBeInTheDocument()
  })

  it('тема открыта, файлов нет — «Нет файлов задания» и подсказка', () => {
    state.files = []
    state.homework = { ...HW, is_published: false }
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} />)
    const issue = screen.getByTestId('homework-issue')
    expect(issue).toHaveTextContent('Нет файлов задания')
    expect(issue).toHaveTextContent('ученик увидит ДЗ, когда добавишь файл')
  })

  it('ждёт отправки — «Сводка ученикам уйдёт в 14:55» по серверному времени', async () => {
    rpc.mockResolvedValue({ data: { pending: 3, due_at: '2026-10-05T11:55:00.000Z' }, error: null })
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} />)
    expect(await screen.findByTestId('homework-digest-eta')).toHaveTextContent('Сводка ученикам уйдёт в 14:55')
    expect(rpc).toHaveBeenCalledWith('topic_homework_digest_eta', { p_homework_id: 'hw-1' })
  })

  it('ночью копится до утра — «завтра в 08:00»', async () => {
    rpc.mockResolvedValue({ data: { pending: 1, due_at: '2026-10-06T05:00:00.000Z' }, error: null })
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} />)
    expect(await screen.findByTestId('homework-digest-eta')).toHaveTextContent('Сводка ученикам уйдёт завтра в 08:00')
  })

  it('всем уже ушло — строки про сводку нет', async () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} />)
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(screen.queryByTestId('homework-digest-eta')).not.toBeInTheDocument()
  })

  it('каркас — «Шаблон · ДЗ выдаётся в классах», сводку не спрашиваем', () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} isTemplate />)
    expect(screen.getByTestId('homework-issue-state')).toHaveTextContent('Шаблон · ДЗ выдаётся в классах')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('клиент флаг выдачи не пишет ни при каком статусе', () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={false} />)
    expect(updateHomework).not.toHaveBeenCalled()
  })
})
