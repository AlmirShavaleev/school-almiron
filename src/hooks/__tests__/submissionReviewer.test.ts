import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const reviewer = readFileSync('src/components/SubmissionReviewer.tsx', 'utf8')
const reviewListPage = readFileSync('src/pages/HomeworkReviewPage.tsx', 'utf8')
const homeworks = readFileSync('src/hooks/useHomeworks.ts', 'utf8')
const migration = readFileSync('supabase/migrations/_legacy/017_annotation_sets.sql', 'utf8')
const studentReviewPage = readFileSync('src/pages/StudentReviewPage.tsx', 'utf8')
const queueItem = readFileSync('src/components/queue/QueueItem.tsx', 'utf8')
const queuePage = readFileSync('src/pages/HomeworkQueuePage.tsx', 'utf8')
const queueHook = readFileSync('src/hooks/useHomeworkQueue.ts', 'utf8')

describe('submission annotation reviewer', () => {
  it('normalizes legacy URLs, uses signed URLs and retries file loading', () => {
    expect(reviewer).toContain("extractStoragePath(path, 'homeworks') ?? path")
    expect(reviewer).toContain("const raw = filePaths?.length ? filePaths : [filePath]")
    expect(reviewer).toContain("getSignedFileUrl('homeworks', path)")
  })

  it('stores normalized region comments and supports pointer input', () => {
    expect(reviewer).toContain("viewBox=\"0 0 1 1\"")
    expect(reviewer).toContain('onPointerDown={pointerDown}')
    expect(reviewer).toContain("'cursor-crosshair'")
    expect(reviewer).toContain("type: 'region'")
    expect(reviewer).toContain("type Category = 'comment' | 'calc' | 'logic' | 'format' | 'praise'")
    expect(reviewer).toContain('MIN_REGION_SIZE = 0.015')
    expect(reviewer).toContain('version: 2')
  })

  it('saves and deletes region comments immediately — no debounce window where a fast navigate-away could lose one', () => {
    expect(reviewer).toContain('async function saveDraft()')
    expect(reviewer).toContain('async function deleteRegion(')
    expect(reviewer).toContain('await savePage(draft.filePath, draft.page, nextData)')
    expect(reviewer).toContain('await savePage(item.filePath, item.page, nextData)')
    expect(reviewer).not.toContain('setTimeout(() =>')
  })

  it('is integrated into the homework review pages', () => {
    expect(reviewListPage).toContain('/review/student/')
    expect(studentReviewPage).toContain('<SubmissionReviewer')
    expect(studentReviewPage).toContain("onPublish={isHistoricalAttempt ? undefined : publishReview}")
  })

  it('loads the student own file and uses the reviewer read-only', () => {
    expect(homeworks).toContain('student_id,file_url')
    const homeworksPage = readFileSync('src/pages/HomeworksPage.tsx', 'utf8')
    expect(homeworksPage).toContain('filePath={studentReview.file_url}')
    expect(homeworksPage).toContain('filePaths={studentReview.filePaths}')
    expect(homeworksPage).toContain('readOnly')
  })

  it('is integrated into the per-student review page in teacher mode, only for previewable files', () => {
    expect(studentReviewPage).toContain("const SubmissionReviewer = lazy(() => import('@/components/SubmissionReviewer'))")
    expect(studentReviewPage).toContain("PREVIEWABLE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']")
    expect(studentReviewPage).toContain("function publishReview(targetStatus: 'checked' | 'revision' = 'checked')")
    expect(studentReviewPage).toContain("annotationVisibility={isHistoricalAttempt ? 'all' : undefined}")
    expect(studentReviewPage).toContain('<SignedFileLink')
  })

  it('navigates queue items straight into the full review pages', () => {
    expect(queueItem).toContain('getQueueItemReviewPath(item)')
    expect(queuePage).not.toContain('onQuickReview')
  })

  it('adds a checked submissions tab backed by group-scoped legacy and collection review statuses', () => {
    expect(queuePage).toContain("setMode('checked')")
    expect(queuePage).toContain("setMode('returned')")
    expect(queuePage).toContain('Проверенные')
    expect(queuePage).toContain('На доработке')
    expect(queueHook).toContain("export type QueueMode = Exclude<ReviewQueueMode, 'all'>")
    expect(queueHook).toContain("fetchReviewQueuePage(mode")
    expect(queueHook).toContain("fetchReviewQueueCounts(")
    expect(queuePage).toContain('Показать ещё')
  })

  it('auto-advances by the pending review queue after a full publish and falls back to inbox when the queue is empty', () => {
    expect(studentReviewPage).toContain("const queueMode = sub?.status === 'revision' ? 'returned' : 'pending'")
    expect(studentReviewPage).toContain("const next = resolveNextQueueItem(pendingQueueItems, { submissionId: sub?.id || '', source: 'legacy_homework' })")
    expect(studentReviewPage).toContain("toast.success('Всё проверено')")
    expect(studentReviewPage).toContain("navigate('/inbox')")
    expect(studentReviewPage).toContain("navigate(getQueueItemReviewPath(next), { state: { from: 'queue' } })")
    expect(studentReviewPage).toContain("function finishReview(success: boolean, message = 'Проверка опубликована')")
    expect(studentReviewPage).toContain("onPublishComplete={isHistoricalAttempt ? undefined : (success => finishReview(success, publishStatusRef.current === 'revision' ? 'Отправлено на доработку' : 'Проверка опубликована'))}")
    expect(studentReviewPage).toContain('const gradingCard = sub && hw ? (')
    expect(studentReviewPage).toContain('acceptLabel="Принять"')
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
