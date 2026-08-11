import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * §117. Аккордеон «Работы учеников» (§93) убран из модалки темы: проверка
 * работ живёт в разделе «Проверки ДЗ», а модалка — про настройку задания.
 * Тест сторожит и то, что блока нет, и то, что вместе с ним ушли его запросы:
 * модалка не должна дёргать попытки и ростер ради экрана настройки.
 */

const fromSpy = vi.fn()

function chain(rows: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: null, error: null })
  c.maybeSingle = () => Promise.resolve({ data: null, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => { fromSpy(table); return chain([]) } },
}))

vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework: { id: 'hw-1', topic_id: 't1', is_published: true, due_at: null, grade_scale: 'five' },
    files: [{ id: 'f1', homework_id: 'hw-1', storage_path: 't1/a.pdf', original_filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10, position: 0, created_at: '2026-08-01' }],
    loading: false,
    error: null,
    createHomework: vi.fn(), updateHomework: vi.fn(),
    uploadHomeworkFile: vi.fn(), deleteHomeworkFile: vi.fn(),
    notifyStudents: vi.fn(), loadNotifyTargets: vi.fn().mockResolvedValue([]),
  }),
}))

vi.mock('@/store/toastStore', () => ({
  toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

import { TopicHomeworkEditor } from '@/components/courseProgram/TopicHomeworkEditor'

describe('Модалка ДЗ без «Работ учеников» (§117)', () => {
  it('аккордеона работ в модалке нет', async () => {
    render(<TopicHomeworkEditor topicId="t1" />)

    await screen.findByText('Домашнее задание')
    expect(screen.queryByText('Работы учеников')).not.toBeInTheDocument()
  })

  it('настройка задания на месте — убрали блок, а не половину экрана', async () => {
    render(<TopicHomeworkEditor topicId="t1" />)

    expect(await screen.findByText('Домашнее задание')).toBeInTheDocument()
    expect(screen.getByTestId('homework-publish-state')).toBeInTheDocument()
  })

  it('модалка не тянет попытки и ростер: запросы ушли вместе с блоком', async () => {
    render(<TopicHomeworkEditor topicId="t1" />)

    await screen.findByText('Домашнее задание')
    await waitFor(() => expect(fromSpy).not.toHaveBeenCalledWith('topic_homework_attempts'))
    expect(fromSpy).not.toHaveBeenCalledWith('group_students')
    expect(fromSpy).not.toHaveBeenCalledWith('topic_homework_reviews')
  })
})
