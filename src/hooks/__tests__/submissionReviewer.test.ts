import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const reviewer = readFileSync('src/components/SubmissionReviewer.tsx', 'utf8')
const modal = readFileSync('src/components/modals/ReviewHomeworkModal.tsx', 'utf8')
const homeworks = readFileSync('src/hooks/useHomeworks.ts', 'utf8')
const migration = readFileSync('supabase/migrations/017_annotation_sets.sql', 'utf8')
const topicModal = readFileSync('src/components/modals/ReviewTopicSubmissionModal.tsx', 'utf8')
const studentReviewPage = readFileSync('src/pages/StudentReviewPage.tsx', 'utf8')
const queueItem = readFileSync('src/components/queue/QueueItem.tsx', 'utf8')
const queuePage = readFileSync('src/pages/HomeworkQueuePage.tsx', 'utf8')

describe('submission annotation reviewer', () => {
  it('normalizes legacy URLs, uses signed URLs and retries file loading', () => {
    expect(reviewer).toContain("extractStoragePath(filePath, 'homeworks')")
    expect(reviewer).toContain("getSignedFileUrl('homeworks', path)")
    expect(reviewer).toContain('retryUrl')
  })

  it('stores normalized region comments and supports pointer input', () => {
    expect(reviewer).toContain("viewBox=\"0 0 1 1\"")
    expect(reviewer).toContain('onPointerDown={pointerDown}')
    expect(reviewer).toContain("'cursor-crosshair'")
    expect(reviewer).toContain("type: 'region'")
    expect(reviewer).toContain("type Category = 'comment' | 'calc' | 'logic' | 'format' | 'praise'")
    expect(reviewer).toContain('MIN_REGION_SIZE = 0.015')
    expect(reviewer).toContain('version: 2')
    expect(reviewer).toContain('setTimeout(() =>')
    expect(reviewer).toContain('}, 2000)')
  })

  it('is integrated into the legacy teacher review modal', () => {
    expect(modal).toContain('<SubmissionReviewer')
    expect(modal).toContain("onPublish={() => handleSave('checked')}")
  })

  it('loads the student own file and uses the reviewer read-only', () => {
    expect(homeworks).toContain('student_id,file_url')
    expect(readFileSync('src/pages/HomeworksPage.tsx', 'utf8')).toContain('filePath={studentReview.file_url} readOnly')
  })

  it('is integrated into the topic submission review modal in teacher mode, only for previewable files', () => {
    expect(topicModal).toContain("const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))")
    expect(topicModal).toContain("PREVIEWABLE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']")
    expect(topicModal).toContain('canPreview ? (')
    expect(topicModal).toContain('onPublish={() => handleSave(\'checked\')}')
    expect(topicModal).not.toMatch(/<SubmissionReviewer[^>]*readOnly/)
    expect(topicModal).toContain('<SignedFileLink')
  })

  it('is integrated into the per-student review page in teacher mode, only for previewable files', () => {
    expect(studentReviewPage).toContain("const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))")
    expect(studentReviewPage).toContain("PREVIEWABLE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']")
    expect(studentReviewPage).toContain("onPublish={() => handleSave('checked')}")
    expect(studentReviewPage).not.toMatch(/<SubmissionReviewer[^>]*readOnly/)
    expect(studentReviewPage).toContain('<SignedFileLink')
  })

  it('exposes a quick-review button in the queue for legacy submissions only, gated behind stopPropagation', () => {
    expect(queueItem).toContain("item.source !== 'collection' && onQuickReview")
    expect(queueItem).toContain('e.stopPropagation(); onQuickReview(item.submissionId)')
    expect(queueItem).toContain('title="Быстрая проверка"')
  })

  it('auto-advances to the next unchecked submission after a full publish, or closes when none remain — for both file and no-file submissions', () => {
    expect(modal).toContain("nextAdvanceRef.current = nextUnchecked !== -1 ? nextUnchecked : 'close'")
    expect(modal).toContain("if (next === 'close') onClose()")
    expect(modal).toContain("else if (typeof next === 'number') setIndex(next)")
    expect(modal).toContain("function finishReview(success: boolean, message = 'Проверка опубликована')")
    expect(modal).toContain('onPublishComplete={finishReview}')
    // footer "Принять" only for no-file submissions; both buttons route through finishReview
    expect(modal).toContain('{!sub?.file_url && (')
    expect(modal).toContain("handleSave('checked').then(ok => finishReview(ok))")
    expect(modal).toContain("handleSave('revision').then(ok => finishReview(ok, 'Отправлено на доработку'))")
  })

  it('auto-advances to the next student after a full publish, or returns to the group list when none remain — for both file and no-file submissions', () => {
    expect(studentReviewPage).toContain("nextAdvanceRef.current = next ? next.studentId : 'list'")
    expect(studentReviewPage).toContain("if (next === 'list') navigate(`/homeworks/${hwId}/review/${groupId}`)")
    expect(studentReviewPage).toContain("function finishReview(success: boolean, message = 'Проверка опубликована')")
    expect(studentReviewPage).toContain('onPublishComplete={finishReview}')
    expect(studentReviewPage).toContain('{!canPreview && (')
    expect(studentReviewPage).toContain("handleSave('checked').then(ok => finishReview(ok))")
    expect(studentReviewPage).toContain("handleSave('revision').then(ok => finishReview(ok, 'Отправлено на доработку'))")
  })

  it('ReviewTopicSubmissionModal also routes the no-file footer accept button through finishReview (closes the modal)', () => {
    expect(topicModal).toContain("function finishReview(success: boolean, message = 'Проверка опубликована')")
    expect(topicModal).toContain('onPublishComplete={finishReview}')
    expect(topicModal).toContain('{!canPreview && (')
    expect(topicModal).toContain("handleSave('checked').then(ok => finishReview(ok))")
  })

  it('opens the topic submission modal from the queue page and reloads on close/review', () => {
    expect(queuePage).toContain("import { ReviewTopicSubmissionModal } from '@/components/modals/ReviewTopicSubmissionModal'")
    expect(queuePage).toContain('<ReviewTopicSubmissionModal')
    expect(queuePage).toContain('onReviewed={reload}')
    expect(queuePage).toContain('setQuickReviewId(null); reload()')
  })

  it('keeps author immutable and annotations inaccessible to anon', () => {
    expect(migration).toContain('annotation_sets_author_immutable')
    expect(migration).toContain('revoke all on table annotation_sets from anon')
    expect(migration).toContain('unique (submission_id, file_path, page)')
  })
})
