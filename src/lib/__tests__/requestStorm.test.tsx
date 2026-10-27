import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

/**
 * Шторм запросов (письмо ЛК_СРОЧНО_шторм_запросов_программа_курса.md, 27.10):
 *  · свой students.id — один запрос на профиль, сколько бы хуков его ни просили;
 *  · «что моё» персонала — один набор на сессию, даже если хук стоит в каждой
 *    строке урока (TopicOpenToggle): 36 строк × 4 запроса давали ~170 запросов.
 */
const calls: string[] = []
vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
    const res = () => {
      calls.push(table)
      if (table === 'students') return Promise.resolve({ data: { id: 'st-1' }, error: null })
      if (table === 'teachers') return Promise.resolve({ data: { id: 't-1' }, error: null })
      if (table === 'courses') return Promise.resolve({ data: [{ id: 'c-1' }], error: null })
      if (table === 'groups') return Promise.resolve({ data: [{ id: 'g-1', course_id: 'c-2' }], error: null })
      return Promise.resolve({ data: [], error: null })
    }
    c.maybeSingle = res
    c.single = res
    c.then = (f: (v: unknown) => unknown) => res().then(f)
    return c
  }
  return { supabase: { from: (t: string) => chain(t), rpc: () => Promise.resolve({ data: null, error: null }) } }
})
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'owner-1', role: 'owner' } }),
}))
vi.mock('@/store/staffModeStore', () => ({ useNeedsOwnDataFilter: () => true }))
vi.mock('@/hooks/useMyCuratorships', () => ({ useMyCuratorships: () => ({ loading: false, isCurator: false, courseIds: [] }) }))

import { ownStudentId, ownStudentRow } from '@/lib/ownStudent'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'

beforeEach(() => { calls.length = 0 })

describe('свой students.id — один запрос', () => {
  it('десять одновременных и последующих вызовов — один запрос', async () => {
    const all = await Promise.all(Array.from({ length: 10 }, () => ownStudentRow('p-1')))
    expect(all.every(r => r.data?.id === 'st-1')).toBe(true)
    expect(await ownStudentId('p-1')).toBe('st-1')
    expect(calls.filter(t => t === 'students')).toHaveLength(1)
  })

  it('другой профиль — свой запрос', async () => {
    await ownStudentRow('p-1')
    await ownStudentRow('p-2')
    expect(calls.filter(t => t === 'students')).toHaveLength(2)
  })
})

function Row() {
  const s = useMyTeachingScope()
  return <span data-testid="row" data-loading={s.loading ? '1' : '0'} data-courses={s.courseIds.join(',')} />
}

describe('«что моё» — один набор на все строки', () => {
  it('36 строк с хуком — по одному запросу students/teachers/courses/groups', async () => {
    const { getAllByTestId } = render(<>{Array.from({ length: 36 }, (_, i) => <Row key={i} />)}</>)
    await waitFor(() => expect(getAllByTestId('row').every(r => r.getAttribute('data-loading') === '0')).toBe(true))
    expect(getAllByTestId('row')[35]).toHaveAttribute('data-courses', 'c-1,c-2')
    for (const t of ['students', 'teachers', 'courses', 'groups']) expect(calls.filter(c => c === t)).toHaveLength(1)
  })
})
