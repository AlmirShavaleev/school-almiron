import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { CatalogTask, CatalogTaskAsset } from '@/hooks/useCatalog'
import type { TestVariantItem } from '@/hooks/useVariants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VariantAssignment {
  id: string
  variant_id: string
  assigned_by: string
  student_id: string | null
  group_id: string | null
  available_from: string | null
  due_at: string | null
  max_attempts: number
  allow_retry: boolean
  show_answers_after_submit: boolean
  show_solutions_after_submit: boolean
  status: 'draft' | 'assigned' | 'cancelled' | 'completed'
  created_at: string
  updated_at: string
  // joined
  group?: {
    id: string
    name: string
    type?: string
    course?: { title: string; subject: string; exam_type: string } | null
    teacher?: { profiles?: { full_name: string } | null } | null
  } | null
  student?: { id: string; students: { profile_id: string; profiles: { full_name: string } } } | null
  assigned_by_profile?: { full_name: string } | null
  student_count?: number
}

export interface StudentVariantAssignment {
  id: string
  assignment_id: string
  variant_id: string
  student_id: string
  status: 'not_started' | 'available' | 'in_progress' | 'submitted' | 'completed' | 'overdue' | 'cancelled'
  available_from: string | null
  due_at: string | null
  max_attempts: number
  attempts_used: number
  started_at: string | null
  submitted_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  group_name?: string | null
  teacher_name?: string | null
  assignment_status?: string | null
  score?: number | null
  max_score?: number | null
  percentage?: number | null
  grading_status?: string | null
  answered_count?: number | null
  correct_count?: number | null
  manual_review_count?: number | null
  // joined
  variant?: {
    id: string
    title: string
    description: string | null
    subject: string
    exam_type: string
    tasks_count: number
    status: string
    source_type: string
  }
  assignment?: {
    id?: string
    status?: string
    available_from: string | null
    due_at: string | null
    max_attempts: number
    assigned_by_profile?: { full_name: string } | null
    group?: {
      name: string
      teacher?: { profiles?: { full_name: string } | null } | null
    } | null
  } | null
}

interface StudentVariantAssignmentRpcRow {
  id: string
  assignment_id: string
  variant_id: string
  student_id: string
  status: StudentVariantAssignment['status']
  available_from: string | null
  due_at: string | null
  max_attempts: number
  attempts_used: number
  started_at: string | null
  submitted_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  variant_title: string
  variant_description: string | null
  variant_subject: string
  variant_exam_type: string
  variant_tasks_count: number
  variant_status: string
  assignment_status: string
  group_name: string | null
  teacher_name: string | null
  score: number | null
  max_score: number | null
  percentage: number | null
  grading_status: string | null
  answered_count: number | null
  correct_count: number | null
  manual_review_count: number | null
  variant_source_type: string
}

function mapStudentAssignment(row: StudentVariantAssignmentRpcRow): StudentVariantAssignment {
  return {
    id: row.id,
    assignment_id: row.assignment_id,
    variant_id: row.variant_id,
    student_id: row.student_id,
    status: row.status,
    available_from: row.available_from,
    due_at: row.due_at,
    max_attempts: row.max_attempts,
    attempts_used: row.attempts_used,
    started_at: row.started_at,
    submitted_at: row.submitted_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    group_name: row.group_name,
    teacher_name: row.teacher_name,
    assignment_status: row.assignment_status,
    score: row.score,
    max_score: row.max_score,
    percentage: row.percentage,
    grading_status: row.grading_status,
    answered_count: row.answered_count,
    correct_count: row.correct_count,
    manual_review_count: row.manual_review_count,
    variant: {
      id: row.variant_id,
      title: row.variant_title,
      description: row.variant_description,
      subject: row.variant_subject,
      exam_type: row.variant_exam_type,
      tasks_count: row.variant_tasks_count,
      status: row.variant_status,
      source_type: row.variant_source_type,
    },
    assignment: {
      id: row.assignment_id,
      status: row.assignment_status,
      available_from: row.available_from,
      due_at: row.due_at,
      max_attempts: row.max_attempts,
      assigned_by_profile: row.teacher_name ? { full_name: row.teacher_name } : null,
      group: row.group_name
        ? {
            name: row.group_name,
            teacher: row.teacher_name ? { profiles: { full_name: row.teacher_name } } : null,
          }
        : null,
    },
  }
}

