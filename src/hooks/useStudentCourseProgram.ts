import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type {
  TopicHomeworkAttemptRow, TopicHomeworkReviewRow, GradeScale,
} from '@/lib/topicHomework'
import {
  sectionsFromMaterials, homeworkStatus, statusAttempt, reviewOfAttempt,
  homeworkMax, testStatus, topicProgress,
  type TopicSection, type TopicHwStatus, type TopicTestStatus,
} from '@/lib/studentProgram'

/**
 * Программа курса глазами ученика.
 *
 * Читает ТОЛЬКО новый контур (§10 PROJECT_STATE): topic_material_items.section,
 * topic_homework + попытки/вердикты, topic_test_assignments + попытки.
 * Легаси (topic_materials, homeworks/homework_submissions, assigned_collections)
 * убрано целиком — оно пусто и показывало ученику ложную картину.
 *
 * Клиент не дублирует RLS: неопубликованное ДЗ и закрытую тему база просто
 * не отдаст. Здесь только сборка того, что видно.
 */

const SELECT_PAGE_SIZE = 1000

export interface TopicProgress {
  id:             string
  title:          string
  order_index:    number
  max_score:      number
  available_from: string | null
  /** Тумблер открытости: null — решает дата. См. src/lib/topicAvailability.ts */
  is_open:        boolean | null
  /** Заполненные рубрики темы — те же плитки, что у преподавателя. */
  sections:       Set<TopicSection>
  // ── ДЗ темы (topic_homework) ──
  hw_id:           string | null
  hw_title:        string | null
  hw_instructions: string | null
  hw_due_at:       string | null
  hw_grade_scale:  GradeScale | null
  hw_status:       TopicHwStatus | null
  hw_score:        number | null
  hw_max:          number | null
  hw_comment:      string | null
  // ── Тест темы (привязка из банка) ──
  test_assignment_id: string | null
  test_title:         string | null
  test_status:        TopicTestStatus | null
  test_points:        number | null
  test_max_points:    number | null
  // ── Прогресс ──
  completed_count:  number
  assignment_count: number
}

export interface ModuleProgress {
  id:          string
  title:       string
  order_index: number
  topics:      TopicProgress[]
  done:        number   // выполненные задания (принятое ДЗ + завершённый тест)
  total:       number   // все задания тем модуля
}

export interface StaffInfo {
  id:         string
  full_name:  string
  email:      string
  phone:      string | null
  avatar_url: string | null
}

export interface CourseInfo {
  id:          string
  title:       string
  subject:     string
  exam_type:   string
  group_name:  string
  teacher:     StaffInfo | null
  curator:     StaffInfo | null
}

async function fetchAllPagedRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += SELECT_PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + SELECT_PAGE_SIZE - 1)
    if (error) throw new Error(error.message ?? 'Не удалось загрузить данные')
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < SELECT_PAGE_SIZE) break
  }
  return rows
}

