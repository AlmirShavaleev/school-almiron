export interface TeacherGroupRow {
  name: string
  upcoming_exams: { id: string; title: string; starts_at: string | null }[]
}

interface UpcomingExam {
  id: string
  title: string
  groupName: string
  startsAt: string
}

export interface TeacherHomeData {
  upcoming: UpcomingExam[]
}

export function teacherHomeData(rows: TeacherGroupRow[]): TeacherHomeData {
  const upcoming: UpcomingExam[] = []
  for (const group of rows) {
    for (const exam of group.upcoming_exams) {
      if (exam.starts_at) upcoming.push({ id: exam.id, title: exam.title, startsAt: exam.starts_at, groupName: group.name })
    }
  }

  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title, 'ru'))
  return { upcoming }
}

/** Московская дата для шапки и окно ближайших пробников. */
export function teacherHomePeriod(now: Date) {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })
  return { today, now: now.toISOString(), nextWeek: new Date(now.getTime() + 7 * 86_400_000).toISOString() }
}

export function bannerDate(day: string) {
  const date = new Date(`${day}T12:00:00Z`)
  const text = date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}
