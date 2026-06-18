import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export interface GroupMeta {
  id: string
  name: string
  is_active: boolean
  max_students: number
  schedule_days: string[] | null
  schedule_time: string | null
  course_id: string | null
  course: { id: string; title: string; subject: string | null; exam_type: string | null } | null
  teacher_id: string | null
  teacher_name: string | null
  curator_id: string | null
  curator_name: string | null
}

export interface GroupStudent {
  id: string; profile_id: string; full_name: string; email: string; avatar_url: string | null
}

export interface GroupLesson {
  id: string; title: string; scheduled_at: string; duration_minutes: number | null; status: string; zoom_link: string | null
}

export type PipeStatus = 'submitted' | 'revision' | 'checked' | 'not_submitted'

export interface PipeCard {
  key: string
  studentId: string
  studentName: string
  hwId: string
  hwTitle: string
  status: PipeStatus
  score: number | null
}

export interface GroupKpi {
  students: number
  attendancePct: number
  submissionPct: number
  activeReviews: number   // submitted
  overdue: number         // не сдано к дедлайну
  riskPct: number
}

export interface GroupControlData {
  group: GroupMeta | null
  students: GroupStudent[]
  lessons: GroupLesson[]
  pipeline: Record<PipeStatus, PipeCard[]>
  kpi: GroupKpi
  loading: boolean
  error: string | null
  reload: () => void
}

const EMPTY_PIPE: Record<PipeStatus, PipeCard[]> = { submitted: [], revision: [], checked: [], not_submitted: [] }

