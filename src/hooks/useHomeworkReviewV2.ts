import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { describeHomeworkV2Error } from '@/lib/homeworkV2Errors'

export type HomeworkReviewDecision = 'accepted' | 'returned_for_revision' | 'rejected'

export function useHomeworkReviewV2() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function review(attemptId: string, decision: HomeworkReviewDecision, score: number | null, comment: string) {
    setSubmitting(true)
    setError(null)
    try {
      // p_score/p_comment are nullable in the DB function (no CHECK requiring a value), but the
      // Supabase type generator doesn't mark params without a SQL DEFAULT as optional/nullable —
      // cast only these two fields rather than the whole call.
      const { data, error: err } = await supabase.rpc('submit_homework_review', {
        p_attempt_id: attemptId,
        p_decision: decision,
        p_score: score as unknown as number,
        p_comment: (comment || null) as unknown as string,
      })
      if (err) throw err
      return data
    } catch (e: any) {
      setError(describeHomeworkV2Error(e?.message) || 'Не удалось сохранить проверку')
      throw e
    } finally {
      setSubmitting(false)
    }
  }

  return { review, submitting, error }
}
