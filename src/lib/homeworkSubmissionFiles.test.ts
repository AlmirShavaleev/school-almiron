import { describe, expect, it } from 'vitest'
import { getPrimarySubmissionFilePath, getSubmissionFileAttempts, getSubmissionFilePaths } from '@/lib/homeworkSubmissionFiles'

describe('homeworkSubmissionFiles attempt helpers', () => {
  it('groups files by attempt_number and exposes the latest attempt as current', () => {
    const submission = {
      file_url: 'submissions/legacy.pdf',
      homework_submission_files: [
        { storage_path: 'submissions/a-2.pdf', position: 2, attempt_number: 2 },
        { storage_path: 'submissions/a-1.pdf', position: 1, attempt_number: 2 },
        { storage_path: 'submissions/old-1.pdf', position: 1, attempt_number: 1 },
      ],
    }

    expect(getSubmissionFileAttempts(submission)).toEqual({
      attempts: [
        { number: 1, paths: ['submissions/old-1.pdf'] },
        { number: 2, paths: ['submissions/a-1.pdf', 'submissions/a-2.pdf'] },
      ],
      currentAttempt: { number: 2, paths: ['submissions/a-1.pdf', 'submissions/a-2.pdf'] },
    })
    expect(getSubmissionFilePaths(submission)).toEqual(['submissions/a-1.pdf', 'submissions/a-2.pdf'])
    expect(getPrimarySubmissionFilePath(submission)).toBe('submissions/a-1.pdf')
  })

  it('falls back to the legacy single file when file rows are absent', () => {
    const submission = { file_url: 'submissions/legacy.pdf', homework_submission_files: [] }

    expect(getSubmissionFileAttempts(submission)).toEqual({
      attempts: [{ number: 1, paths: ['submissions/legacy.pdf'] }],
      currentAttempt: { number: 1, paths: ['submissions/legacy.pdf'] },
    })
    expect(getSubmissionFilePaths(submission)).toEqual(['submissions/legacy.pdf'])
    expect(getPrimarySubmissionFilePath(submission)).toBe('submissions/legacy.pdf')
  })
})
