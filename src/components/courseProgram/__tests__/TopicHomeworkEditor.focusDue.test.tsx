import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * §259. «изменить / задать» срок в таблице ДЗ открывает окно темы на блоке ДЗ —
 * поле «Дедлайн» сразу в фокусе. Без флага фокус не трогаем.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => { const c: any = {}; for (const m of ['select', 'eq', 'in', 'order']) c[m] = () => c; c.then = (f: any) => Promise.resolve({ data: [], error: null }).then(f); return c },
    rpc: vi.fn(async () => ({ data: { pending: 0, due_at: null }, error: null })),
  },
}))
vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework: { id: 'hw-1', topic_id: 't1', title: 'ДЗ', instructions: null, is_published: true, due_at: '2026-09-11', grade_scale: 'five', created_by: 'u', created_at: '', updated_at: '' },
    files: [], loading: false, error: null,
    createHomework: vi.fn(), updateHomework: vi.fn(async () => {}),
    uploadHomeworkFile: vi.fn(), deleteHomeworkFile: vi.fn(),
    notifyStudents: vi.fn(), loadNotifyTargets: vi.fn().mockResolvedValue([]),
  }),
}))
vi.mock('@/store/toastStore', () => ({ toast: { saved: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { TopicHomeworkEditor } from '@/components/courseProgram/TopicHomeworkEditor'

describe('Поле срока в фокусе по приходу из таблицы ДЗ (§259)', () => {
  it('focusDue — «Дедлайн» в фокусе, со сроком', () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} focusDue />)
    const input = screen.getByTestId('hw-due-input')
    expect(document.activeElement).toBe(input)
    expect(input).toHaveValue('2026-09-11')
  })

  it('без флага — фокус не трогаем', () => {
    render(<TopicHomeworkEditor topicId="t1" isOpen={true} />)
    expect(document.activeElement).not.toBe(screen.getByTestId('hw-due-input'))
  })
})