export function useStudentCourseProgram(targetGroupId?: string | null) {
  const profile = useAuthStore(s => s.profile)
  const [course,   setCourse]   = useState<CourseInfo | null>(null)
  const [modules,  setModules]  = useState<ModuleProgress[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || profile.role !== 'student') return
    load()
  }, [profile, tick, targetGroupId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      // 1. Get student id
      const { data: student } = await supabase
        .from('students').select('id').eq('profile_id', profile!.id).single()
      if (!student) return

      // 2. Get student's groups with courses
      const gsQuery = supabase
        .from('group_students')
        .select(`group_id, groups(
          id, name, course_id,
          courses(id, title, subject, exam_type),
          teachers(id, profiles(id, full_name, email, phone, avatar_url)),
          curators(id, profiles(id, full_name, email, phone, avatar_url))
        )`)
        .eq('student_id', student.id)

      const { data: gs } = targetGroupId
        ? await gsQuery.eq('group_id', targetGroupId).single().then(r => ({ data: r.data ? [r.data] : [] }))
        : await gsQuery.limit(20)

      const groupWithCourse = (gs || []).find((g: any) => g.groups?.course_id)
      if (!groupWithCourse) { setLoading(false); return }

      const group   = (groupWithCourse as any).groups
      const course  = group.courses

      // PostgREST может вернуть объект или массив в зависимости от схемы FK
      function extractStaff(raw: any): StaffInfo | null {
        const obj = Array.isArray(raw) ? raw[0] : raw
        const p   = Array.isArray(obj?.profiles) ? obj?.profiles[0] : obj?.profiles
        if (!p?.full_name) return null
        return { id: p.id, full_name: p.full_name, email: p.email ?? '', phone: p.phone ?? null, avatar_url: p.avatar_url ?? null }
      }

      setCourse({
        id: course.id, title: course.title, subject: course.subject, exam_type: course.exam_type,
        group_name: group.name,
        teacher: extractStaff(group.teachers),
        curator: extractStaff(group.curators),
      })

      // 3. Modules + topics
      const { data: mods } = await supabase
        .from('modules')
        .select('id, title, order_index, topics(id, title, order_index, max_score, available_from, is_open)')
        .eq('course_id', course.id)
        .order('order_index')

      const topicIds = (mods || []).flatMap((m: any) => m.topics.map((t: any) => t.id))
      if (topicIds.length === 0) {
        setModules((mods || []).map((m: any) => ({
          id: m.id, title: m.title, order_index: m.order_index, topics: [], done: 0, total: 0,
        })))
        return
      }

      // 4. Рубрики материалов + ДЗ темы + привязанные тесты
      const [materialRows, homeworkRows, assignmentRows] = await Promise.all([
        fetchAllPagedRows<{ topic_id: string; kind: string; section: string | null }>((from, to) =>
          supabase
            .from('topic_material_items')
            .select('topic_id, kind, section')
            .in('topic_id', topicIds)
            .range(from, to)),
        (async () => {
          const { data, error } = await supabase
            .from('topic_homework')
            .select('id, topic_id, title, instructions, due_at, grade_scale')
            .in('topic_id', topicIds)
          if (error) throw new Error(error.message ?? 'Не удалось загрузить домашние задания')
          return (data || []) as unknown as {
            id: string; topic_id: string; title: string; instructions: string | null
            due_at: string | null; grade_scale: GradeScale | null
          }[]
        })(),
        (async () => {
          const { data, error } = await supabase
            .from('topic_test_assignments')
            .select('id, topic_id, test_id, topic_tests(title)')
            .in('topic_id', topicIds)
          if (error) throw new Error(error.message ?? 'Не удалось загрузить тесты')
          return (data || []) as any[]
        })(),
      ])

      // 5. Попытки ученика: ДЗ и тесты
      const homeworkIds   = homeworkRows.map(h => h.id)
      const assignmentIds = assignmentRows.map(a => a.id)

      const [attempts, testAttempts] = await Promise.all([
        (async () => {
          if (!homeworkIds.length) return [] as TopicHomeworkAttemptRow[]
          const { data, error } = await supabase
            .from('topic_homework_attempts')
            .select('id, homework_id, student_id, attempt_number, status, submitted_at, created_at, updated_at')
            .eq('student_id', student.id)
            .in('homework_id', homeworkIds)
          if (error) throw new Error(error.message ?? 'Не удалось загрузить попытки')
          return (data || []) as unknown as TopicHomeworkAttemptRow[]
        })(),
        (async () => {
          type TestAttemptRow = { assignment_id: string; status: string; total_points: number | null; max_points: number | null }
          if (!assignmentIds.length) return [] as TestAttemptRow[]
          const { data, error } = await supabase
            .from('topic_test_attempts')
            .select('assignment_id, status, total_points, max_points')
            .eq('student_id', student.id)
            .in('assignment_id', assignmentIds)
          if (error) throw new Error(error.message ?? 'Не удалось загрузить результаты тестов')
          return (data || []) as unknown as TestAttemptRow[]
        })(),
      ])

      // 6. Вердикты по попыткам ученика (балл + комментарий)
      const attemptIds = attempts.map(a => a.id)
      let reviews: TopicHomeworkReviewRow[] = []
      if (attemptIds.length) {
        const { data, error } = await supabase
          .from('topic_homework_reviews')
          .select('id, attempt_id, reviewer_id, decision, comment, score, created_at')
          .in('attempt_id', attemptIds)
        if (error) throw new Error(error.message ?? 'Не удалось загрузить проверки')
        reviews = (data || []) as unknown as TopicHomeworkReviewRow[]
      }

      // 7. Индексы
      const sectionMap = sectionsFromMaterials(materialRows)

      const hwByTopic = new Map<string, (typeof homeworkRows)[number]>()
      for (const hw of homeworkRows) if (!hwByTopic.has(hw.topic_id)) hwByTopic.set(hw.topic_id, hw)

      const attemptsByHw = new Map<string, TopicHomeworkAttemptRow[]>()
      for (const a of attempts) {
        const list = attemptsByHw.get(a.homework_id) ?? []
        list.push(a)
        attemptsByHw.set(a.homework_id, list)
      }

      const assignmentByTopic = new Map<string, any>()
      for (const a of assignmentRows) if (!assignmentByTopic.has(a.topic_id)) assignmentByTopic.set(a.topic_id, a)

      const testAttemptByAssignment = new Map<string, { status: string; total_points: number | null; max_points: number | null }>()
      for (const ta of testAttempts) testAttemptByAssignment.set(ta.assignment_id, ta)

      // 8. Сборка
      const result: ModuleProgress[] = (mods || []).map((m: any) => {
        const topics: TopicProgress[] = (m.topics || [])
          .sort((a: any, b: any) => a.order_index - b.order_index)
          .map((t: any) => {
            const sections = new Set<TopicSection>(sectionMap[t.id] ?? [])

            const hw = hwByTopic.get(t.id) ?? null
            const hwAttempts = hw ? attemptsByHw.get(hw.id) ?? [] : []
            const hwStatus = hw ? homeworkStatus(hwAttempts) : null
            const shown = statusAttempt(hwAttempts)
            const review = reviewOfAttempt(reviews, shown?.id ?? null)
            if (hw) sections.add('homework')

            const assignment = assignmentByTopic.get(t.id) ?? null
            const testAttempt = assignment ? testAttemptByAssignment.get(assignment.id) ?? null : null
            const tStatus = assignment ? testStatus(testAttempt) : null
            if (assignment) sections.add('test')

            const testRel = assignment?.topic_tests
            const testTitle = Array.isArray(testRel) ? testRel[0]?.title ?? null : testRel?.title ?? null

            const progress = topicProgress({
              hasHomework: !!hw, hwStatus, hasTest: !!assignment, testStatus: tStatus,
            })

            return {
              id:             t.id,
              title:          t.title,
              order_index:    t.order_index,
              max_score:      t.max_score,
              available_from: t.available_from,
              is_open:        t.is_open ?? null,
              sections,
              hw_id:           hw?.id ?? null,
              hw_title:        hw?.title ?? null,
              hw_instructions: hw?.instructions ?? null,
              hw_due_at:       hw?.due_at ?? null,
              hw_grade_scale:  hw?.grade_scale ?? null,
              hw_status:       hwStatus,
              hw_score:        review?.score ?? null,
              hw_max:          homeworkMax(hw?.grade_scale ?? null),
              hw_comment:      review?.comment ?? null,
              test_assignment_id: assignment?.id ?? null,
              test_title:         testTitle,
              test_status:        tStatus,
              test_points:        testAttempt?.total_points ?? null,
              test_max_points:    testAttempt?.max_points ?? null,
              completed_count:  progress.completed,
              assignment_count: progress.assigned,
            }
          })

        const done  = topics.reduce((sum, topic) => sum + topic.completed_count, 0)
        const total = topics.reduce((sum, topic) => sum + topic.assignment_count, 0)

        return { id: m.id, title: m.title, order_index: m.order_index, topics, done, total }
      })

      setModules(result)
    } catch (e) {
      console.error('Failed to load student course program', e)
      setError(e instanceof Error ? e.message : 'Не удалось загрузить программу курса')
    } finally {
      setLoading(false)
    }
  }

  return { course, modules, loading, error, reload }
}
