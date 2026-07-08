import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { mapCollectionSubmission } from '@/lib/unifiedSubmissions'

export type QueueBucket = 'urgent' | 'new' | 'revision' | 'backlog'
export type QueueMode = 'pending' | 'checked'
export type QueueReviewStatus = 'submitted' | 'revision' | 'checked' | 'accepted' | 'rejected'

export interface QueueItem {
  source:       'legacy' | 'collection'
  submissionId: string
  status:       QueueReviewStatus
  submittedAt:  string | null
  reviewedAt:   string | null
  dueDate:      string | null
  bucket:       QueueBucket | null
  overdue:      boolean
  student:      { id: string; name: string }
  group:        { id: string; name: string }
  homework:     { id: string; title: string }
  topicTitle:   string
  score:        number | null
}

export interface QueueCounts { urgent: number; new: number; revision: number; backlog: number; total: number }
export interface QueueTabCounts { pending: number; checked: number }

const DAY = 24 * 60 * 60 * 1000
const NEW_WINDOW = 3 * DAY
const DEFAULT_CHECKED_LIMIT = 50

/**
 * Homework Queue — операционная очередь проверки.
 * Атом = homework_submissions (status submitted|revision), развёрнутый через
 * process bridge (group_students→student) и content bridge (homework→topic→course).
 */
