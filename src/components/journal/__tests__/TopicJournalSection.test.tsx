import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TopicJournal } from '@/lib/topicJournal'
import { EMPTY_SUMMARY } from '@/lib/topicJournal'

let state: { journal: TopicJournal | null; loading: boolean; error: string | null } = {
  journal: null, loading: false, error: null,
}

vi.mock('@/hooks/useStudentTopicJournal', () => ({
  useStudentTopicJournal: () => state,
}))

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}))

import { TopicJournalSection } from '@/components/journal/TopicJournalSection'

const journal: TopicJournal = {
  homework: [
    {
      homework_id: 'hw1', title: 'ДЗ · Кинематика', topic_id: 't1', topic_title: 'Тема 1',
      module_title: 'Основной', course_id: 'c1', course_title: 'Физика',
      due_at: '2026-07-20', grade_scale: 'five', status: 'accepted', score: 4,
      comment: 'молодец', submitted_at: null, reviewed_at: null, attempts_count: 2, is_overdue: false,
    },
    {
      homework_id: 'hw2', title: 'ДЗ · Динамика', topic_id: 't2', topic_title: 'Тема 2',
      module_title: null, course_id: 'c1', course_title: 'Физика',
      due_at: '2026-07-01', grade_scale: null, status: 'not_started', score: null,
      comment: null, submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: true,
    },
  ],
  tests: [
    {
      assignment_id: 'a1', test_id: 'test1', test_title: 'Тест по кинематике', topic_id: 't1',
      topic_title: 'Тема 1', course_id: 'c1', course_title: 'Физика',
      status: 'completed', total_points: 7, max_points: 10, percent: 70,
      started_at: null, completed_at: null,
    },
  ],
  summary: { ...EMPTY_SUMMARY, hw_total: 2, hw_accepted: 1, hw_pending: 1, hw_overdue: 1, avg_score_five: 4, tests_total: 1, tests_completed: 1, tests_avg_percent: 70 },
}

describe('TopicJournalSection', () => {
  it('показывает ДЗ нового контура со статусом, оценкой и комментарием', () => {
    state = { journal, loading: false, error: null }
    render(<TopicJournalSection studentId="s1" />)
    expect(screen.getByText('ДЗ · Кинематика')).toBeTruthy()
    expect(screen.getByText('Принято')).toBeTruthy()
    expect(screen.getByText('4 / 5')).toBeTruthy()
    expect(screen.getByText('молодец')).toBeTruthy()
  })

  it('помечает просроченное ДЗ', () => {
    state = { journal, loading: false, error: null }
    render(<TopicJournalSection studentId="s1" />)
    expect(screen.getAllByTestId('journal-homework-row').length).toBe(2)
    expect(screen.getByText('просрочено')).toBeTruthy()
  })

  it('на вкладке тестов показывает баллы и процент', () => {
    state = { journal, loading: false, error: null }
    render(<TopicJournalSection studentId="s1" />)
    fireEvent.click(screen.getByText('Тесты (1)'))
    expect(screen.getByText('Тест по кинематике')).toBeTruthy()
    expect(screen.getByText('Пройден')).toBeTruthy()
    expect(screen.getByText(/7 \/ 10/)).toBeTruthy()
  })

  it('средний балл показывается отдельно по шкале', () => {
    state = { journal, loading: false, error: null }
    render(<TopicJournalSection studentId="s1" />)
    expect(screen.getByText(/5-балльная/)).toBeTruthy()
  })

  it('RPC вернула null (нет доступа) — вместо пустой таблицы честное сообщение', () => {
    state = { journal: null, loading: false, error: null }
    render(<TopicJournalSection studentId="s1" />)
    expect(screen.getByText(/Журнал заданий недоступен/)).toBeTruthy()
  })

  it('ошибка RPC показывается пользователю', () => {
    state = { journal: null, loading: false, error: 'boom' }
    render(<TopicJournalSection studentId="s1" />)
    expect(screen.getByText('boom')).toBeTruthy()
  })
})
