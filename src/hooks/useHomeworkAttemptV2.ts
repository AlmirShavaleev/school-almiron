import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { describeHomeworkV2Error, validateAttemptFilesClientSide } from '@/lib/homeworkV2Errors'

/** Start (or resume) a draft attempt, upload files under the server-required prefix, then
 * finalize. The upload path prefix (own uid + attempt id) is enforced by both the storage
 * RLS policy and finalize_homework_attempt itself — this hook can't forge it. Client-side
 * file checks are only a fast-feedback pre-filter; finalize_homework_attempt re-validates
 * everything against storage.objects server-set metadata regardless. */
export function useHomeworkAttemptV2() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitAttempt(assignmentId: string, answerText: string, files: File[]) {
    setSubmitting(true)
    setError(null)
    try {
      const clientError = validateAttemptFilesClientSide(files)
      if (clientError) { setError(clientError); throw new Error(clientError) }

      const { data: startData, error: startErr } = await supabase.rpc('start_homework_attempt', {
        p_assignment_id: assignmentId,
      })
      if (startErr) throw startErr
      const attemptId = (startData as { attempt_id: string }).attempt_id

      const { data: userData } = await supabase.auth.getUser()
      const uid = userData.user?.id
      if (!uid) throw new Error('Не авторизован')

      const uploaded: { storage_path: string; file_name: string; mime_type: string; size: number }[] = []
      for (const file of files) {
        const path = `${uid}/${attemptId}/${Date.now()}-${file.name}`
        const { error: upErr } = await supabase.storage.from('homework-attempts').upload(path, file, { contentType: file.type })
        if (upErr) throw upErr
        uploaded.push({ storage_path: path, file_name: file.name, mime_type: file.type, size: file.size })
      }

      const { data: finalizeData, error: finalizeErr } = await supabase.rpc('finalize_homework_attempt', {
        p_attempt_id: attemptId,
        p_answer_text: answerText,
        p_storage_paths: uploaded.length ? uploaded : null,
      })
      if (finalizeErr) throw finalizeErr
      return finalizeData
    } catch (e: any) {
      setError(prev => prev || describeHomeworkV2Error(e?.message) || 'Не удалось отправить работу')
      throw e
    } finally {
      setSubmitting(false)
    }
  }

  return { submitAttempt, submitting, error }
}