export function useGroupControl(groupId: string | undefined): GroupControlData {
  const [group, setGroup]       = useState<GroupMeta | null>(null)
  const [students, setStudents] = useState<GroupStudent[]>([])
  const [lessons, setLessons]   = useState<GroupLesson[]>([])
  const [pipeline, setPipeline] = useState<Record<PipeStatus, PipeCard[]>>(EMPTY_PIPE)
  const [kpi, setKpi]           = useState<GroupKpi>({ students: 0, attendancePct: 0, submissionPct: 0, activeReviews: 0, overdue: 0, riskPct: 0 })
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [tick, setTick]         = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    setLoading(true); setError(null)
    load().catch(e => { if (!cancelled) setError(e.message || 'Ошибка загрузки') }).finally(() => { if (!cancelled) setLoading(false) })

    async function load() {
      // 1. group meta (maybeSingle → отсутствие группы = null без 406/PGRST116)
      const { data: g, error: gErr } = await supabase.from('groups')
        .select(`id, name, is_active, max_students, schedule_days, schedule_time, course_id,
                 courses(id, title, subject, exam_type),
                 teachers(id, profiles(full_name)), curators(id, profiles(full_name))`)
        .eq('id', groupId!).maybeSingle()
      if (gErr) throw gErr
      if (cancelled) return
      if (!g) { setGroup(null); return }   // группа не найдена/удалена → дружелюбный экран
      const gg: any = g
      const meta: GroupMeta = {
        id: gg.id, name: gg.name, is_active: gg.is_active !== false,
        max_students: gg.max_students || 20, schedule_days: gg.schedule_days, schedule_time: gg.schedule_time,
        course_id: gg.course_id,
        course: gg.courses ? { id: gg.courses.id, title: gg.courses.title, subject: gg.courses.subject, exam_type: gg.courses.exam_type } : null,
        teacher_id: gg.teachers?.id || null, teacher_name: gg.teachers?.profiles?.full_name || null,
        curator_id: gg.curators?.id || null, curator_name: gg.curators?.profiles?.full_name || null,
      }
      setGroup(meta)

      // 2. students + 3. lessons (parallel)
      const [gsRes, lRes] = await Promise.all([
        supabase.from('group_students')
          .select('student_id, students(id, profile_id, profiles(full_name, email, avatar_url))')
          .eq('group_id', groupId!),
        supabase.from('lessons')
          .select('id, title, scheduled_at, duration_minutes, status, zoom_link')
          .eq('group_id', groupId!).order('scheduled_at', { ascending: false }).limit(50),
      ])
      if (cancelled) return

      const studs: GroupStudent[] = ((gsRes.data || []) as any[]).map(r => ({
        id: r.student_id,
        profile_id: r.students?.profile_id || '',
        full_name: r.students?.profiles?.full_name || '—',
        email: r.students?.profiles?.email || '',
        avatar_url: r.students?.profiles?.avatar_url || null,
      })).sort((a, b) => a.full_name.localeCompare(b.full_name))
      setStudents(studs)
      const studentIds = studs.map(s => s.id)
      const studentName: Record<string, string> = {}; studs.forEach(s => studentName[s.id] = s.full_name)

      const rawLessons = (lRes.data || []) as any[]
      setLessons(rawLessons)
      const lessonIds = rawLessons.map(l => l.id)

      // 4. content bridge: course topics → homeworks
      let hws: any[] = []
      const hwById: Record<string, any> = {}
      if (meta.course_id) {
        const { data: mods } = await supabase.from('modules').select('topics(id, title)').eq('course_id', meta.course_id)
        const topicTitle: Record<string, string> = {}
        const topicIds: string[] = []
        for (const m of (mods || []) as any[]) for (const t of (m.topics || [])) { topicTitle[t.id] = t.title; topicIds.push(t.id) }
        if (topicIds.length) {
          const { data: hwData } = await supabase.from('homeworks')
            .select('id, title, due_date, topic_id').in('topic_id', topicIds)
          hws = (hwData || []) as any[]
          for (const h of hws) { h.topic_title = topicTitle[h.topic_id]; hwById[h.id] = h }
        }
      }
      const hwIds = hws.map(h => h.id)

      // 5. submissions (этой группы) + 6. attendance (parallel)
      const [subRes, attRes] = await Promise.all([
        hwIds.length && studentIds.length
          ? supabase.from('homework_submissions')
              .select('id, homework_id, student_id, status, score')
              .in('homework_id', hwIds).in('student_id', studentIds)
          : Promise.resolve({ data: [] as any[] }),
        lessonIds.length && studentIds.length
          ? supabase.from('attendance').select('student_id, lesson_id, status')
              .in('lesson_id', lessonIds).in('student_id', studentIds)
          : Promise.resolve({ data: [] as any[] }),
      ])
      if (cancelled) return

      const subs = (subRes.data || []) as any[]
      const subByPair: Record<string, any> = {}
      for (const s of subs) subByPair[`${s.homework_id}:${s.student_id}`] = s

      // ── pipeline ──────────────────────────────────────────────
      const pipe: Record<PipeStatus, PipeCard[]> = { submitted: [], revision: [], checked: [], not_submitted: [] }
      for (const hw of hws) {
        for (const sid of studentIds) {
          const sub = subByPair[`${hw.id}:${sid}`]
          const status: PipeStatus = !sub ? 'not_submitted'
            : (sub.status === 'submitted' || sub.status === 'revision' || sub.status === 'checked') ? sub.status : 'not_submitted'
          pipe[status].push({
            key: `${hw.id}:${sid}`,
            studentId: sid, studentName: studentName[sid] || '—',
            hwId: hw.id, hwTitle: hw.title, status, score: sub?.score ?? null,
          })
        }
      }
      setPipeline(pipe)

      // ── KPI ───────────────────────────────────────────────────
      const att = (attRes.data || []) as any[]
      const present = att.filter(a => a.status === 'present' || a.status === 'late').length
      const attendancePct = att.length ? Math.round(present / att.length * 100) : 0

      const totalExpected = hws.length * studentIds.length
      const turnedIn = subs.filter(s => ['submitted', 'checked', 'revision'].includes(s.status)).length
      const submissionPct = totalExpected ? Math.round(turnedIn / totalExpected * 100) : 0
      const activeReviews = pipe.submitted.length

      const now = Date.now()
      let overdue = 0
      for (const hw of hws) {
        if (!hw.due_date || new Date(hw.due_date).getTime() >= now) continue
        for (const sid of studentIds) {
          const sub = subByPair[`${hw.id}:${sid}`]
          if (!sub || sub.status === 'not_submitted') overdue++
        }
      }
      const riskPct = totalExpected ? Math.round(overdue / totalExpected * 100) : 0

      setKpi({ students: studentIds.length, attendancePct, submissionPct, activeReviews, overdue, riskPct })
    }

    return () => { cancelled = true }
  }, [groupId, tick])

  return { group, students, lessons, pipeline, kpi, loading, error, reload }
}
