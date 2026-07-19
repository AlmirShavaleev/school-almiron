import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { AssignedCollection, TaskSubmission, RosterRow, StudentAssignmentTask } from '@/types/assignments'
import { fetchReviewQueuePage, type ReviewQueueItem } from '@/lib/reviewQueue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ── Teacher: list their own assigned_collections ───────────────────────────────

export function useTeacherAssignments() {
  const profile = useAuthStore(s => s.profile)
  const [assignments, setAssignments] = useState<AssignedCollection[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [tick,        setTick]        = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setLoading(true)
    setError(null)

    db.from('assigned_collections')
      .select('*')
      .eq('teacher_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: err }: { data: AssignedCollection[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else     setAssignments(data ?? [])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [profile, tick])

  return { assignments, loading, error, reload }
}

// ── Teacher: create assignment via RPC (atomic + roster snapshot) ──────────────

export interface CreateAssignmentParams {
  collection_id: string
  student_id?:   string | null
  group_id?:     string | null
  due_date?:     string | null
}

export function useCreateAssignment() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const create = useCallback(async (params: CreateAssignmentParams): Promise<boolean> => {
    setLoading(true)
    setError(null)

    const { error: err } = await db.rpc('create_assignment', {
      p_collection_id: params.collection_id,
      p_student_id:    params.student_id ?? null,
      p_group_id:      params.group_id ?? null,
      p_due_date:      params.due_date ?? null,
    })

    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [])

  return { create, loading, error }
}

// ── Student: list assignments targeted at them (snapshot roster, RLS-scoped) ───

export function useStudentAssignments() {
  const profile = useAuthStore(s => s.profile)
  const [assignments, setAssignments] = useState<AssignedCollection[]>([])
  const [ownSubmissions, setOwnSubmissions] = useState<Map<string, TaskSubmission>>(new Map())
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [tick,        setTick]        = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      // RLS restricts rows to those the student was snapshotted into at assignment time
      const { data, error: err } = await db
        .from('assigned_collections')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setAssignments(data ?? [])

      // Own submission per assignment — used to show "не начал / отправлено / ..."
      const { data: subs } = await db
        .from('task_submissions')
        .select('*')

      if (cancelled) return
      const map = new Map<string, TaskSubmission>((subs ?? []).map((s: TaskSubmission) => [s.assigned_id, s]))
      setOwnSubmissions(map)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile, tick])

  return { assignments, ownSubmissions, loading, error, reload }
}

// ── Student: assignment + own submission + tasks via safe RPC ──────────────────

export interface AssignmentDetail {
  assignment:  AssignedCollection
  collection:  { id: string; title: string; subject: string; work_type: string }
  items:       StudentAssignmentTask[]
  submission:  TaskSubmission | null
}

export function useAssignmentDetail(assignedId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [data,    setData]    = useState<AssignmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !assignedId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: assignment, error: e1 } = await db
        .from('assigned_collections')
        .select('*')
        .eq('id', assignedId)
        .single()

      if (cancelled) return
      if (e1 || !assignment) { setError(e1?.message ?? 'Задание не найдено'); setLoading(false); return }

      const { data: collection, error: e2 } = await db
        .from('task_collections')
        .select('id, title, subject, work_type')
        .eq('id', assignment.collection_id)
        .single()

      if (cancelled) return
      if (e2 || !collection) { setError('Подборка недоступна'); setLoading(false); return }

      // Task content via RPC — never touches answer_html/solution_html
      const { data: items, error: e3 } = await db.rpc('get_student_assignment_tasks', {
        p_assignment_id: assignedId,
      })

      if (cancelled) return
      if (e3) { setError(e3.message); setLoading(false); return }

      const { data: sub } = await db
        .from('task_submissions')
        .select('*')
        .eq('assigned_id', assignedId)
        .maybeSingle()

      if (cancelled) return
      setData({ assignment, collection, items: items ?? [], submission: sub ?? null })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile, assignedId, tick])

  return { data, loading, error, reload }
}

// ── Student: submit / resubmit solution via RPC (only path to write a submission) ──

export function useSubmitSolution() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const submit = useCallback(async (
    assignedId: string,
    answers: Record<string, string>,
    files: string[],
  ): Promise<boolean> => {
    setLoading(true)
    setError(null)

    const { error: err } = await db.rpc('submit_task_solution', {
      p_assigned_id: assignedId,
      p_answers:     answers,
      p_files:       files,
    })

    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [])

  return { submit, loading, error }
}

// ── Teacher: list submissions for review (across all own assignments) ──────────

export interface SubmissionRow extends TaskSubmission {
  assignment: AssignedCollection
}

export function useTeacherSubmissions() {
  const profile = useAuthStore(s => s.profile)
  const [submissions, setSubmissions] = useState<ReviewQueueItem[]>([])
  const [loading,      setLoading]     = useState(true)
  const [error,        setError]       = useState<string | null>(null)
  const [tick,         setTick]        = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const page = await fetchReviewQueuePage('all', {
        sourceType: 'task_collection',
        statuses: ['submitted', 'returned', 'accepted', 'rejected'],
        limit: 100,
      })
      if (cancelled) return
      setSubmissions(page.items.filter(item => item.submissionId))
      setLoading(false)
    }

    load().catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить сдачи')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [profile, tick])

  return { submissions, loading, error, reload }
}

// ── Teacher: per-student roster for a group (or single-student) assignment ─────

