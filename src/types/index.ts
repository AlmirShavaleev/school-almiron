export type UserRole = 'student' | 'teacher' | 'curator' | 'admin' | 'owner'
export type HomeworkStatus = 'not_submitted' | 'submitted' | 'checked' | 'revision'
export type LessonStatus = 'scheduled' | 'completed' | 'cancelled'
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'refunded'
export type LeagueType = 'bronze' | 'silver' | 'gold' | 'platinum' | 'academic'
export type SubjectType = 'physics' | 'math'
export type ExamType = 'ege' | 'oge'

export interface Profile {
  id: string
  email: string
  full_name: string
  phone?: string
  avatar_url?: string
  role: UserRole
  created_at: string
  updated_at: string
}

export interface Student {
  id: string
  profile_id: string
  grade: number
  target_exam: ExamType
  target_subject: SubjectType
  target_score?: number
  xp_points: number
  league: LeagueType
  is_active: boolean
  notes?: string
  created_at: string
  profile?: Profile
}

export interface Teacher {
  id: string
  profile_id: string
  subjects: SubjectType[]
  bio?: string
  hourly_rate?: number
  rating: number
  created_at: string
  profile?: Profile
}

export interface Curator {
  id: string
  profile_id: string
  created_at: string
  profile?: Profile
}

export interface Course {
  id: string
  title: string
  subject: SubjectType
  exam_type: ExamType
  description?: string
  price: number
  duration_weeks?: number
  start_date?: string | null            // 'YYYY-MM-DD' — когда курс становится доступен
  end_date?: string | null              // 'YYYY-MM-DD' — когда курс заканчивается
  enrollment_open_until?: string | null // 'YYYY-MM-DD' — дедлайн записи
  is_active: boolean
  created_at: string
}

export type CourseAvailability = 'upcoming' | 'active' | 'ended' | 'undated'

export function getCourseAvailability(c: Pick<Course, 'start_date' | 'end_date'>): CourseAvailability {
  if (!c.start_date && !c.end_date) return 'undated'
  const today = new Date().toISOString().slice(0, 10)
  if (c.start_date && today < c.start_date) return 'upcoming'
  if (c.end_date && today > c.end_date)    return 'ended'
  return 'active'
}

export interface Group {
  id: string
  name: string
  course_id?: string
  teacher_id?: string
  curator_id?: string
  max_students: number
  schedule_days?: string[]
  schedule_time?: string
  is_active: boolean
  created_at: string
  course?: Course
  teacher?: Teacher
  curator?: Curator
  student_count?: number
}

export interface Lesson {
  id: string
  group_id: string
  topic_id?: string
  teacher_id: string
  title: string
  scheduled_at: string
  duration_minutes: number
  status: LessonStatus
  zoom_link?: string
  recording_url?: string
  notes?: string
  created_at: string
  group?: Group
  teacher?: Teacher
}

export interface Attendance {
  id: string
  lesson_id: string
  student_id: string
  present: boolean
  late: boolean
  excuse?: string
  marked_at?: string
}

export interface Homework {
  id: string
  lesson_id?: string
  group_id: string
  topic_id?: string
  title: string
  description?: string
  due_date: string
  max_score: number
  created_by: string
  created_at: string
  group?: Group
  submission?: HomeworkSubmission
}

export interface HomeworkSubmission {
  id: string
  homework_id: string
  student_id: string
  status: HomeworkStatus
  answer_text?: string
  file_url?: string
  score?: number
  feedback?: string
  submitted_at?: string
  checked_at?: string
  checked_by?: string
}

export interface MockExam {
  id: string
  title: string
  subject: SubjectType
  exam_type: ExamType
  group_id?: string
  date: string
  max_score: number
  created_by?: string
  created_at: string
}

export interface MockExamResult {
  id: string
  mock_exam_id: string
  student_id: string
  score: number
  part1_score?: number
  part2_score?: number
  notes?: string
  created_at: string
  mock_exam?: MockExam
}

export interface Payment {
  id: string
  student_id: string
  amount: number
  status: PaymentStatus
  description?: string
  due_date: string
  paid_at?: string
  created_at: string
  student?: Student
}

export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error'
  read: boolean
  created_at: string
}

export interface LeaderboardEntry {
  student_id: string
  full_name: string
  xp_points: number
  league: LeagueType
  rank: number
}
