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
    // Бакет параметризован (старый контур — 'homeworks' по умолчанию,
    // новый — 'topic-homework-attempts'), но нормализация пути и порядок
    // filePaths/filePath остались те же.
    expect(reviewer).toContain("extractStoragePath(path, bucket) ?? path")
    expect(reviewer).toContain("const raw = filePaths?.length ? filePaths : [filePath]")
    expect(reviewer).toContain("getSignedFileUrl(bucket, path)")
    expect(reviewer).toContain("bucket = 'homeworks'")
  })

  it('targets exactly one contour — legacy submission or topic-homework attempt', () => {
    // Взаимоисключимость целей держится на этапе компиляции (?: never),
    // как CHECK annotation_sets_one_target_chk в базе.
    expect(reviewer).toContain('{ submissionId: string; attemptId?: never }')
    expect(reviewer).toContain('{ attemptId: string; submissionId?: never }')
    expect(reviewer).toContain("const targetColumn = attemptId ? 'attempt_id' : 'submission_id'")
    expect(reviewer).toContain('const targetId = attemptId ?? submissionId')
    expect(reviewer).toContain('.eq(targetColumn, targetId)')
    expect(reviewer).toContain('onConflict: `${targetColumn},file_path,page`')
    // Ключ дедупликации сохранений должен включать колонку: иначе попытка и
    // сдача с одинаковым uuid делили бы одну очередь inflight-сохранений.
    expect(reviewer).toContain('`${targetColumn}:${targetId}:${normalizedPaths.join(\'|\')}`')
  })

  it('is integrated into both new-contour review surfaces and the student view', () => {
    const overlay = readFileSync('src/components/courseProgram/AttemptAnnotationOverlay.tsx', 'utf8')
    const modal = readFileSync('src/components/courseProgram/HomeworkAttemptDetailModal.tsx', 'utf8')
    const reviewQueue = readFileSync('src/pages/HomeworkReviewQueuePage.tsx', 'utf8')
    const student = readFileSync('src/components/courseProgram/TopicHomeworkStudent.tsx', 'utf8')
    const newMigration = readFileSync(
      'supabase/migrations/20260730095422_annotation_sets_topic_homework_attempts.sql', 'utf8',
    )

    // Аннотатор грузится лениво — 450 КБ pdfjs не должны попадать в общий бандл.
    expect(overlay).toContain("lazy(() => import('@/components/SubmissionReviewer'))")
    expect(overlay).toContain('bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}')
    expect(overlay).toContain('attemptId={attemptId}')

    expect(modal).toContain('<AttemptAnnotationOverlay')
    expect(reviewQueue).toContain('<AttemptAnnotationOverlay')
    // В очереди вердикт и публикация пометок — одно нажатие, пометки первыми.
    expect(reviewQueue).toContain('const ok = await publishAnnotations(')
    expect(reviewQueue).toContain('await reviewAttempt(attemptId, decision, comment, score)')

    // Ученик видит рамки только для чтения и только там, где они опубликованы.
    expect(student).toContain('readOnly')
    expect(student).toContain("eq('status', 'published')")

    expect(newMigration).toContain('num_nonnulls(submission_id, attempt_id) = 1')
    expect(newMigration).toContain('annotation_sets_attempt_file_page_key')
    expect(newMigration).toContain('topic_homework_attempt_can_review(attempt_id)')
    expect(newMigration).toContain('topic_homework_attempt_is_own(attempt_id)')
  })

  it('оставляет ровно одну кнопку публикации там, где действие принимает внешняя форма', () => {
    // Владелец: «процесс опубликовать не очень понятно, вроде как это кнопка
    // отправила автоматически работу на доработку». Причина — две зелёные
    // кнопки рядом: «Опубликовать» в тулбаре аннотатора и «Принять/Вернуть»
    // в форме вердикта. Тулбарную в этих местах убираем.
    const modal = readFileSync('src/components/courseProgram/HomeworkAttemptDetailModal.tsx', 'utf8')
    const reviewQueue = readFileSync('src/pages/HomeworkReviewQueuePage.tsx', 'utf8')

    expect(reviewer).toContain('hideToolbarPublish')
    expect(reviewer).toContain('{!hideToolbarPublish && <button type="button" data-testid="review-toolbar-publish-button"')
    expect(modal).toContain('hideToolbarPublish')
    expect(reviewQueue).toContain('hideToolbarPublish')
    // В очереди вердикт публикует пометки сам — об этом сказано в подсказке.
    expect(reviewQueue).toContain('hint=')
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