export function useAssignmentRoster(assignedId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [roster,  setRoster]  = useState<RosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !assignedId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    db.rpc('get_assignment_roster', { p_assignment_id: assignedId })
      .then(({ data, error: err }: { data: RosterRow[] | null; error: { message: string } | null }) => {
        if (cancelled) return
        if (err) setError(err.message)
        else     setRoster(data ?? [])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [profile, assignedId, tick])

  return { roster, loading, error, reload }
}

// ── Teacher: single submission detail (submission + assignment + collection + items) ──

export interface SubmissionDetail {
  submission: TaskSubmission
  assignment: AssignedCollection
  collection: { id: string; title: string; subject: string; work_type: string }
  items:      { id: string; catalog_task_id: string; position: number; custom_number: string | null; statement_html: string }[]
}

export function useSubmissionDetail(submissionId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [data,    setData]    = useState<SubmissionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !submissionId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: submission, error: e1 } = await db
        .from('task_submissions')
        .select('*')
        .eq('id', submissionId)
        .single()

      if (cancelled) return
      if (e1 || !submission) { setError(e1?.message ?? 'Сдача не найдена'); setLoading(false); return }

      const { data: assignment, error: e2 } = await db
        .from('assigned_collections')
        .select('*')
        .eq('id', submission.assigned_id)
        .single()

      if (cancelled) return
      if (e2 || !assignment) { setError('Назначение недоступно'); setLoading(false); return }

      // Teacher is created_by of the collection, so the regular Etap 1-3 select works here.
      const { data: collection, error: e3 } = await db
        .from('task_collections')
        .select('id, title, subject, work_type')
        .eq('id', assignment.collection_id)
        .single()

      if (cancelled) return
      if (e3 || !collection) { setError('Подборка недоступна'); setLoading(false); return }

      const { data: items, error: e4 } = await db
        .from('task_collection_items')
        .select('id, catalog_task_id, position, custom_number, catalog_tasks(statement_html)')
        .eq('collection_id', assignment.collection_id)
        .order('position')

      if (cancelled) return
      if (e4) { setError(e4.message); setLoading(false); return }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flat = (items ?? []).map((i: any) => ({
        id: i.id, catalog_task_id: i.catalog_task_id, position: i.position,
        custom_number: i.custom_number, statement_html: i.catalog_tasks?.statement_html ?? '',
      }))

      setData({ submission, assignment, collection, items: flat })
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile, submissionId, tick])

  return { data, loading, error, reload }
}

// ── Teacher: grade a submission via RPC ──────────────────────────────────────────

export function useGradeSubmission() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const grade = useCallback(async (
    submissionId: string,
    status: 'accepted' | 'rejected' | 'returned',
    score: number | null,
    comment: string | null,
  ): Promise<boolean> => {
    setLoading(true)
    setError(null)

    const { error: err } = await db.rpc('grade_task_submission', {
      p_submission_id: submissionId,
      p_status:        status,
      p_score:         score,
      p_comment:       comment,
    })

    setLoading(false)
    if (err) { setError(err.message); return false }
    return true
  }, [])

  return { grade, loading, error }
}

// ── Signed URLs for private submission files (task-submissions bucket) ─────────

const SUBMISSIONS_BUCKET = 'task-submissions'
const SIGNED_URL_TTL_SECONDS = 300 // 5 minutes

export function submissionFilePath(assignedId: string, studentId: string, filename: string): string {
  return `${assignedId}/${studentId}/${filename}`
}

export async function getSubmissionFileSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SUBMISSIONS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error) return null
  return data.signedUrl
}

export async function uploadSubmissionFile(
  assignedId: string,
  studentId: string,
  file: File,
): Promise<string | null> {
  const ext = file.name.split('.').pop()
  const path = submissionFilePath(assignedId, studentId, `${Date.now()}.${ext}`)
  // cacheControl: '0' — same reasoning as lesson-materials: private files,
  // deletion (e.g. resubmission) must not keep serving a stale CDN copy.
  const { error } = await supabase.storage
    .from(SUBMISSIONS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true, cacheControl: '0' })
  if (error) return null
  return path
}

export async function deleteSubmissionFile(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(SUBMISSIONS_BUCKET).remove([path])
  return !error
}

// ── Etap 5: assign homework directly from a lesson (auto-derives recipient) ────

export function useAssignLessonHomework() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [isDuplicate, setIsDuplicate] = useState(false)

  const assign = useCallback(async (
    lessonId: string,
    collectionId: string,
    dueDate: string | null,
    confirmDup = false,
  ): Promise<boolean> => {
    setLoading(true)
    setError(null)
    setIsDuplicate(false)

    const { error: err } = await db.rpc('assign_lesson_homework', {
      p_lesson_id:     lessonId,
      p_collection_id: collectionId,
      p_due_date:      dueDate,
      p_confirm_dup:   confirmDup,
    })

    setLoading(false)
    if (err) {
      if (err.message.includes('DUPLICATE')) setIsDuplicate(true)
      setError(err.message)
      return false
    }
    return true
  }, [])

  return { assign, loading, error, isDuplicate }
}

// ── Etap 5: homework assigned to a specific lesson (0..n, currently 0..1 in UI) ──

export function useLessonHomework(lessonId: string | undefined) {
  const profile = useAuthStore(s => s.profile)
  const [assignments, setAssignments] = useState<AssignedCollection[]>([])
  const [ownSubmission, setOwnSubmission] = useState<TaskSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile || !lessonId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data, error: err } = await db
        .from('assigned_collections')
        .select('*')
        .eq('lesson_id', lessonId)
        .order('created_at', { ascending: true })

      if (cancelled) return
      if (err) { setError(err.message); setLoading(false); return }
      setAssignments(data ?? [])

      if (profile!.role === 'student' && data?.length) {
        const { data: sub } = await db
          .from('task_submissions')
          .select('*')
          .eq('assigned_id', data[0].id)
          .maybeSingle()
        if (!cancelled) setOwnSubmission(sub ?? null)
      } else {
        setOwnSubmission(null)
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile, lessonId, tick])

  return { assignments, ownSubmission, loading, error, reload }
}
