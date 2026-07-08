export interface JournalGroup {
  group_id:   string
  group_name: string
}

export interface JournalStudent {
  id:             string
  full_name:      string
  target_exam:    string | null
  target_subject: string | null
  groups:         JournalGroup[]
}

export interface JournalSummary {
  lessons_completed:  number
  present_count:      number
  late_count:         number
  absent_count:       number
  excused_count:      number   // tracked separately — never counted as attended or missed
  attended:           number   // present_count + late_count
  missed:             number   // absent_count
  attendance_pct:     number | null   // null when no completed lessons have an attendance mark yet; denominator = present+late+absent, excused excluded
  hw_assigned:        number
  hw_submitted_ever:  number
  hw_accepted:        number
  hw_returned:        number
  hw_rejected:        number
  hw_overdue:         number
  hw_on_time:         number
  hw_with_due_date:   number
  avg_score:          number | null  // raw average, never a percentage — no max_score exists in the schema
  scored_count:       number
}

export interface JournalLesson {
  id:                string
  title:             string
  scheduled_at:      string
  duration_minutes:  number | null
  status:            'scheduled' | 'completed' | 'cancelled' | 'missed'
  format:            string
  group_name:        string | null
  planned_topic:     string | null
  actual_topic:      string | null
  lesson_summary:    string | null
  recommendations:   string | null
  attendance_status: 'present' | 'late' | 'absent' | 'excused' | null
  attendance_note:   string | null
}

export type DisplayHomeworkStatus = 'not_started' | 'submitted' | 'returned' | 'accepted' | 'rejected' | 'overdue'

export interface JournalAssignment {
  source:            'legacy' | 'collection'
  assigned_id:       string
  collection_id:     string
  collection_title:  string | null
  lesson_id:         string | null
  topic_id:          string | null
  due_date:          string | null
  created_at:        string
  assignment_status: 'active' | 'closed' | 'cancelled'
  submission_id:     string | null
  submission_status: 'submitted' | 'returned' | 'accepted' | 'rejected' | null
  submitted_at:      string | null
  reviewed_at:       string | null
  score:             number | null
  max_score:         number | null
  teacher_comment:   string | null
}

export interface JournalTrendWeek {
  week_start:        string
  lessons_completed: number
  submitted:         number
  accepted:          number
}

export interface StudentJournal {
  student:     JournalStudent
  summary:     JournalSummary
  lessons:     JournalLesson[]
  assignments: JournalAssignment[]
  trend:       JournalTrendWeek[]
}

/** Computed client-side per assignment — never stored, never sent to the server */
export function getDisplayHomeworkStatus(a: JournalAssignment): DisplayHomeworkStatus {
  if (!a.submission_status) {
    // not started yet — overdue only if a due date has actually passed
    if (a.due_date && new Date(a.due_date) < new Date()) return 'overdue'
    return 'not_started'
  }
  return a.submission_status
}

export function isSubmittedOnTime(a: JournalAssignment): boolean | null {
  if (!a.due_date || !a.submitted_at) return null // insufficient data — never guess
  return new Date(a.submitted_at) <= new Date(a.due_date)
}
