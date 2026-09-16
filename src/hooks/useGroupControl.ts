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
  teacher_active: boolean
  curator_id: string | null
  curator_name: string | null
  curator_active: boolean
}

export interface GroupStudent {
  id: string; profile_id: string; full_name: string; email: string; avatar_url: string | null
}

export interface GroupLesson {
  id: string; title: string; scheduled_at: string; duration_minutes: number | null; status: string; zoom_link: string | null
}

/**
 * «Поток домашних заданий» (`pipeline`) и четыре плитки KPI по ДЗ —
 * «Сдача ДЗ», «На проверке», «Просрочки», «Риск» — сняты в §185 вместе со
 * старым контуром (`homeworks`, `homework_submissions`, 0 строк). Довод тот
 * же, что у §111 на карточке ученика: ноль там читался как «в группе никто
 * ничего не сдал», хотя данных не было вовсе, а живые работы лежат в
 * `topic_homework*` и показываются секцией `GroupHomeworkV2Assignments`
 * ниже на той же странице.
 */
export interface GroupKpi {
  students: number
  attendancePct: number
}

export interface GroupControlData {
  group: GroupMeta | null
  students: GroupStudent[]
  lessons: GroupLesson[]
  kpi: GroupKpi
  loading: boolean
  error: string | null
  reload: () => void
}

export function useGroupControl(groupId: string | undefined): GroupControlData {
  const [group, setGroup]       = useState<GroupMeta | null>(null)
  const [students, setStudents] = useState<GroupStudent[]>([])
  const [lessons, setLessons]   = useState<GroupLesson[]>([])
  const [kpi, setKpi]           = useState<GroupKpi>({ students: 0, attendancePct: 0 })
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
                 teachers(id, is_active, profiles(full_name)), curators(id, is_active, profiles(full_name))`)
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
        teacher_id: gg.teachers?.id || null, teacher_name: gg.teachers?.profiles?.full_name || null, teacher_active: gg.teachers?.is_active !== false,
        curator_id: gg.curators?.id || null, curator_name: gg.curators?.profiles?.full_name || null, curator_active: gg.curators?.is_active !== false,
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

      const rawLessons = (lRes.data || []) as any[]
      setLessons(rawLessons)
      const lessonIds = rawLessons.map(l => l.id)

      // 4. attendance
      const attRes = lessonIds.length && studentIds.length
        ? await supabase.from('attendance').select('student_id, lesson_id, status')
            .in('lesson_id', lessonIds).in('student_id', studentIds)
        : { data: [] as any[] }
      if (cancelled) return

      // ── KPI ───────────────────────────────────────────────────
      const att = (attRes.data || []) as any[]
      const present = att.filter(a => a.status === 'present' || a.status === 'late').length
      const attendancePct = att.length ? Math.round(present / att.length * 100) : 0

      setKpi({ students: studentIds.length, attendancePct })
    }

    return () => { cancelled = true }
  }, [groupId, tick])

  return { group, students, lessons, kpi, loading, error, reload }
}
