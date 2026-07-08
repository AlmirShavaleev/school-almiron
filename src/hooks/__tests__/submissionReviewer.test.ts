import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const reviewer = readFileSync('src/components/SubmissionReviewer.tsx', 'utf8')
const reviewListPage = readFileSync('src/pages/HomeworkReviewPage.tsx', 'utf8')
const homeworks = readFileSync('src/hooks/useHomeworks.ts', 'utf8')
const migration = readFileSync('supabase/migrations/017_annotation_sets.sql', 'utf8')
const studentReviewPage = readFileSync('src/pages/StudentReviewPage.tsx', 'utf8')
const queueItem = readFileSync('src/components/queue/QueueItem.tsx', 'utf8')
const queuePage = readFileSync('src/pages/HomeworkQueuePage.tsx', 'utf8')
const queueHook = readFileSync('src/hooks/useHomeworkQueue.ts', 'utf8')

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

  it('is integrated into the homework review pages', () => {
    expect(reviewListPage).toContain('/review/student/')
    expect(studentReviewPage).toContain('<SubmissionReviewer')
    expect(studentReviewPage).toContain("onPublish={() => handleSave('checked')}")
  })

  it('loads the student own file and uses the reviewer read-only', () => {
    expect(homeworks).toContain('student_id,file_url')
    expect(readFileSync('src/pages/HomeworksPage.tsx', 'utf8')).toContain('filePath={studentReview.file_url} readOnly')
  })

  it('is integrated into the per-student review page in teacher mode, only for previewable files', () => {
    expect(studentReviewPage).toContain("const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))")
    expect(studentReviewPage).toContain("PREVIEWABLE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']")
    expect(studentReviewPage).toContain("onPublish={() => handleSave('checked')}")
    expect(studentReviewPage).not.toMatch(/<SubmissionReviewer[^>]*readOnly/)
    expect(studentReviewPage).toContain('<SignedFileLink')
  })

  it('navigates queue items straight into the full review pages', () => {
    expect(queueItem).toContain("item.source === 'collection'")
    expect(queueItem).toContain("`/homeworks/${item.homework.id}/review/${item.group.id}/${item.student.id}`")
    expect(queuePage).not.toContain('onQuickReview')
  })

  it('adds a checked submissions tab backed by group-scoped legacy and collection review statuses', () => {
    expect(queuePage).toContain("setMode('checked')")
    expect(queuePage).toContain('Проверенные')
    expect(queueHook).toContain("export type QueueMode = 'pending' | 'checked'")
    expect(queueHook).toContain(".eq('status', 'checked')")
    expect(queueHook).toContain(".in('status', ['accepted', 'rejected'])")
    expect(queueHook).toContain(".order('checked_at', { ascending: false }).limit(checkedLimit)")
    expect(queueHook).toContain(".order('reviewed_at', { ascending: false }).limit(checkedLimit)")
    expect(queuePage).toContain('Показать ещё')
  })

  it('auto-advances to the next student after a full publish, or returns to the group list when none remain — for both file and no-file submissions', () => {
    expect(studentReviewPage).toContain("nextAdvanceRef.current = next ? next.studentId : 'list'")
    expect(studentReviewPage).toContain("const listPath = groupId ? `/homeworks/${hwId}/review/${groupId}` : `/homeworks/${hwId}/review`")
    expect(studentReviewPage).toContain("if (next === 'list') navigate(listPath)")
    expect(studentReviewPage).toContain("function finishReview(success: boolean, message = 'Проверка опубликована')")
    expect(studentReviewPage).toContain('onPublishComplete={finishReview}')
    expect(studentReviewPage).toContain('{!canPreview && (')
    expect(studentReviewPage).toContain("handleSave('checked').then(ok => finishReview(ok))")
    expect(studentReviewPage).toContain("handleSave('revision').then(ok => finishReview(ok, 'Отправлено на доработку'))")
  })

  it('removes the topic quick-review modal from the queue page', () => {
    expect(queuePage).not.toContain('ReviewTopicSubmissionModal')
    expect(queuePage).toContain('<QueueList')
    expect(queuePage).toContain("groupBy={mode === 'pending' ? groupBy : 'flat'}")
  })

  it('keeps author immutable and annotations inaccessible to anon', () => {
    expect(migration).toContain('annotation_sets_author_immutable')
    expect(migration).toContain('revoke all on table annotation_sets from anon')
    expect(migration).toContain('unique (submission_id, file_path, page)')
  })
})
