import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { describeHomeworkV2Error } from '@/lib/homeworkV2Errors'

export interface AssignHomeworkV2Input {
  templateVersionId: string
  groupId: string
  studentIds: string[] | null // null => whole group
  publishNow: boolean
  publishAt: string | null // ISO, required if !publishNow
  dueAt: string // ISO
  maxAttempts: number | null
  allowLate: boolean
}

export function useAssignHomeworkV2() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function assign(input: AssignHomeworkV2Input) {
    setSubmitting(true)
    setError(null)
    try {
      const requestId = crypto.randomUUID()
      // p_student_ids/p_publish_at/p_max_attempts are nullable in the DB function (no SQL
      // DEFAULT NOT NULL), but the generator types them as required — cast only these three.
      const { data, error: err } = await supabase.rpc('assign_homework', {
        p_template_version_id: input.templateVersionId,
        p_group_id: input.groupId,
        p_student_ids: input.studentIds as unknown as string[],
        p_publish_now: input.publishNow,
        p_publish_at: (input.publishNow ? new Date().toISOString() : input.publishAt) as unknown as string,
        p_due_at: input.dueAt,
        p_max_attempts: input.maxAttempts as unknown as number,
        p_allow_late: input.allowLate,
        p_request_id: requestId,
      })
      if (err) throw err
      return data as { assignment_id: string; recipient_count: number }
    } catch (e: any) {
      setError(describeHomeworkV2Error(e?.message) || 'Не удалось назначить ДЗ')
      throw e
    } finally {
      setSubmitting(false)
    }
  }

  return { assign, submitting, error }
}
