import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

export type QueueBucket = 'urgent' | 'new' | 'revision' | 'backlog'

export interface QueueItem {
  submissionId: string
  status:       'submitted' | 'revision'
  submittedAt:  string | null
  dueDate:      string | null
  bucket:       QueueBucket
  overdue:      boolean
  student:      { id: string; name: string }
  group:        { id: string; name: string }
  homework:     { id: string; title: string }
  topicTitle:   string
}

export interface QueueCounts { urgent: number; new: number; revision: number; backlog: number; total: number }

const DAY = 24 * 60 * 60 * 1000
const NEW_WINDOW = 3 * DAY

/**
 * Homework Queue — операционная очередь проверки.
 * Атом = homework_submissions (status submitted|revision), развёрнутый через
 * process bridge (group_students→student) и content bridge (homework→topic→course).
 */
export function useHomeworkQueue() {
  const profile = useAuthStore(s => s.profile)
  const [items,   setItems]   = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    setLoading(true)
    load().finally(() => { if (!cancelled) setLoading(false) })

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
      const { data: groups } = await groupsQ
      if (!groups?.length) { if (!cancelled) setItems([]); return }

      const groupById: Record<string, { id: string; name: string; course_id: string | null }> = {}
      for (const g of groups as any[]) groupById[g.id] = g
      const courseIds = [...new Set((groups as any[]).map(g => g.course_id).filter(Boolean))]

      // ── 2. Ученики групп + карта student → группы ───────────────────────
      const { data: gsRows } = await supabase
        .from('group_students').select('student_id, group_id')
        .in('group_id', groups.map((g: any) => g.id))
      const studentIds = [...new Set((gsRows || []).map((r: any) => r.student_id))]
      if (!studentIds.length) { if (!cancelled) setItems([]); return }

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
      if (!topicIds.length) { if (!cancelled) setItems([]); return }

      const { data: hws } = await supabase
        .from('homeworks').select('id, title, due_date, topic_id')
        .in('topic_id', topicIds)
      if (!hws?.length) { if (!cancelled) setItems([]); return }
      const hwById: Record<string, any> = {}
      for (const h of hws as any[]) hwById[h.id] = h

      // ── 4. Атом очереди: сдачи в работе ─────────────────────────────────
      const { data: subs } = await supabase
        .from('homework_submissions')
        .select('id, homework_id, student_id, status, submitted_at, students(profiles(full_name))')
        .in('homework_id', hws.map((h: any) => h.id))
        .in('student_id', studentIds)
        .in('status', ['submitted', 'revision'])
        .order('submitted_at', { ascending: true })

      // ── 5. Сборка items + бакеты ────────────────────────────────────────
      const now = Date.now()
      const list: QueueItem[] = []
      for (const s of (subs || []) as any[]) {
        const hw = hwById[s.homework_id]
        if (!hw) continue
        const courseId = topicCourse[hw.topic_id]
        // группа ученика, чей курс соответствует курсу ДЗ
        const g = (studentGroups[s.student_id] || []).find(x => x.courseId === courseId)
        if (!g) continue
        const due = hw.due_date ? new Date(hw.due_date).getTime() : null
        const overdue = due != null && due < now
        let bucket: QueueBucket
        if (s.status === 'revision')                      bucket = 'revision'
        else if (due != null && (overdue || due - now < DAY)) bucket = 'urgent'
        else if (s.submitted_at && now - new Date(s.submitted_at).getTime() < NEW_WINDOW) bucket = 'new'
        else                                               bucket = 'backlog'

        list.push({
          submissionId: s.id,
          status:       s.status,
          submittedAt:  s.submitted_at,
          dueDate:      hw.due_date,
          bucket,
          overdue,
          student:      { id: s.student_id, name: s.students?.profiles?.full_name || 'Без имени' },
          group:        { id: g.groupId, name: groupById[g.groupId]?.name || '—' },
          homework:     { id: hw.id, title: hw.title },
          topicTitle:   topicTitle[hw.topic_id] || '',
        })
      }
      // приоритет: urgent → revision → new → backlog
      const order: Record<QueueBucket, number> = { urgent: 0, revision: 1, new: 2, backlog: 3 }
      list.sort((a, b) => order[a.bucket] - order[b.bucket] ||
        (a.dueDate || '').localeCompare(b.dueDate || ''))

      if (!cancelled) setItems(list)
    }

    // live-обновление: при возврате на вкладку (после проверки) — перечитать
    function onFocus() { setTick(t => t + 1) }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [profile, tick])

  const counts: QueueCounts = {
    urgent:   items.filter(i => i.bucket === 'urgent').length,
    new:      items.filter(i => i.bucket === 'new').length,
    revision: items.filter(i => i.bucket === 'revision').length,
    backlog:  items.filter(i => i.bucket === 'backlog').length,
    total:    items.length,
  }

  return { items, counts, loading, reload }
}
