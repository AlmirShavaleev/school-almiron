import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface WorkAttachment {
  id:           string
  storage_path: string
  file_name:    string
  file_size:    number | null
  mime_type:    string | null
  uploaded_at:  string
}

export interface WorkAnswerDetail {
  answer_raw:        string | null
  answer_normalized: string | null
  is_correct:        boolean | null
  points_earned:     number | null
  points_max:        number | null
  manual_points:     number | null
  teacher_comment:   string | null
  grading_status:    'auto_graded' | 'pending_review' | 'not_answered' | 'graded'
  has_attachment:    boolean
  graded_at:         string | null
}

export interface WorkItem {
  item_id:             string
  item_position:       number
  points:              number
  grading_type:        'auto' | 'manual'
  statement_html:      string
  answer_html:         string | null
  solution_html:       string | null
  grade_criteria_html: string | null
  has_answer:          boolean
  answer:              WorkAnswerDetail
  attachments:         WorkAttachment[]
}

export interface StudentWorkDetail {
  id:                   string
  assignment_id:        string
  variant_id:           string
  student_id:           string
  student_name:         string | null
  group_name:           string | null
  variant_title:        string
  status:               string
  grading_status:       'not_submitted' | 'auto_graded' | 'needs_review' | 'graded'
  auto_score:           number | null
  score:                number | null
  max_score:            number | null
  percentage:           number | null
  answered_count:       number | null
  correct_count:        number | null
  manual_review_count:  number | null
  started_at:           string | null
  submitted_at:         string | null
  completed_at:         string | null
  due_at:               string | null
  reviewed_at:          string | null
  attempts_used:        number
  items:                WorkItem[]
}

interface GradeState {
  points:  string
  comment: string
  saving:  boolean
  saved:   boolean
  error:   string | null
}

export function useVariantStudentWork(studentAssignmentId: string | undefined) {
  const [work, setWork]         = useState<StudentWorkDetail | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [grades, setGrades]     = useState<Record<string, GradeState>>({})
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [finalizeOk, setFinalizeOk] = useState(false)

  const load = useCallback(async () => {
    if (!studentAssignmentId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await db.rpc('get_student_work_detail', {
        p_student_assignment_id: studentAssignmentId,
      })
      if (e) throw e
      const detail = data as StudentWorkDetail
      setWork(detail)

      // Pre-fill grade state from existing graded answers
      const initial: Record<string, GradeState> = {}
      for (const item of (detail.items ?? [])) {
        if (item.grading_type === 'manual') {
          initial[item.item_id] = {
            points:  item.answer?.manual_points?.toString() ?? '',
            comment: item.answer?.teacher_comment ?? '',
            saving:  false,
            saved:   item.answer?.grading_status === 'graded',
            error:   null,
          }
        }
      }
      setGrades(initial)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки работы')
    } finally {
      setLoading(false)
    }
  }, [studentAssignmentId])

  const setGradeField = useCallback((itemId: string, field: 'points' | 'comment', value: string) => {
    setGrades(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { points: '', comment: '', saving: false, saved: false, error: null }), [field]: value, saved: false },
    }))
  }, [])

  const saveGrade = useCallback(async (itemId: string, maxPoints: number) => {
    const g = grades[itemId]
    if (!g || !studentAssignmentId) return

    const pts = parseFloat(g.points)
    if (isNaN(pts) || pts < 0 || pts > maxPoints) {
      setGrades(prev => ({ ...prev, [itemId]: { ...prev[itemId], error: `Балл от 0 до ${maxPoints}` } }))
      return
    }

    setGrades(prev => ({ ...prev, [itemId]: { ...prev[itemId], saving: true, error: null } }))

    try {
      const { error: e } = await db.rpc('grade_variant_answer', {
        p_student_assignment_id: studentAssignmentId,
        p_variant_item_id:       itemId,
        p_points:                pts,
        p_comment:               g.comment || null,
      })
      if (e) throw e
      setGrades(prev => ({ ...prev, [itemId]: { ...prev[itemId], saving: false, saved: true } }))
      // Update local work state
      setWork(prev => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map(item => item.item_id !== itemId ? item : {
            ...item,
            answer: { ...item.answer, manual_points: pts, teacher_comment: g.comment || null, grading_status: 'graded' as const },
          }),
        }
      })
    } catch (err: unknown) {
      setGrades(prev => ({
        ...prev,
        [itemId]: { ...prev[itemId], saving: false, error: err instanceof Error ? err.message : 'Ошибка сохранения' },
      }))
    }
  }, [grades, studentAssignmentId])

  const finalizeGrading = useCallback(async () => {
    if (!studentAssignmentId) return
    setFinalizing(true)
    setFinalizeError(null)
    try {
      const { data, error: e } = await db.rpc('finalize_grading', {
        p_student_assignment_id: studentAssignmentId,
      })
      if (e) throw e
      setFinalizeOk(true)
      setWork(prev => prev ? {
        ...prev,
        grading_status: 'graded',
        score:          (data as any)?.score ?? prev.score,
        percentage:     (data as any)?.percentage ?? prev.percentage,
        reviewed_at:    (data as any)?.reviewed_at ?? new Date().toISOString(),
      } : prev)
    } catch (err: unknown) {
      setFinalizeError(err instanceof Error ? err.message : 'Ошибка завершения проверки')
    } finally {
      setFinalizing(false)
    }
  }, [studentAssignmentId])

  return {
    work, loading, error, load,
    grades, setGradeField, saveGrade,
    finalizing, finalizeError, finalizeOk,
    finalizeGrading,
  }
}
