export interface TeacherGroupRow {
  id: string
  name: string
  course_id: string
  courses: { title: string } | null
  group_students: { student_id: string; joined_at: string; students: { is_active: boolean | null } | null }[]
  result_exams: { mock_exam_results: { student_id: string }[] }[]
  upcoming_exams: { id: string; title: string; starts_at: string | null }[]
}

interface TeacherGroup {
  id: string
  name: string
  courseTitle: string
  students: number
  enrolled: number
  withResult: number
}

interface UpcomingExam {
  id: string
  title: string
  groupName: string
  startsAt: string
}

export interface TeacherHomeData {
  groups: TeacherGroup[]
  students: number
  enrolled: number
  withResult: number
  upcoming: UpcomingExam[]
}

export function teacherHomeData(rows: TeacherGroupRow[], from: string, now: string): TeacherHomeData {
  const students = new Set<string>()
  const enrolled = new Set<string>()
  const withResult = new Set<string>()
  const upcoming: UpcomingExam[] = []
  const startMs = Date.parse(from)
  const endMs = Date.parse(now)

  const groups = rows.map(group => {
    const members = new Set<string>()
    const joined = new Set<string>()
    const received = new Set<string>()
    for (const member of group.group_students) {
      if (!member.students || member.students.is_active === false) continue
      members.add(member.student_id)
      students.add(member.student_id)
      const joinedAt = Date.parse(member.joined_at)
      if (joinedAt >= startMs && joinedAt <= endMs) {
        joined.add(member.student_id)
        enrolled.add(member.student_id)
      }
    }
    for (const exam of group.result_exams) {
      for (const result of exam.mock_exam_results) {
        if (!members.has(result.student_id)) continue
        received.add(result.student_id)
        withResult.add(result.student_id)
      }
    }
    for (const exam of group.upcoming_exams) {
      if (exam.starts_at) upcoming.push({ id: exam.id, title: exam.title, startsAt: exam.starts_at, groupName: group.name })
    }
    return {
      id: group.id, name: group.name, courseTitle: group.courses?.title ?? '',
      students: members.size, enrolled: joined.size, withResult: received.size,
    }
  })

  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title, 'ru'))
  return { groups, students: students.size, enrolled: enrolled.size, withResult: withResult.size, upcoming }
}

/** Сегодня и предыдущие 29 календарных дней по Москве. */
export function teacherHomePeriod(now: Date) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
  const start = new Date(`${today}T00:00:00+03:00`)
  start.setUTCDate(start.getUTCDate() - 29)
  return { today, from: start.toISOString(), now: now.toISOString(), nextWeek: new Date(now.getTime() + 7 * 86_400_000).toISOString() }
}

export function bannerDate(day: string) {
  const date = new Date(`${day}T12:00:00Z`)
  const text = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}
