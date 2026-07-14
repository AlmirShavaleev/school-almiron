import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import {
  aggregateStatus, mapCollectionSubmission, mapLegacySubmission, progressOf,
  type UnifiedStatus, type UnifiedSubmission,
} from '@/lib/unifiedSubmissions'

export interface TopicProgress {
  id:             string
  title:          string
  order_index:    number
  max_score:      number
  available_from: string | null
  // materials
  has_notes:    boolean
  has_theory:   boolean
  has_tasks:    boolean
  has_homework: boolean
  has_solution: boolean
  has_video:    boolean
  has_link:     boolean
  // homework submission
  hw_status:      UnifiedStatus | null
  hw_score:       number | null
  hw_max:         number | null
  hw_id:          string | null
  hw_file_url:    string | null
  hw_deadline:    string | null
  hw_description: string | null
  hw_feedback:    string | null
  lesson_date:    string | null
  assignments:    UnifiedSubmission[]
  completed_count: number
  assignment_count: number
}

export interface ModuleProgress {
  id:          string
  title:       string
  order_index: number
  topics:      TopicProgress[]
  done:        number   // accepted assignments
  total:       number   // all assignments
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

export function useStudentCourseProgram(targetGroupId?: string | null) {
  const profile = useAuthStore(s => s.profile)
  const [course,   setCourse]   = useState<CourseInfo | null>(null)
  const [modules,  setModules]  = useState<ModuleProgress[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || profile.role !== 'student') return
    load()
  }, [profile, tick, targetGroupId])

  async function load() {
    setLoading(true)
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

      const teacher = extractStaff(group.teachers)
      const curator = extractStaff(group.curators)

      setCourse({
        id: course.id, title: course.title, subject: course.subject, exam_type: course.exam_type,
        group_name: group.name,
        teacher,
        curator,
      })

      // 3. Modules + topics
      const { data: mods } = await supabase
        .from('modules')
        .select('id, title, order_index, topics(id, title, order_index, max_score, available_from)')
        .eq('course_id', course.id)
        .order('order_index')

      // 4. Topic materials (just check existence per type)
      const topicIds = (mods || []).flatMap((m: any) => m.topics.map((t: any) => t.id))

      const { data: mats } = await supabase
        .from('topic_materials')
        .select('topic_id, type')
        .in('topic_id', topicIds)

      const matMap: Record<string, Set<string>> = {}
      for (const mat of mats || []) {
        if (!matMap[mat.topic_id]) matMap[mat.topic_id] = new Set()
        matMap[mat.topic_id].add(mat.type)
      }

      // 5. Homeworks курса (на уровне темы) + сдачи студента
      const { data: hws } = await supabase
        .from('homeworks')
        .select('id, title, topic_id, lesson_id, max_score, due_date, file_url, description, created_at')
        .in('topic_id', topicIds)
        .eq('is_archived', false)

      const hwByTopic: Record<string, any[]> = {}
      for (const hw of hws || []) {
        if (hw.topic_id) (hwByTopic[hw.topic_id] ||= []).push(hw)
      }

      // Lessons per topic (latest scheduled)
      const { data: lessons } = await supabase
        .from('lessons')
        .select('id, topic_id, scheduled_at')
        .eq('group_id', group.id)
        .order('scheduled_at', { ascending: false })

      const lessonByTopic: Record<string, string> = {}
      const topicByLesson: Record<string, string> = {}
      for (const l of lessons || []) {
        if (l.topic_id && !lessonByTopic[l.topic_id]) lessonByTopic[l.topic_id] = l.scheduled_at
        if (l.topic_id) topicByLesson[l.id] = l.topic_id
      }

      const hwIds = (hws || []).map((h: any) => h.id)
      const { data: subs } = hwIds.length
        ? await supabase
            .from('homework_submissions')
            .select('id, homework_id, status, score, feedback, submitted_at, checked_at')
            .eq('student_id', student.id)
            .in('homework_id', hwIds)
        : { data: [] }

      const subByHw: Record<string, any> = {}
      for (const s of subs || []) subByHw[s.homework_id] = s

      // Collection assignments enter topic progress only through lesson.topic_id.
      const db = supabase as any
      const { data: assigned } = await db.from('assigned_collections')
        .select('id, collection_id, lesson_id, due_date, created_at, lessons(topic_id), task_collections(title, subject)')
        .or(`group_id.eq.${group.id},student_id.eq.${student.id}`)
      const assignedIds = (assigned || []).map((item: any) => item.id)
      const { data: collectionSubs } = assignedIds.length
        ? await db.from('task_submissions').select('*').eq('student_id', student.id).in('assigned_id', assignedIds)
        : { data: [] }
      const collectionSubByAssignment = new Map((collectionSubs || []).map((s: any) => [s.assigned_id, s]))

      const unifiedByTopic: Record<string, UnifiedSubmission[]> = {}
      for (const hw of hws || []) {
        if (!hw.topic_id) continue
        ;(unifiedByTopic[hw.topic_id] ||= []).push(mapLegacySubmission(hw, subByHw[hw.id] || null, {
          studentId: student.id, courseId: course.id, subject: course.subject,
        }))
      }
      for (const assignment of assigned || []) {
        const topicId = assignment.lesson_id
          ? (assignment.lessons?.topic_id ?? topicByLesson[assignment.lesson_id] ?? null)
          : null
        if (!topicId) continue
        ;(unifiedByTopic[topicId] ||= []).push(mapCollectionSubmission(
          assignment, collectionSubByAssignment.get(assignment.id) || null,
          { studentId: student.id, lessonId: assignment.lesson_id, topicId, courseId: course.id,
            subject: assignment.task_collections?.subject ?? null, title: assignment.task_collections?.title ?? null },
        ))
      }

      // 6. Assemble
      const result: ModuleProgress[] = (mods || []).map((m: any) => {
        const topics: TopicProgress[] = (m.topics || [])
          .sort((a: any, b: any) => a.order_index - b.order_index)
          .map((t: any) => {
            const types = matMap[t.id] || new Set()
            const legacyHws = hwByTopic[t.id] || []
            const hw = legacyHws[0] || null
            const sub = hw ? subByHw[hw.id] : null
            const assignments = unifiedByTopic[t.id] || []
            const progress = progressOf(assignments)
            return {
              id:             t.id,
              title:          t.title,
              order_index:    t.order_index,
              max_score:      t.max_score,
              available_from: t.available_from,
              has_notes:    types.has('notes'),
              has_theory:   types.has('theory'),
              has_tasks:    types.has('tasks'),
              has_homework: types.has('homework'),
              has_solution: types.has('solution'),
              has_video:    types.has('video'),
              has_link:     types.has('link'),
              hw_status:      aggregateStatus(assignments),
              hw_score:       sub?.score     ?? null,
              hw_max:         hw?.max_score  ?? null,
              hw_id:          hw?.id         ?? null,
              hw_file_url:    hw?.file_url   ?? null,
              hw_deadline:    hw?.due_date   ?? null,
              hw_description: hw?.description ?? null,
              hw_feedback:    sub?.feedback  ?? null,
              lesson_date:    lessonByTopic[t.id] ?? null,
              assignments,
              completed_count: progress.completed,
              assignment_count: progress.assigned,
            }
          })

        const done  = topics.reduce((sum, topic) => sum + topic.completed_count, 0)
        const total = topics.reduce((sum, topic) => sum + topic.assignment_count, 0)

        return { id: m.id, title: m.title, order_index: m.order_index, topics, done, total }
      })

      setModules(result)
    } finally {
      setLoading(false)
    }
  }

  return { course, modules, loading, reload }
}
