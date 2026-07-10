export interface HomeworkSubmissionFileRow {
  id?: string
  storage_path: string
  mime_type?: string | null
  position: number
  attempt_number?: number | null
  created_at?: string | null
}

export interface LegacyHomeworkSubmissionLike {
  id?: string
  file_url?: string | null
  homework_submission_files?: HomeworkSubmissionFileRow[] | null
}

export interface SubmissionAttemptFiles {
  number: number
  paths: string[]
}

export interface SubmissionFileAttempts {
  attempts: SubmissionAttemptFiles[]
  currentAttempt: SubmissionAttemptFiles | null
}

export function getOrderedSubmissionFiles(files: HomeworkSubmissionFileRow[] | null | undefined): HomeworkSubmissionFileRow[] {
  return [...(files || [])].sort((a, b) =>
    (a.attempt_number ?? 1) - (b.attempt_number ?? 1)
    || a.position - b.position
    || a.storage_path.localeCompare(b.storage_path),
  )
}

export function getSubmissionFilePaths(submission: LegacyHomeworkSubmissionLike | null | undefined): string[] {
  const files = getSubmissionFileAttempts(submission)
  if (files.currentAttempt) return files.currentAttempt.paths
  return submission?.file_url ? [submission.file_url] : []
}

export function getPrimarySubmissionFilePath(submission: LegacyHomeworkSubmissionLike | null | undefined): string | null {
  return getSubmissionFilePaths(submission)[0] ?? null
}

export function getSubmissionFileAttempts(submission: LegacyHomeworkSubmissionLike | null | undefined): SubmissionFileAttempts {
  const files = getOrderedSubmissionFiles(submission?.homework_submission_files)
  if (!files.length) {
    const legacyPaths = submission?.file_url ? [submission.file_url] : []
    const currentAttempt = legacyPaths.length ? { number: 1, paths: legacyPaths } : null
    return { attempts: currentAttempt ? [currentAttempt] : [], currentAttempt }
  }

  const attemptsMap = new Map<number, string[]>()
  for (const file of files) {
    const attemptNumber = file.attempt_number ?? 1
    const list = attemptsMap.get(attemptNumber) ?? []
    list.push(file.storage_path)
    attemptsMap.set(attemptNumber, list)
  }

  const attempts = [...attemptsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, paths]) => ({ number, paths }))

  return {
    attempts,
    currentAttempt: attempts[attempts.length - 1] ?? null,
  }
}

export async function fetchHomeworkSubmissionFilesMap(
  db: { from: (table: string) => { select: (columns: string) => { in: (column: string, values: string[]) => Promise<{ data: Array<HomeworkSubmissionFileRow & { submission_id: string }> | null; error: { message?: string } | null }> } } },
  submissionIds: string[],
): Promise<Record<string, HomeworkSubmissionFileRow[]>> {
  const ids = [...new Set(submissionIds.filter(Boolean))]
  if (!ids.length) return {}

  const { data, error } = await db
    .from('homework_submission_files')
    .select('submission_id,id,storage_path,mime_type,position,attempt_number,created_at')
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
