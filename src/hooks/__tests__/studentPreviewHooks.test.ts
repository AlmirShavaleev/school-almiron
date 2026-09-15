import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useStaffModeStore } from '@/store/staffModeStore'
import { useToastStore } from '@/store/toastStore'

/**
 * §178/§179. Ветка «предпросмотр» в хуках данных ученика: откуда берутся
 * строки и что делают мутации. Проверяется поведение хуков напрямую —
 * страница темы покрыта отдельно (`TopicPage.preview.test.tsx`).
 *
 * Задачи к уроку (§179): ответ, разбор и «Разобрал» работают — в памяти
 * хука; вердикт считает чистая RPC `preview_task_verdict`, разбор читается из
 * `catalog_tasks`, а RPC записи не вызываются никогда.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const TOPIC2 = 'f0000000-0000-0000-0000-000000000002'
const GROUP = 'g0000000-0000-0000-0000-000000000001'
const CORRECT = '42'

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
      // Чистый вердикт (§179): как база — true/false по эталону, без записи.
      if (name === 'preview_task_verdict') {
        if (args.p_answer_raw === 'staff-only') return Promise.resolve({ data: null, error: { message: 'STAFF_ONLY: preview verdict is available to platform staff only' } })
        return Promise.resolve({ data: args.p_answer_raw === CORRECT, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      queried.push(table)
      if (table === 'catalog_task_assets') return chain([{ id: 'a1', task_id: 't2', tex_session_id: null, kind: 'image', storage_path: 'x.png', alt: null, position: 1 }])
      if (table === 'catalog_tasks') return chain({ answer_html: `<p>${CORRECT}</p>`, solution_html: '<p>Разбор из каталога</p>', solution_plan_html: null })
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
import { useTopicSectionMarks } from '@/hooks/useTopicSectionMarks'
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

    it('верный ответ → «решена» в памяти хука; вызвана только preview_task_verdict', async () => {
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))
      rpc.mockClear()

      let verdict: boolean | null = null
      await act(async () => { verdict = await result.current.answer('i1', CORRECT) })
      expect(verdict).toBe(true)
      expect(result.current.rows[0]).toMatchObject({ closed_by: 'auto', is_correct: true, attempts_count: 1, answer_raw: CORRECT })
      expect(result.current.solved).toBe(1)
      expect(result.current.error).toBeNull()
      expect(rpc).toHaveBeenCalledTimes(1)
      expect(rpc).toHaveBeenCalledWith('preview_task_verdict', { p_task_id: 't1', p_answer_raw: CORRECT })
      // Никакого тоста «не сохраняется»: действие сработало, просто в памяти.
      expect(lastToast()).toBeUndefined()
    })

    it('неверный → попытка без закрытия; разбор — из catalog_tasks; «Разобрал» → закрыта «по разбору»', async () => {
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))
      rpc.mockClear()
      queried.length = 0

      let verdict: boolean | null = null
      await act(async () => { verdict = await result.current.answer('i1', '7') })
      expect(verdict).toBe(false)
      expect(result.current.rows[0]).toMatchObject({ closed_by: null, is_correct: false, attempts_count: 1, answer_raw: '7', solution_shown_at: null })

      await act(async () => { verdict = await result.current.answer('i1', '8') })
      expect(result.current.rows[0].attempts_count).toBe(2)

      let revealed: unknown = null
      await act(async () => { revealed = await result.current.reveal('i1') })
      expect(revealed).toEqual({ answer_html: `<p>${CORRECT}</p>`, solution_html: '<p>Разбор из каталога</p>', solution_plan_html: null })
      expect(queried).toContain('catalog_tasks')
      expect(result.current.rows[0].solution_shown_at).not.toBeNull()
      expect(result.current.rows[0].solution_html).toBe('<p>Разбор из каталога</p>')
      expect(result.current.rows[0].answer_html).toBe(`<p>${CORRECT}</p>`)

      // После открытого решения ответ не принимается — то же правило, что у
      // `answer_topic_task` (§176): вердикт не спрашивается.
      rpc.mockClear()
      await act(async () => { verdict = await result.current.answer('i1', CORRECT) })
      expect(verdict).toBeNull()
      expect(result.current.error).toMatch(/Решение уже открыто/)
      expect(rpc).not.toHaveBeenCalled()

      await act(async () => { await result.current.closeSelf('i1') })
      expect(result.current.rows[0].closed_by).toBe('self')
      expect(result.current.solved).toBe(1)

      // Вторая часть: разбор без попытки, затем «Разобрал».
      await act(async () => { await result.current.reveal('i2') })
      await act(async () => { await result.current.closeSelf('i2') })
      expect(result.current.rows[1].closed_by).toBe('self')
      expect(result.current.solved).toBe(2)

      expect(rpc).not.toHaveBeenCalled()
      expect(written).toEqual([])
    })

    it('правила сервера повторены: разбор до попытки, «Разобрал» без разбора, ответ на закрытую — отказ без запросов', async () => {
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))
      rpc.mockClear()
      queried.length = 0

      await act(async () => { await result.current.reveal('i1') })
      expect(result.current.error).toMatch(/после первой попытки/)
      expect(result.current.rows[0].solution_shown_at).toBeNull()
      expect(queried).not.toContain('catalog_tasks')

      await act(async () => { await result.current.closeSelf('i2') })
      expect(result.current.error).toBe('Сначала откройте решение.')
      expect(result.current.rows[1].closed_by).toBeNull()

      await act(async () => { await result.current.answer('i2', '1') })
      expect(result.current.error).toMatch(/нет короткого ответа/)

      await act(async () => { await result.current.answer('i1', CORRECT) })
      rpc.mockClear()
      await act(async () => { await result.current.answer('i1', CORRECT) })
      expect(result.current.error).toBe('Задача уже решена.')
      expect(rpc).not.toHaveBeenCalled()
      expect(result.current.rows[0].attempts_count).toBe(1)
    })

    it('отказ базы (STAFF_ONLY) приходит словами, попытка не засчитана', async () => {
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))

      let verdict: boolean | null = true
      await act(async () => { verdict = await result.current.answer('i1', 'staff-only') })
      expect(verdict).toBeNull()
      expect(result.current.error).toMatch(/только персоналу/)
      expect(result.current.rows[0]).toMatchObject({ attempts_count: 0, is_correct: null, closed_by: null })
    })

    it('перемонтирование на другую тему и обратно — всё забыто', async () => {
      const { result, rerender } = renderHook(({ id }) => useTopicTasks(id), { initialProps: { id: TOPIC } })
      await waitFor(() => expect(result.current.loading).toBe(false))

      await act(async () => { await result.current.answer('i1', CORRECT) })
      await act(async () => { await result.current.reveal('i2') })
      await act(async () => { await result.current.closeSelf('i2') })
      expect(result.current.solved).toBe(2)

      rerender({ id: TOPIC2 })
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.solved).toBe(0)
      expect(result.current.rows.every(r => r.closed_by === null && r.attempts_count === 0 && r.solution_shown_at === null)).toBe(true)

      rerender({ id: TOPIC })
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.solved).toBe(0)
      expect(result.current.rows[0]).toMatchObject({ closed_by: null, attempts_count: 0, is_correct: null, answer_raw: null })
      expect(result.current.rows[1]).toMatchObject({ closed_by: null, solution_shown_at: null, solution_html: null })
    })

    it('ни одна RPC записи не вызвана за весь путь: ответ, разбор, «Разобрал»', async () => {
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))

      await act(async () => { await result.current.answer('i1', '7') })
      await act(async () => { await result.current.reveal('i1') })
      await act(async () => { await result.current.closeSelf('i1') })
      await act(async () => { await result.current.reveal('i2') })
      await act(async () => { await result.current.closeSelf('i2') })
      expect(result.current.solved).toBe(2)

      const names = rpc.mock.calls.map(c => c[0] as string)
      for (const w of ['answer_topic_task', 'reveal_topic_task_solution', 'close_topic_task_self', 'topic_tasks_for_student', 'ensure_topic_task_rows']) {
        expect(names, w).not.toContain(w)
      }
      expect(new Set(names)).toEqual(new Set(['topic_tasks_for_staff', 'preview_task_verdict']))
      expect(written).toEqual([])
      expect(queried).not.toContain('test_variant_answers')
    })

    it('вне предпросмотра строки по-прежнему от topic_tasks_for_student', async () => {
      useStaffModeStore.setState({ mode: 'admin', profileId: 'owner-1' })
      const { result } = renderHook(() => useTopicTasks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.preview).toBe(false)
      expect(rpc).toHaveBeenCalledWith('topic_tasks_for_student', { p_topic_id: TOPIC })
    })
  })

  describe('useTopicSectionMarks', () => {
    it('«Отметить как сделанное» — переключатель в памяти: отметки не читаются и не пишутся', async () => {
      const { result } = renderHook(() => useTopicSectionMarks(TOPIC))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(result.current.preview).toBe(true)
      expect(result.current.canMark).toBe(true)
      expect(result.current.marks.size).toBe(0)

      await act(async () => { await result.current.toggle('theory') })
      expect(result.current.marks.has('theory')).toBe(true)
      expect(lastToast()).toBeUndefined()

      await act(async () => { await result.current.toggle('theory') })
      expect(result.current.marks.has('theory')).toBe(false)

      expect(queried).not.toContain('topic_section_marks')
      expect(queried).not.toContain('students')
      expect(written).toEqual([])
      expect(result.current.error).toBeNull()
    })

    it('смена темы стирает отметки предпросмотра', async () => {
      const { result, rerender } = renderHook(({ id }) => useTopicSectionMarks(id), { initialProps: { id: TOPIC } })
      await act(async () => { await result.current.toggle('lesson') })
      expect(result.current.marks.has('lesson')).toBe(true)
      rerender({ id: TOPIC2 })
      await waitFor(() => expect(result.current.marks.size).toBe(0))
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
      // §182: прогресс по задачам к уроку — тоже чужой. RPC не зовётся вовсе,
      // и в предпросмотре у темы нет ни «N из M», ни выдуманных нулей.
      expect(rpc).not.toHaveBeenCalled()
      expect(t.tasks_total).toBe(0)
      expect(t.tasks_closed).toBe(0)
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
