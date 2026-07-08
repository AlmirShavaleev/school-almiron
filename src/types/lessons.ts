export type MaterialType = 'file' | 'link' | 'recording' | 'board' | 'note'

export interface LessonMaterial {
  id:                    string
  lesson_id:             string
  created_by:            string
  material_type:         MaterialType
  title:                 string | null
  url:                   string | null
  storage_path:          string | null
  position:              number
  is_visible_to_student: boolean
  created_at:            string
}

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  file:      'Файл',
  link:      'Ссылка',
  recording: 'Запись занятия',
  board:     'Доска',
  note:      'Комментарий',
}

/**
 * Returned by get_lesson_summary RPC. teacher_notes is nulled server-side
 * for any caller who isn't the owning teacher or admin/owner — never rely
 * on the frontend to hide it, the RPC already guarantees this.
 */
export interface LessonSummary {
  planned_topic:    string | null
  actual_topic:     string | null
  lesson_summary:   string | null
  student_feedback: string | null
  teacher_notes:    string | null
  recommendations:  string | null
  board_url:        string | null
  meeting_url:      string | null
  completed_at:     string | null
}

export const EMPTY_LESSON_SUMMARY: LessonSummary = {
  planned_topic: null, actual_topic: null, lesson_summary: null,
  student_feedback: null, teacher_notes: null, recommendations: null,
  board_url: null, meeting_url: null, completed_at: null,
}