export interface AssignParams {
  variant_id: string
  student_ids: string[]
  group_ids: string[]
  available_from: string | null
  due_at: string | null
  max_attempts: number
  allow_retry: boolean
  show_answers_after_submit: boolean
  show_solutions_after_submit: boolean
}

export interface VariantAssignResult {
  groups_assigned: number
  unique_students: number
  students_created: number
  duplicates_skipped: number
  already_assigned: number
  empty_groups: number
  warnings: string[]
  notifications_created: number
  telegram_connected: number
  telegram_not_connected: number
  telegram_queued: number
}

export interface SyncVariantAssignmentResult {
  added: number
  skipped?: number
  notifications_created?: number
  telegram_connected?: number
  telegram_not_connected?: number
  telegram_queued?: number
}

// ── Hook: assignments for a variant (teacher/admin view) ──────────────────────

export function useVariantAssignments(variantId: string | undefined) {
  const [assignments, setAssignments] = useState<VariantAssignment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!variantId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await db
        .from('test_variant_assignments')
        .select(`
          *,
          group:groups(
            id,
            name,
            type,
            course:courses(title, subject, exam_type),
            teacher:teachers(profiles(full_name))
          ),
          assigned_by_profile:profiles!test_variant_assignments_assigned_by_fkey(full_name)
        `)
        .eq('variant_id', variantId)
        .order('created_at', { ascending: false })

      if (e) throw e

      // For each group assignment, count students
      const enriched = await Promise.all(
        (data || []).map(async (a: VariantAssignment) => {
          if (a.group_id) {
            const { count } = await db
              .from('test_variant_student_assignments')
              .select('*', { count: 'exact', head: true })
              .eq('assignment_id', a.id)
              .neq('status', 'cancelled')
            return { ...a, student_count: count ?? 0 }
          }
          if (a.student_id) {
            const { data: sd } = await supabase
              .from('students')
              .select('id, profiles(full_name)')
              .eq('id', a.student_id)
              .single()
            return { ...a, _student_profile: sd }
          }
          return a
        })
      )
      setAssignments(enriched)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки назначений')
    } finally {
      setLoading(false)
    }
  }, [variantId])

  useEffect(() => { load() }, [load])

  return { assignments, loading, error, refresh: load }
}

// ── Hook: student's assigned variants ─────────────────────────────────────────

export function useStudentVariantAssignments() {
  const { profile } = useAuthStore()
  const [assignments, setAssignments] = useState<StudentVariantAssignment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile || profile.role !== 'student') return

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data, error: e } = await db.rpc('get_my_variant_assignments')

        if (e) throw e
        setAssignments(((data || []) as StudentVariantAssignmentRpcRow[]).map(mapStudentAssignment))
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки вариантов')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [profile])

  return { assignments, loading, error }
}

export function useStudentVariantAssignmentDetail(assignmentId: string | undefined) {
  const { profile } = useAuthStore()
  const [assignment, setAssignment] = useState<StudentVariantAssignment | null>(null)
  const [items, setItems] = useState<TestVariantItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile || profile.role !== 'student' || !assignmentId) return

    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await db.rpc('get_my_variant_assignments')
      if (e) throw e

      const found = ((data || []) as StudentVariantAssignmentRpcRow[])
        .map(mapStudentAssignment)
        .find(a => a.id === assignmentId)

      if (!found) {
        setAssignment(null)
        setItems([])
        setError('Вариант недоступен')
        return
      }

      setAssignment(found)
      // Items are intentionally not loaded here: the student variant page
      // loads task content via get_variant_items_for_student (SECURITY DEFINER RPC)
      // which enforces the answer_html exclusion at the DB layer.
      setItems([])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки варианта')
    } finally {
      setLoading(false)
    }
  }, [assignmentId, profile])

  useEffect(() => { load() }, [load])

  return { assignment, items, loading, error, reload: load }
}

