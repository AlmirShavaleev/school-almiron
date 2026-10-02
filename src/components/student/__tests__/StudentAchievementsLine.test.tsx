import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'

/**
 * §257. Учитель в карточке ученика: «Достижения: N из 79 · последние: …».
 * Ответ — `student_achievements_for_staff` (только персонал курса ученика);
 * отказ или функции нет — строки нет.
 */
const state = { data: null as unknown, error: null as { message: string } | null, args: null as unknown }
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (_fn: string, args: unknown) => { state.args = args; return Promise.resolve({ data: state.data, error: state.error }) } },
}))

import { StudentAchievementsLine } from '@/components/student/StudentAchievementsLine'

async function renderLine() {
  render(<StudentAchievementsLine studentId="st-1" />)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => { state.data = null; state.error = null; state.args = null })

describe('строка учителя «Достижения»', () => {
  it('N из 79 и три последние по-русски', async () => {
    state.data = {
      total: 79, earned: 17,
      latest: [
        { key: 'hw:20', category: 'hw', threshold: 20, tier: 2, points: 25, earned_at: '2026-10-02T10:00:00Z' },
        { key: 'streak:7', category: 'streak', threshold: 7, tier: 1, points: 10, earned_at: '2026-10-01T10:00:00Z' },
        { key: 'special:flawless', category: 'special', threshold: 10, tier: 3, points: 50, earned_at: '2026-09-30T10:00:00Z' },
      ],
    }
    await renderLine()
    expect(state.args).toEqual({ p_student_id: 'st-1' })
    expect(screen.getByTestId('student-achievements-line')).toHaveTextContent('Достижения: 17 из 79 · последние: 20 ДЗ, Серия 7 дней, Без ошибок')
  })

  it('наград нет — без «последних»; отказ прав (посторонний) — строки нет', async () => {
    state.data = { total: 79, earned: 0, latest: [] }
    await renderLine()
    expect(screen.getByTestId('student-achievements-line')).toHaveTextContent('Достижения: 0 из 79')
    expect(screen.getByTestId('student-achievements-line')).not.toHaveTextContent('последние')
  })

  it('42501 — строки нет', async () => {
    state.error = { message: 'ACCESS_DENIED: только персонал курса ученика' }
    await renderLine()
    expect(screen.queryByTestId('student-achievements-line')).toBeNull()
  })
})