export function useHomeworkQueue(mode: QueueMode = 'pending', checkedLimit = DEFAULT_CHECKED_LIMIT) {
  const profile = useAuthStore(s => s.profile)
  const [items,   setItems]   = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const inFlightRef    = useRef(false)
  const lastLoadEndRef = useRef(0)
  const RELOAD_THROTTLE_MS = 30_000

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    inFlightRef.current = true
    setLoading(true)
    load().finally(() => {
      inFlightRef.current = false
      lastLoadEndRef.current = Date.now()
      if (!cancelled) setLoading(false)
    })

    async function load() {
      const role = profile!.role

      // ── 1. Scope: мои группы (process bridge, точка входа) ──────────────
      let groupsQ = supabase.from('groups').select('id, name, course_id')
      if (role === 'teacher') {
        const { data: tc } = await supabase.from('teachers').select('id').eq('profile_id', profile!.id).single()
        if (!tc) { if (!cancelled) setItems([]); return }
        groupsQ = groupsQ.eq('teacher_id', tc.id)
      } else if (role === 'curator') {
        const { data: cu } = await supabase.from('curators').select('id').eq('profile_id', profile!.id).single()
        if (!cu) { if (!cancelled) setItems([]); return }
        groupsQ = groupsQ.eq('curator_id', cu.id)
      } else if (role !== 'admin' && role !== 'owner') {
        if (!cancelled) setItems([]); return   // студентам очередь не нужна
      }
      const { data: groups } = await groupsQ.eq('is_active', true)
      if (!groups?.length) { if (!cancelled) { setItems([]); setHasMore(false) } return }

      const groupById: Record<string, { id: string; name: string; course_id: string | null }> = {}
      for (const g of groups as any[]) groupById[g.id] = g
      const courseIds = [...new Set((groups as any[]).map(g => g.course_id).filter(Boolean))]

      // ── 2. Ученики групп + карта student → группы ───────────────────────
      const { data: gsRows } = await supabase
        .from('group_students').select('student_id, group_id, students(profiles(full_name))')
        .in('group_id', groups.map((g: any) => g.id))
      const studentIds = [...new Set((gsRows || []).map((r: any) => r.student_id))]
      const studentNames: Record<string, string> = {}
      for (const row of gsRows || []) studentNames[(row as any).student_id] = (row as any).students?.profiles?.full_name || 'Без имени'
      if (!studentIds.length) { if (!cancelled) { setItems([]); setHasMore(false) } return }

      // student → [{groupId, courseId}] (для выбора нужной группы под курс ДЗ)
      const studentGroups: Record<string, { groupId: string; courseId: string | null }[]> = {}
      for (const r of (gsRows || []) as any[]) {
        (studentGroups[r.student_id] ||= []).push({ groupId: r.group_id, courseId: groupById[r.group_id]?.course_id ?? null })
      }

      // ── 3. Content bridge: курсы → темы → ДЗ ────────────────────────────
      const { data: mods } = courseIds.length
        ? await supabase.from('modules').select('course_id, topics(id, title)').in('course_id', courseIds)
        : { data: [] as any[] }
      const topicCourse: Record<string, string> = {}
      const topicTitle:  Record<string, string> = {}
      for (const m of (mods || []) as any[])
        for (const t of (m.topics || [])) { topicCourse[t.id] = m.course_id; topicTitle[t.id] = t.title }
      const topicIds = Object.keys(topicCourse)

      const { data: hws } = topicIds.length
        ? await supabase.from('homeworks').select('id, title, due_date, topic_id')
            .in('topic_id', topicIds).eq('is_archived', false)
        : { data: [] as any[] }
      const hwById: Record<string, any> = {}
      for (const h of hws as any[]) hwById[h.id] = h

      const now = Date.now()
      const list: QueueItem[] = []
      const db = supabase as any
      const { data: assigned } = await db.from('assigned_collections')
        .select('id, collection_id, group_id, lesson_id, due_date, created_at, lessons(topic_id), task_collections(title, subject)')
        .in('group_id', groups.map((g: any) => g.id))
      const assignedById = new Map((assigned || []).map((item: any) => [item.id, item]))

      if (mode === 'pending') {
        const { data: subs } = hws?.length
          ? await supabase.from('homework_submissions')
              .select('id, homework_id, student_id, status, submitted_at, score, students(profiles(full_name))')
              .in('homework_id', hws.map((h: any) => h.id)).in('student_id', studentIds)
              .in('status', ['submitted', 'revision']).order('submitted_at', { ascending: true })
          : { data: [] as any[] }

        for (const s of (subs || []) as any[]) {
          const hw = hwById[s.homework_id]
          if (!hw) continue
          const courseId = topicCourse[hw.topic_id]
          const g = (studentGroups[s.student_id] || []).find(x => x.courseId === courseId)
          if (!g) continue
          const due = hw.due_date ? new Date(hw.due_date).getTime() : null
          const overdue = due != null && due < now
          let bucket: QueueBucket
          if (s.status === 'revision') bucket = 'revision'
          else if (due != null && (overdue || due - now < DAY)) bucket = 'urgent'
          else if (s.submitted_at && now - new Date(s.submitted_at).getTime() < NEW_WINDOW) bucket = 'new'
          else bucket = 'backlog'

          list.push({
            source: 'legacy',
            submissionId: s.id,
            status: s.status,
            submittedAt: s.submitted_at,
            reviewedAt: null,
            dueDate: hw.due_date,
            bucket,
            overdue,
            student: { id: s.student_id, name: s.students?.profiles?.full_name || 'Без имени' },
            group: { id: g.groupId, name: groupById[g.groupId]?.name || '—' },
            homework: { id: hw.id, title: hw.title },
            topicTitle: topicTitle[hw.topic_id] || '',
            score: s.score ?? null,
          })
        }

        const { data: collectionSubs } = assignedById.size
          ? await db.from('task_submissions').select('*')
              .in('assigned_id', [...assignedById.keys()]).in('student_id', studentIds)
              .in('status', ['submitted', 'returned'])
          : { data: [] }
        for (const submission of collectionSubs || []) {
          const assignment: any = assignedById.get(submission.assigned_id)
          if (!assignment) continue
          const unified = mapCollectionSubmission(assignment, submission, {
            studentId: submission.student_id, lessonId: assignment.lesson_id,
            topicId: assignment.lessons?.topic_id ?? null,
            title: assignment.task_collections?.title ?? null, subject: assignment.task_collections?.subject ?? null,
          })
          const due = unified.dueAt ? new Date(unified.dueAt).getTime() : null
          const overdue = due != null && due < now
          const bucket: QueueBucket = unified.status === 'returned' ? 'revision'
            : due != null && (overdue || due - now < DAY) ? 'urgent'
            : unified.submittedAt && now - new Date(unified.submittedAt).getTime() < NEW_WINDOW ? 'new' : 'backlog'
          const targetGroupId = assignment.group_id || studentGroups[submission.student_id]?.[0]?.groupId || ''
          const group = groupById[targetGroupId]
          list.push({
            source: 'collection',
            submissionId: submission.id,
            status: unified.status === 'returned' ? 'revision' : 'submitted',
            submittedAt: unified.submittedAt,
            reviewedAt: unified.reviewedAt,
            dueDate: unified.dueAt,
            bucket,
            overdue,
            student: { id: submission.student_id, name: studentNames[submission.student_id] || 'Без имени' },
            group: { id: targetGroupId, name: group?.name || '—' },
            homework: { id: assignment.id, title: unified.title },
            topicTitle: assignment.lessons?.topic_id ? topicTitle[assignment.lessons.topic_id] || '' : '',
            score: unified.score,
          })
        }

        const order: Record<QueueBucket, number> = { urgent: 0, revision: 1, new: 2, backlog: 3 }
        list.sort((a, b) => order[a.bucket!] - order[b.bucket!] ||
          (a.dueDate || '').localeCompare(b.dueDate || ''))

        if (!cancelled) {
          setItems(list)
          setHasMore(false)
        }
        return
      }

      const legacyChecked = hws?.length
        ? await supabase.from('homework_submissions')
            .select('id, homework_id, student_id, status, score, submitted_at, checked_at, students(profiles(full_name))')
            .in('homework_id', hws.map((h: any) => h.id)).in('student_id', studentIds)
            .eq('status', 'checked').order('checked_at', { ascending: false }).limit(checkedLimit)
        : { data: [] as any[] }

      const collectionChecked = assignedById.size
        ? await db.from('task_submissions').select('*')
            .in('assigned_id', [...assignedById.keys()]).in('student_id', studentIds)
            .in('status', ['accepted', 'rejected']).order('reviewed_at', { ascending: false }).limit(checkedLimit)
        : { data: [] }

      for (const s of (legacyChecked.data || []) as any[]) {
        const hw = hwById[s.homework_id]
        if (!hw) continue
        const courseId = topicCourse[hw.topic_id]
        const g = (studentGroups[s.student_id] || []).find(x => x.courseId === courseId)
        if (!g) continue
        list.push({
          source: 'legacy',
          submissionId: s.id,
          status: 'checked',
          submittedAt: s.submitted_at,
          reviewedAt: s.checked_at ?? null,
          dueDate: hw.due_date,
          bucket: null,
          overdue: false,
          student: { id: s.student_id, name: s.students?.profiles?.full_name || 'Без имени' },
          group: { id: g.groupId, name: groupById[g.groupId]?.name || '—' },
          homework: { id: hw.id, title: hw.title },
          topicTitle: topicTitle[hw.topic_id] || '',
          score: s.score ?? null,
        })
      }

      for (const submission of collectionChecked.data || []) {
        const assignment: any = assignedById.get(submission.assigned_id)
        if (!assignment) continue
        const unified = mapCollectionSubmission(assignment, submission, {
          studentId: submission.student_id, lessonId: assignment.lesson_id,
          topicId: assignment.lessons?.topic_id ?? null,
          title: assignment.task_collections?.title ?? null, subject: assignment.task_collections?.subject ?? null,
        })
        const targetGroupId = assignment.group_id || studentGroups[submission.student_id]?.[0]?.groupId || ''
        const group = groupById[targetGroupId]
        list.push({
          source: 'collection',
          submissionId: submission.id,
          status: submission.status,
          submittedAt: unified.submittedAt,
          reviewedAt: unified.reviewedAt,
          dueDate: unified.dueAt,
          bucket: null,
          overdue: false,
          student: { id: submission.student_id, name: studentNames[submission.student_id] || 'Без имени' },
          group: { id: targetGroupId, name: group?.name || '—' },
          homework: { id: assignment.id, title: unified.title },
          topicTitle: assignment.lessons?.topic_id ? topicTitle[assignment.lessons.topic_id] || '' : '',
          score: unified.score,
        })
      }

      list.sort((a, b) => new Date(b.reviewedAt || 0).getTime() - new Date(a.reviewedAt || 0).getTime())

      if (!cancelled) {
        setItems(list.slice(0, checkedLimit))
        setHasMore(list.length > checkedLimit || (legacyChecked.data?.length ?? 0) >= checkedLimit || (collectionChecked.data?.length ?? 0) >= checkedLimit)
      }
    }

    // live-обновление: при возврате на вкладку (после проверки) — перечитать.
    // Guard от повторного рефетча, пока load() в полёте, + троттлинг 30с
    // между завершёнными загрузками (ручной reload() эти ограничения не знает).
    function onFocus() {
      if (mode !== 'pending') return
      if (inFlightRef.current) return
      if (Date.now() - lastLoadEndRef.current < RELOAD_THROTTLE_MS) return
      setTick(t => t + 1)
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  // Defense-in-depth: keyed on profile?.id/role (primitives), not the profile
  // object itself — same class of storm as useHomeworks, see there for why.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role, tick, mode, checkedLimit])

  const counts: QueueCounts = {
    urgent:   items.filter(i => i.bucket === 'urgent').length,
    new:      items.filter(i => i.bucket === 'new').length,
    revision: items.filter(i => i.bucket === 'revision').length,
    backlog:  items.filter(i => i.bucket === 'backlog').length,
    total:    items.length,
  }

  const tabCounts: QueueTabCounts = {
    pending: mode === 'pending' ? items.length : 0,
    checked: mode === 'checked' ? items.length : 0,
  }

  return { items, counts, loading, reload, hasMore, tabCounts }
}
