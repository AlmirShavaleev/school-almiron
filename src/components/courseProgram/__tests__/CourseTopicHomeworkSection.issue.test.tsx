import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * §243. Раздел «Домашние задания» программы курса остаётся (модули → темы с
 * тумблером, ученики, статусы работ), но массовой публикации больше нет: ни
 * «Опубликовать всё ДЗ курса», ни «Опубликовать ДЗ · N» у модуля, ни плашки
 * «Не опубликовано ДЗ: N». ДЗ выдаётся само, пока тема открыта; у темы —
 * статус выдачи тем же правилом, что у сервера. (Было §116 — массовая
 * публикация; файл теста переименован из `.publish`.)
 */

const updateSpy = vi.fn()

const MODULES = [{
  id: 'mod-1',
  title: 'Механика',
  topics: [
    { id: 't1', title: 'Кинематика', is_open: true, available_from: null },
    { id: 't2', title: 'Динамика', is_open: null, available_from: '2026-10-06' },
    { id: 't3', title: 'Статика', is_open: true, available_from: null },
    { id: 't4', title: 'Контрольная', is_open: true, available_from: null, kind: 'control' },
    { id: 't5', title: 'Давление', is_open: false, available_from: '2026-10-06' },
  ],
}]

const ROSTER = [{ student_id: 's1', students: { id: 's1', profiles: { full_name: 'Ученик' } } }]

let homeworks: any[] = []
let files: any[] = []

function selectChain(rows: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'group_students') return selectChain(ROSTER)
      if (table === 'topic_homework_files') return selectChain(files)
      if (table === 'topic_homework_attempts') return selectChain([])
      if (table === 'topic_homework') {
        const c: any = selectChain(homeworks)
        c.update = (patch: unknown) => { updateSpy(patch); return selectChain([]) }
        return c
      }
      return selectChain([])
    },
  },
}))

vi.mock('@/store/toastStore', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), saved: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/components/courseProgram/TopicOpenToggle', () => ({ TopicOpenToggle: () => null }))

import { CourseTopicHomeworkSection } from '@/components/courseProgram/CourseTopicHomeworkSection'

function issueOf(topicTitle: string) {
  const row = screen.getByText(topicTitle).closest('[data-hw-topic]') as HTMLElement
  return row.querySelector('[data-testid="hw-section-issue"]') as HTMLElement
}

describe('Раздел «Домашние задания» без публикации (§243)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T10:00:00.000Z'))
    updateSpy.mockReset()
    homeworks = [
      { id: 'h1', topic_id: 't1', title: 'ДЗ 1', grade_scale: 'five', is_published: true },
      { id: 'h2', topic_id: 't2', title: 'ДЗ 2', grade_scale: 'five', is_published: false },
      { id: 'h3', topic_id: 't3', title: 'ДЗ 3', grade_scale: 'five', is_published: false },
      { id: 'h4', topic_id: 't4', title: 'КР', grade_scale: 'five', is_published: true, opens_at: null, closes_at: null },
      { id: 'h5', topic_id: 't5', title: 'ДЗ 5', grade_scale: 'five', is_published: true },
    ]
    files = [{ homework_id: 'h1' }, { homework_id: 'h2' }, { homework_id: 'h5' }]
  })
  afterEach(() => { vi.useRealTimers() })

  it('нет ни плашки «Не опубликовано», ни кнопок публикации курса и модуля', async () => {
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
    await screen.findByText(/Выполнено/)
    expect(screen.queryByText(/Не опубликовано ДЗ/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Опубликовать/ })).not.toBeInTheDocument()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('у темы статус выдачи: открыта с файлом, закрыта (с датой), без файлов, работа по времени', async () => {
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
    await screen.findByText(/Выполнено/)
    expect(issueOf('Кинематика')).toHaveTextContent('Выдано · тема открыта')
    expect(issueOf('Динамика')).toHaveTextContent('Не выдано · тема закрыта · откроется 6 октября')
    expect(issueOf('Статика')).toHaveTextContent('Нет файлов задания')
    // У контрольной файл не нужен — условие рубрикой.
    expect(issueOf('Контрольная')).toHaveTextContent('Выдано · тема открыта')
    // Закрыта тумблером: дата не действует, «откроется» не обещаем; то, что
    // флаг выдачи стоит с прошлого открытия, ученику ничего не показывает.
    expect(issueOf('Давление')).toHaveTextContent('Не выдано · тема закрыта')
    expect(issueOf('Давление')).not.toHaveTextContent('откроется')
  })
})
