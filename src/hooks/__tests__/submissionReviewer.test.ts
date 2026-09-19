import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const reviewer = readFileSync('src/components/SubmissionReviewer.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/_legacy/017_annotation_sets.sql', 'utf8')

describe('submission annotation reviewer', () => {
  // §185: три блока, читавшие `HomeworkReviewPage.tsx` и `StudentReviewPage.tsx`,
  // сняты вместе с этими страницами — старый контур ДЗ удалён. Сам
  // `SubmissionReviewer` не тронут: его ветка `submissionId` осталась в силе
  // (зона §184), но живого экрана-потребителя у неё сейчас нет.
  it('normalizes legacy URLs, uses signed URLs and retries file loading', () => {
    // Бакет параметризован (старый контур — 'homeworks' по умолчанию,
    // новый — 'topic-homework-attempts'), но нормализация пути и порядок
    // filePaths/filePath остались те же.
    expect(reviewer).toContain("extractStoragePath(path, bucket) ?? path")
    expect(reviewer).toContain("const raw = filePaths?.length ? filePaths : [filePath]")
    expect(reviewer).toContain("getSignedFileUrl(bucket, path)")
    expect(reviewer).toContain("bucket = 'homeworks'")
  })

  it('lets the teacher nudge and resize an existing region — the AI misses by a few pixels, not by a page', () => {
    expect(reviewer).toContain('function beginRegionEdit(')
    expect(reviewer).toContain('async function commitRegionRect(')
    // Выделение отдельно от подсветки: ручки не должны появляться под курсором.
    expect(reviewer).toContain('const [selectedId, setSelectedId] = useState<string | null>(null)')
    expect(reviewer).toContain('selected={!readOnly && mark.id === selectedId}')
    expect(reviewer).toContain('data-testid={`region-handle-${item.handle}`}')
    expect(reviewer).toContain('HANDLE_CURSOR[item.handle]')
    // Стрелками — «чуть-чуть», Shift+стрелки меняют размер.
    expect(reviewer).toContain('NUDGE_STEP = 0.003')
    expect(reviewer).toContain('ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]')
    expect(reviewer).toContain('event.shiftKey')
    // Правка стрелками уходит в базу на отпускании клавиши, а не по таймеру.
    expect(reviewer).toContain('async function flushNudge()')
    expect(reviewer).toContain("window.addEventListener('keyup', onKeyUp)")
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
    // §209: к прежним пяти категориям добавлены три типа замечания.
    expect(reviewer).toContain("type Category = 'error' | 'inaccuracy' | 'good' | 'comment' | 'calc' | 'logic' | 'format' | 'praise'")
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

  // §197: три блока про `/inbox` — очередь подборок, её страницу, хук и
  // строку списка — сняты вместе с контуром «Этапа 4». Аннотатор к той очереди
  // отношения не имел: он живёт на `/homework-queue` и в карточке попытки.

  it('keeps author immutable and annotations inaccessible to anon', () => {
    expect(migration).toContain('annotation_sets_author_immutable')
    expect(migration).toContain('revoke all on table annotation_sets from anon')
    expect(migration).toContain('unique (submission_id, file_path, page)')
  })
})
