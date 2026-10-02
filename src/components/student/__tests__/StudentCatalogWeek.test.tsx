import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

const state = { res: null as { data: unknown; error: unknown } | null, calls: [] as unknown[] }
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => { state.calls.push([fn, args]); return Promise.resolve(state.res) } },
}))
import { StudentCatalogWeek } from '@/components/student/StudentCatalogWeek'

/** §256. Учитель в карточке ученика: «Каталог за 7 дней: решено N, верно M». */
beforeEach(() => { state.calls = [] })

describe('StudentCatalogWeek', () => {
  it('строка из ответа базы', async () => {
    state.res = { data: { days: 7, tried: 12, correct: 9 }, error: null }
    render(<StudentCatalogWeek studentId="st-1" />)
    await waitFor(() => expect(screen.getByTestId('student-catalog-week')).toHaveTextContent('Каталог за 7 дней: решено 12 задач, верно 9'))
    expect(state.calls).toEqual([['student_catalog_week_for_staff', { p_student_id: 'st-1' }]])
  })

  it('отказ (не персонал) или функции ещё нет — строки нет', async () => {
    state.res = { data: null, error: { message: 'ACCESS_DENIED' } }
    render(<StudentCatalogWeek studentId="st-1" />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.queryByTestId('student-catalog-week')).toBeNull()
  })
})
