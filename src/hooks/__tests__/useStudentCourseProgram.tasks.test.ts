import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * §182. Задачи к уроку в списке курса: одна RPC на курс, а не запрос на тему.
 *
 * Проверяется поведение хука: числа раскладываются по темам, RPC зовётся один
 * раз с id курса, а её отсутствие (миграция ещё не применена на проде) не
 * роняет экран — «N из M» просто не появляется.
 */

const GROUP = 'g-1'
const COURSE = 'c-1'

const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
let rpcFails = false

const TASK_ROWS = [
  { topic_id: 'tp1', tasks_total: 7, closed: 3 },
  { topic_id: 'tp2', tasks_total: 4, closed: 4 },
]

function chain(result: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'range']) c[m] = () => c
  const one = Array.isArray(result) ? result[0] ?? null : result
  c.single = () => Promise.resolve({ data: one, error: null })
  c.maybeSingle = () => Promise.resolve({ data: one, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(f)
  return c
}

const GROUP_ROW = {
  id: GROUP, name: '11А', course_id: COURSE,
  courses: { id: COURSE, title: 'Физика', subject: 'physics', exam_type: 'ege', is_template: false },
  teachers: null, curators: null,
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      if (name === 'course_topic_tasks_progress_for_student') {
        return rpcFails
          ? Promise.resolve({ data: null, error: { message: 'function public.course_topic_tasks_progress_for_student(uuid) does not exist' } })
          : Promise.resolve({ data: TASK_ROWS, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      if (table === 'students') return chain({ id: 'st-1' })
      if (table === 'group_students') return chain([{ group_id: GROUP, groups: GROUP_ROW }])
      if (table === 'modules') return chain([{
        id: 'm1', title: 'Механика', order_index: 1,
        topics: [
          { id: 'tp1', title: 'Тема 1', order_index: 1, max_score: 100, available_from: null, is_open: true },
          { id: 'tp2', title: 'Тема 2', order_index: 2, max_score: 100, available_from: null, is_open: true },
          { id: 'tp3', title: 'Тема 3', order_index: 3, max_score: 100, available_from: null, is_open: true },
        ],
      }])
      return chain([])
    },
  },
}))

const PROFILE = { id: 'p-1', role: 'student' }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: PROFILE }),
}))

import { useStudentCourseProgram } from '@/hooks/useStudentCourseProgram'

const topicsOf = (modules: { topics: { id: string; tasks_total: number; tasks_closed: number }[] }[]) =>
  Object.fromEntries(modules[0].topics.map(t => [t.id, [t.tasks_total, t.tasks_closed]]))

beforeEach(() => {
  rpcCalls.length = 0
  rpcFails = false
})

describe('useStudentCourseProgram — задачи к уроку (§182)', () => {
  it('одна RPC на курс, числа разложены по темам, тема без задач — нули', async () => {
    const { result } = renderHook(() => useStudentCourseProgram(GROUP))
    await waitFor(() => expect(result.current.loading).toBe(false))

    const progressCalls = rpcCalls.filter(c => c.name === 'course_topic_tasks_progress_for_student')
    expect(progressCalls).toHaveLength(1)
    expect(progressCalls[0].args).toEqual({ p_course_id: COURSE })

    expect(topicsOf(result.current.modules)).toEqual({
      tp1: [7, 3],
      tp2: [4, 4],
      tp3: [0, 0],
    })
  })

  it('RPC нет на проде — экран жив, числа нулевые, ошибка не всплывает', async () => {
    rpcFails = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useStudentCourseProgram(GROUP))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.modules[0].topics).toHaveLength(3)
    expect(topicsOf(result.current.modules)).toEqual({ tp1: [0, 0], tp2: [0, 0], tp3: [0, 0] })
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })
})
