import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useStaffModeStore } from '@/store/staffModeStore'
import { useToastStore } from '@/store/toastStore'

/**
 * §178. Ветка «предпросмотр» в хуках данных ученика: откуда берутся строки и
 * что делают мутации. Проверяется поведение хуков напрямую — страница темы
 * покрыта отдельно (`TopicPage.preview.test.tsx`).
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

const rpc = vi.fn()
const queried: string[] = []
const written: string[] = []
let groupRow: Record<string, unknown> | null = null

function chain(result: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'range']) c[m] = () => c
  for (const m of ['insert', 'update', 'delete', 'upsert']) c[m] = () => { written.push(m); return c }
  const one = Array.isArray(result) ? result[0] ?? null : result
  c.single = () => Promise.resolve({ data: one, error: null })
  c.maybeSingle = () => Promise.resolve({ data: one, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpc(name, args)
      if (name === 'topic_tasks_for_staff') return Promise.resolve({ data: [
        { item_id: 'i1', item_position: 1, task_id: 't1', statement_html: 'A', exam_part: 1, max_points: 1, auto_checkable: true, answers_count: 5, closed_count: 3 },
        { item_id: 'i2', item_position: 2, task_id: 't2', statement_html: 'B', exam_part: 2, max_points: 3, auto_checkable: false, answers_count: 0, closed_count: 0 },
      ], error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      queried.push(table)
      if (table === 'catalog_task_assets') return chain([{ id: 'a1', task_id: 't2', tex_session_id: null, kind: 'image', storage_path: 'x.png', alt: null, position: 1 }])
      if (table === 'groups') return chain(groupRow)
      if (table === 'modules') return chain([{ id: 'm1', title: 'Механика', order_index: 1, topics: [{ id: 'tp1', title: 'Тема', order_index: 1, max_score: 100, available_from: null, is_open: true }] }])
      if (table === 'topic_homework') return chain([{ id: 'hw-1', topic_id: 'tp1', title: 'ДЗ', instructions: null, due_at: null, grade_scale: 'five' }])
      if (table === 'topic_material_items') return chain([])
      if (table === 'topic_test_assignments') return chain([])
      return chain([])
    },
    storage: { from: () => ({ remove: async () => ({ error: null }), upload: async () => ({ error: null }) }) },
  },
}))

const PROFILE = { id: 'owner-1', role: 'owner' }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: PROFILE }),
}))

import { useTopicTasks } from '@/hooks/useTopicTasks'
import { useStudentCourseProgram } from '@/hooks/useStudentCourseProgram'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { useTopicTestStudent } from '@/hooks/useTopicTest'

const lastToast = () => useToastStore.getState().toasts.at(-1)?.message

describe('хуки ученика в предпросмотре (§178)', () => {
  beforeEach(() => {
    rpc.mockClear()
    queried.length = 0
    written.length = 0
    localStorage.clear()
    useToastStore.setState({ toasts: [] })
    useStaffModeStore.setState({ mode: 'student', profileId: 'owner-1', choiceMade: true })
  })

  describe('useTopicTasks', () => {
    it('строки — из topic_tasks_for_staff в форме TopicTaskRow с пустым личным состоянием', async () => {
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.preview).toBe(true)
      expect(result.current.rows).toHaveLength(2)
      expect(result.current.solved).toBe(0)
      const [a, b] = result.current.rows
      expect(a).toMatchObject({ item_id: 'i1', task_id: 't1', auto_checkable: true, closed_by: null, attempts_count: 0, solution_shown_at: null, is_correct: null, answer_raw: null, solution_html: null })
      expect(b).toMatchObject({ item_id: 'i2', auto_checkable: false, max_points: 3, closed_by: null })
      // Картинки условий — из каталога, по task_id.
      expect(a.assets).toEqual([])
      expect(b.assets).toHaveLength(1)
      expect(rpc).toHaveBeenCalledWith('topic_tasks_for_staff', { p_topic_id: TOPIC })
      expect(rpc).not.toHaveBeenCalledWith('topic_tasks_for_student', expect.anything())
    })

    it('ответ, разбор и «Разобрал» — noop с тостом, RPC записи не вызываются', async () => {
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))
      rpc.mockClear()

      let verdict: boolean | null = true
      await act(async () => { verdict = await result.current.answer('i1', '42') })
      expect(verdict).toBeNull()
      expect(lastToast()).toBe('В предпросмотре не сохраняется')

      await act(async () => { await result.current.reveal('i1') })
      await act(async () => { await result.current.closeSelf('i2') })

      expect(rpc).not.toHaveBeenCalled()
      expect(result.current.rows[0].closed_by).toBeNull()
      expect(result.current.error).toBeNull()
    })

    it('вне предпросмотра строки по-прежнему от topic_tasks_for_student', async () => {
      useStaffModeStore.setState({ mode: 'admin', profileId: 'owner-1' })
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.preview).toBe(false)
      expect(rpc).toHaveBeenCalledWith('topic_tasks_for_student', { p_topic_id: TOPIC })
    })
  })

  describe('useStudentCourseProgram', () => {
    it('группа — по id из groups, без students и попыток; прогресс пустой', async () => {
      groupRow = { id: GROUP, name: '11А', course_id: 'c1', courses: { id: 'c1', title: 'Физика', subject: 'physics', exam_type: 'ege', is_template: false }, teachers: null, curators: null }
      const { result } = renderHook(() => useStudentCourseProgram(GROUP))
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.course?.title).toBe('Физика')
      expect(result.current.modules).toHaveLength(1)
      const t = result.current.modules[0].topics[0]
      expect(t.hw_id).toBe('hw-1')
      expect(t.hw_status).toBe('not_started')
      expect(result.current.modules[0].counters).toMatchObject({ homeworkAvailable: 1, homeworkSubmitted: 0, openTopics: 1, totalTopics: 1 })
      expect(queried).not.toContain('students')
      expect(queried).not.toContain('group_students')
      expect(queried).not.toContain('topic_homework_attempts')
      expect(queried).not.toContain('topic_test_attempts')
      expect(queried).not.toContain('topic_homework_reviews')
    })

    it('каркас в предпросмотре не показывается', async () => {
      groupRow = { id: GROUP, name: 'Каркас', course_id: 'ct', courses: { id: 'ct', title: 'Шаблон', subject: 'physics', exam_type: 'ege', is_template: true }, teachers: null, curators: null }
      const { result } = renderHook(() => useStudentCourseProgram(GROUP))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.course).toBeNull()
      expect(queried).not.toContain('modules')
    })
  })

  describe('useTopicHomework({ preview })', () => {
    it('читает ДЗ и файлы, попытки не читает; все ученические мутации — noop с тостом', async () => {
      const { result } = renderHook(() => useTopicHomework('tp1', { preview: true }))
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.homework?.id).toBe('hw-1')
      expect(result.current.attempts).toEqual([])
      expect(queried).toContain('topic_homework_files')
      expect(queried).not.toContain('topic_homework_attempts')

      await act(async () => {
        await result.current.startAttempt()
        await result.current.uploadAttemptFiles('x', [new File(['a'], 'a.png', { type: 'image/png' })])
        await result.current.removeAttemptFile('f', 'p')
        await result.current.reorderAttemptFiles('x', [])
        await result.current.submitAttempt('x')
      })
      expect(lastToast()).toBe('В предпросмотре не сохраняется')
      expect(rpc).not.toHaveBeenCalled()
      expect(written).toEqual([])
    })
  })

  describe('useTopicTestStudent({ preview })', () => {
    it('попытку не читает, start/save/submit — noop с тостом', async () => {
      const { result } = renderHook(() => useTopicTestStudent('tp1', { preview: true }))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(queried).not.toContain('topic_test_attempts')
      rpc.mockClear()

      await act(async () => {
        await result.current.start()
        await result.current.saveAnswer('i', 'x')
        await result.current.submit()
      })
      expect(lastToast()).toBe('В предпросмотре не сохраняется')
      expect(rpc).not.toHaveBeenCalled()
    })
  })
})
