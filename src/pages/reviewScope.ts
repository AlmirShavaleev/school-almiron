import { supabase } from '@/lib/supabase'

export interface ReviewHomeworkInfo {
  id: string
  title: string
  max_score: number
  courseId: string | null
}

export interface ReviewRosterStudent {
  studentId: string
  name: string
  profileId: string
  groupId: string
  groupName: string
  status: 'submitted' | 'revision' | 'not_submitted' | 'checked'
  score: number | null
  submittedAt: string | null
}

interface ReviewGroup {
  id: string
  name: string
}

type ReviewProfile = { id: string; role: string } | null | undefined

const STATUS_ORDER: Record<ReviewRosterStudent['status'], number> = {
  submitted: 0,
  revision: 1,
  not_submitted: 2,
  checked: 3,
}

async function loadTeacherId(profileId: string) {
  const { data } = await supabase.from('teachers').select('id').eq('profile_id', profileId).single()
  return data?.id ?? null
}

export async function loadHomeworkInfo(homeworkId: string): Promise<ReviewHomeworkInfo | null> {
  const { data } = await supabase
    .from('homeworks')
    .select('id, title, max_score, topics(modules(course_id))')
    .eq('id', homeworkId)
    .single()

  if (!data) return null

  const hw = data as any
  return {
    id: hw.id,
    title: hw.title,
    max_score: hw.max_score,
    courseId: hw.topics?.modules?.course_id ?? null,
  }
}

async function loadScopedGroups(courseId: string, profile: ReviewProfile): Promise<ReviewGroup[]> {
  if (!profile) return []

  let query = supabase
    .from('groups')
    .select('id, name')
    .eq('course_id', courseId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (profile.role === 'teacher') {
    const teacherId = await loadTeacherId(profile.id)
    if (!teacherId) return []
    query = query.eq('teacher_id', teacherId)
  } else if (!['admin', 'owner'].includes(profile.role)) {
    return []
  }

  const { data } = await query
  return (data ?? []) as ReviewGroup[]
}

export async function loadHomeworkReviewRoster(homeworkId: string, profile: ReviewProfile) {
  const homework = await loadHomeworkInfo(homeworkId)
  if (!homework?.courseId) return { homework, students: [] as ReviewRosterStudent[] }

  const groups = await loadScopedGroups(homework.courseId, profile)
  if (!groups.length) return { homework, students: [] as ReviewRosterStudent[] }

  const [subsRes, gsRes] = await Promise.all([
    supabase
      .from('homework_submissions')
      .select('student_id, status, score, submitted_at')
      .eq('homework_id', homeworkId),
    supabase
      .from('group_students')
      .select('group_id, student_id, students(id, profile_id, profiles(full_name))')
      .in('group_id', groups.map(group => group.id)),
  ])

  const subMap = new Map<string, any>()
  for (const submission of (subsRes.data ?? []) as any[]) subMap.set(submission.student_id, submission)

  const groupsById = new Map(groups.map(group => [group.id, group] as const))
  const grouped = new Map<string, ReviewRosterStudent[]>()
  for (const group of groups) grouped.set(group.id, [])

  for (const row of (gsRes.data ?? []) as any[]) {
    const group = groupsById.get(row.group_id)
    if (!group) continue
    const submission = subMap.get(row.student_id)
    grouped.get(group.id)?.push({
      studentId: row.student_id,
      name: row.students?.profiles?.full_name || 'Без имени',
      profileId: row.students?.profile_id || '',
      groupId: group.id,
      groupName: group.name,
      status: (submission?.status ?? 'not_submitted') as ReviewRosterStudent['status'],
      score: submission?.score ?? null,
      submittedAt: submission?.submitted_at ?? null,
    })
  }

  const students = groups.flatMap(group =>
    (grouped.get(group.id) ?? []).sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      return statusDiff !== 0 ? statusDiff : a.name.localeCompare(b.name, 'ru')
    }),
  )

  return { homework, students }
}