// ── Hook: groups for current teacher ─────────────────────────────────────────

export interface TeacherGroup {
  id: string
  name: string
  type: string
  teacher_name: string
  course_title: string | null
  subject: string | null
  exam_type: string | null
  student_count: number
  students: Array<{ id: string; full_name: string }>
}

export function useTeacherGroups() {
  const { profile } = useAuthStore()
  const [groups, setGroups] = useState<TeacherGroup[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!profile) return

    const load = async () => {
      setLoading(true)
      try {
        let query = supabase
          .from('groups')
          .select(`
            id,
            name,
            type,
            course:courses(title, subject, exam_type),
            teacher:teachers(profiles(full_name)),
            group_students(student_id, students(id, is_active, profiles(full_name)))
          `)
          .eq('is_active', true)

        if (profile.role === 'teacher') {
          // Get teacher record
          const { data: t } = await supabase
            .from('teachers')
            .select('id')
            .eq('profile_id', profile.id)
            .single()
          if (!t) { setLoading(false); return }
          query = query.eq('teacher_id', t.id)
        }
        // admin/owner: all groups

        const { data } = await query.order('name')

        const mapped: TeacherGroup[] = (data || []).map((g: any) => {
          const students = (g.group_students || [])
            .filter((gs: any) => gs.students?.is_active !== false)
            .map((gs: any) => ({
              id: gs.student_id,
              full_name: gs.students?.profiles?.full_name ?? '—',
            }))
          return {
            id: g.id,
            name: g.name,
            type: g.type,
            teacher_name: g.teacher?.profiles?.full_name ?? '—',
            course_title: g.course?.title ?? null,
            subject: g.course?.subject ?? null,
            exam_type: g.course?.exam_type ?? null,
            student_count: students.length,
            students,
          }
        })
        setGroups(mapped)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [profile])

  return { groups, loading }
}

// ── RPC wrappers ──────────────────────────────────────────────────────────────

export async function assignVariant(params: AssignParams) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('assign_test_variant', {
    p_variant_id:                  params.variant_id,
    p_student_ids:                 params.student_ids,
    p_group_ids:                   params.group_ids,
    p_available_from:              params.available_from,
    p_due_at:                      params.due_at,
    p_max_attempts:                params.max_attempts,
    p_allow_retry:                 params.allow_retry,
    p_show_answers_after_submit:   params.show_answers_after_submit,
    p_show_solutions_after_submit: params.show_solutions_after_submit,
  })
  if (error) throw error
  return data as VariantAssignResult
}

export async function cancelAssignment(assignmentId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('cancel_variant_assignment', {
    p_assignment_id: assignmentId,
  })
  if (error) throw error
}

export async function updateAssignment(
  assignmentId: string,
  updates: {
    available_from?: string | null
    due_at?: string | null
    clear_available_from?: boolean
    clear_due_at?: boolean
    max_attempts?: number
    allow_retry?: boolean
    show_answers_after_submit?: boolean
    show_solutions_after_submit?: boolean
  }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('update_variant_assignment', {
    p_assignment_id:               assignmentId,
    p_available_from:              updates.available_from ?? null,
    p_due_at:                      updates.due_at ?? null,
    p_max_attempts:                updates.max_attempts ?? null,
    p_allow_retry:                 updates.allow_retry ?? null,
    p_show_answers_after_submit:   updates.show_answers_after_submit ?? null,
    p_show_solutions_after_submit: updates.show_solutions_after_submit ?? null,
    p_clear_available_from:        updates.clear_available_from ?? false,
    p_clear_due_at:                updates.clear_due_at ?? false,
  })
  if (error) throw error
}

export async function syncGroupAssignment(assignmentId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('sync_group_assignment', {
    p_assignment_id: assignmentId,
  })
  if (error) throw error
  return data as SyncVariantAssignmentResult
}
