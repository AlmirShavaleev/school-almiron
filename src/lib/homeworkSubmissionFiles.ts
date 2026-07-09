export interface HomeworkSubmissionFileRow {
  id?: string
  storage_path: string
  mime_type?: string | null
  position: number
  created_at?: string | null
}

export interface LegacyHomeworkSubmissionLike {
  id?: string
  file_url?: string | null
  homework_submission_files?: HomeworkSubmissionFileRow[] | null
}

export function getOrderedSubmissionFiles(files: HomeworkSubmissionFileRow[] | null | undefined): HomeworkSubmissionFileRow[] {
  return [...(files || [])].sort((a, b) => a.position - b.position || a.storage_path.localeCompare(b.storage_path))
}

export function getSubmissionFilePaths(submission: LegacyHomeworkSubmissionLike | null | undefined): string[] {
  const files = getOrderedSubmissionFiles(submission?.homework_submission_files)
  if (files.length > 0) return files.map(file => file.storage_path)
  return submission?.file_url ? [submission.file_url] : []
}

export function getPrimarySubmissionFilePath(submission: LegacyHomeworkSubmissionLike | null | undefined): string | null {
  return getSubmissionFilePaths(submission)[0] ?? null
}

export async function fetchHomeworkSubmissionFilesMap(
  db: { from: (table: string) => { select: (columns: string) => { in: (column: string, values: string[]) => Promise<{ data: Array<HomeworkSubmissionFileRow & { submission_id: string }> | null; error: { message?: string } | null }> } } },
  submissionIds: string[],
): Promise<Record<string, HomeworkSubmissionFileRow[]>> {
  const ids = [...new Set(submissionIds.filter(Boolean))]
  if (!ids.length) return {}

  const { data, error } = await db
    .from('homework_submission_files')
    .select('submission_id,id,storage_path,mime_type,position,created_at')
    .in('submission_id', ids)

  if (error) throw new Error(error.message || 'Не удалось загрузить файлы сдачи')

  const bySubmission: Record<string, HomeworkSubmissionFileRow[]> = {}
  for (const row of data || []) {
    ;(bySubmission[row.submission_id] ||= []).push(row)
  }
  for (const submissionId of Object.keys(bySubmission)) {
    bySubmission[submissionId] = getOrderedSubmissionFiles(bySubmission[submissionId])
  }
  return bySubmission
}
