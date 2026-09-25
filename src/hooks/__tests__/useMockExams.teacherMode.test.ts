/**
 * §219. Список пробников в режиме учителя — по ГРУППАМ, а не по автору.
 *
 * Было: `.eq('created_by', мой teachers.id)`. Владелец (роль admin) заводил
 * пробник с created_by = null и не видел его в списке; второй преподаватель
 * курса не видел пробник коллеги.
 *
 * База подменена маленькой имитацией PostgREST, которая делает с запросом то
 * же, что настоящая: `groups!inner` выбрасывает пробники без группы и без
 * ВИДИМОЙ группы (RLS `groups_select_all` → `course_is_staff`; у админа видна
 * вся школа), `.in('groups.course_id', …)` фильтрует по курсу группы,
 * `.eq(col, v)` — по колонке. Какие группы видны под RLS — задаёт тест.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { TeachingScope } from '@/hooks/useMyTeachingScope'

const EXAMS = [
  { id: 'e-colleague', title: 'Пробник коллеги по курсу', created_by: 't-colleague', group: { id: 'g1', name: '11А', course_id: 'c-math' } },
  { id: 'e-mine',      title: 'Мой пробник',              created_by: 't-me',       group: { id: 'g1', name: '11А', course_id: 'c-math' } },
  { id: 'e-other',     title: 'Пробник чужого курса',     created_by: 't-other',    group: { id: 'g2', name: '11Б', course_id: 'c-phys' } },
  { id: 'e-sample',    title: 'Образец без группы',       created_by: null,         group: null },
  { id: 'e-owner',     title: 'Заведён владельцем до §219', created_by: null,       group: { id: 'g1', name: '11А', course_id: 'c-math' } },
]

let role: string
let effectiveRole: string | null
let scope: TeachingScope
/** Группы, которые RLS отдаёт вызывающему. */
let visibleGroups: Set<string>
let queries: { select: string; filters: [string, string, unknown][] }[]

// Профиль — один объект на тест: хук зависит от него в эффекте, и новый
// объект на каждый рендер крутил бы запросы бесконечно.
let profile: { id: string; role: string }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile }),
}))
vi.mock('@/store/staffModeStore', () => ({
  useEffectiveRole: () => effectiveRole,
}))
vi.mock('@/hooks/useMyTeachingScope', () => ({
  useMyTeachingScope: () => scope,
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'mock_exams') throw new Error(`неожиданная таблица ${table}`)
      const q = { select: '', filters: [] as [string, string, unknown][] }
      queries.push(q)
      const run = () => {
        const inner = /groups!inner\(/.test(q.select)
        let rows = EXAMS.map(e => ({ ...e, groups: e.group && visibleGroups.has(e.group.id) ? e.group : null }))
        if (inner) rows = rows.filter(r => r.groups)
        for (const [op, col, v] of q.filters) {
          if (op === 'eq') rows = rows.filter(r => (r as Record<string, unknown>)[col] === v)
          if (op === 'in' && col === 'groups.course_id') rows = rows.filter(r => r.groups && (v as string[]).includes(r.groups.course_id))
        }
        return { data: rows, error: null }
      }
      const chain: Record<string, unknown> = {
        select: (s: string) => { q.select = s; return chain },
        eq: (c: string, v: unknown) => { q.filters.push(['eq', c, v]); return chain },
        in: (c: string, v: unknown) => { q.filters.push(['in', c, v]); return chain },
        order: () => Promise.resolve(run()),
      }
      return chain
    },
  },
}))

import { useMockExams } from '@/hooks/useMockExams'

const IDLE: TeachingScope = { active: false, loading: false, teacherId: null, courseIds: [], groupIds: [], ownStudentId: null, readOnly: false }

async function titles() {
  profile = { id: 'p-me', role }
  const { result } = renderHook(() => useMockExams())
  await waitFor(() => expect(result.current.loading).toBe(false))
  return (result.current.exams as { title: string }[]).map(e => e.title).sort()
}

beforeEach(() => {
  queries = []
  scope = IDLE
})

describe('useMockExams — режим учителя', () => {
  it('настоящий преподаватель курса видит пробники группы, включая заведённые коллегой и владельцем; образца без группы — нет', async () => {
    role = 'teacher'; effectiveRole = 'teacher'
    visibleGroups = new Set(['g1']) // RLS: он персонал курса c-math
    expect(await titles()).toEqual(['Заведён владельцем до §219', 'Мой пробник', 'Пробник коллеги по курсу'])
    // Фильтра по автору больше нет.
    expect(queries.every(q => q.filters.every(([, c]) => c !== 'created_by'))).toBe(true)
  })

  it('владелец (admin) в режиме учителя: RLS отдаёт всю школу — сужено до его курсов, без образцов', async () => {
    role = 'admin'; effectiveRole = 'teacher'
    visibleGroups = new Set(['g1', 'g2'])
    scope = { ...IDLE, active: true, teacherId: 't-me', courseIds: ['c-math'], groupIds: ['g1'] }
    expect(await titles()).toEqual(['Заведён владельцем до §219', 'Мой пробник', 'Пробник коллеги по курсу'])
  })

  it('владелец в режиме учителя без своих курсов — пустой список, а не вся школа', async () => {
    role = 'admin'; effectiveRole = 'teacher'
    visibleGroups = new Set(['g1', 'g2'])
    scope = { ...IDLE, active: true, courseIds: [] }
    expect(await titles()).toEqual([])
  })

  it('пока «что моё» грузится — в базу не ходим', async () => {
    role = 'admin'; effectiveRole = 'teacher'
    visibleGroups = new Set(['g1', 'g2'])
    scope = { ...IDLE, active: true, loading: true }
    profile = { id: 'p-me', role }
    const { result } = renderHook(() => useMockExams())
    await new Promise(r => setTimeout(r, 20))
    expect(result.current.loading).toBe(true)
    expect(queries).toHaveLength(0)
  })
})

describe('useMockExams — режим админа', () => {
  it('как было: всё, включая образцы без группы', async () => {
    role = 'admin'; effectiveRole = 'admin'
    visibleGroups = new Set(['g1', 'g2'])
    expect(await titles()).toHaveLength(EXAMS.length)
  })
})
