import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Paperclip, RotateCcw, Sparkles, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { HintNote } from '@/components/shared/HintNote'
import { useAutoGrowTextarea } from '@/hooks/useAutoGrowTextarea'
import { COMMENT_ROWS } from '@/lib/reviewCommentBox'
import { rewriteCommentByTable } from '@/lib/rewriteComment'
import {
  ATTEMPT_STATUS_TONE,
  TEACHER_ATTEMPT_STATUS_LABEL,
  TOPIC_HOMEWORK_ATTEMPTS_BUCKET,
  groupAttemptsByStudent,
  isReviewable,
  latestReview,
  type StudentSubmission,
  type TopicHomeworkAttemptFileRow,
  type TopicHomeworkAttemptRow,
  type TopicHomeworkReviewRow,
} from '@/lib/topicHomework'
import { cn } from '@/utils/cn'

function formatDate(value: string | null): string | null {
  if (!value) return null
  return new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

function AttemptFiles({ files }: { files: TopicHomeworkAttemptFileRow[] }) {
  if (files.length === 0) return <p className="text-xs text-gray-400">Файлов нет</p>
  return (
    <div className="flex flex-wrap gap-2">
      {files.map(f => (
        <SignedFileLink
          key={f.id}
          bucket={TOPIC_HOMEWORK_ATTEMPTS_BUCKET}
          url={f.storage_path}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-primary-600 hover:border-primary-300 hover:underline"
        >
          <Paperclip size={12} />
          {f.file_name}
        </SignedFileLink>
      ))}
    </div>
  )
}

// ─── Форма вердикта ───────────────────────────────────────────────────────────

/** Экспортируется для общей очереди проверки (HomeworkReviewQueuePage). */
export function ReviewActions({
  attempt,
  gradeScale,
  onReview,
  hint,
  above,
  tableScore,
  fillRequest,
  disabledReason,
  canRewriteComment = false,
  columnLayout = false,
}: {
  attempt: TopicHomeworkAttemptRow
  gradeScale?: 'five' | 'hundred' | null
  onReview: (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string, score?: number | null) => Promise<void>
  /**
   * Строка над формой — нужна там, где решение делает не только то, что
   * написано на кнопке (в разборе с рамками оно ещё и публикует пометки).
   */
  hint?: string
  /** Блок над формой вердикта — сюда попадает таблица проверки (§199). */
  above?: React.ReactNode
  /**
   * Почему вердикт сейчас невозможен (§198). Форма остаётся на месте, но
   * выключена целиком: преподаватель видит, что решение здесь бывает, и
   * читает причину — вместо кнопки, нажатие которой заведомо кончится отказом
   * базы. Правило «почему» считает вызывающий (`verdictAccess`), здесь только
   * показ.
   */
  disabledReason?: string | null
  /**
   * §199. Балл, который получается из таблицы проверки по заданиям. Пока
   * преподаватель не вписал своё число — подставляется в поле сам и едет за
   * таблицей при каждой правке вердикта строки. Как только число введено
   * руками, подстановка прекращается: балл — решение человека, и подменять
   * его на ходу нельзя. §212: вместо подмены рядом стоит справка
   * «рекомендуемый балл N» — кнопки «Взять из таблицы» больше нет.
   */
  tableScore?: number | null
  /**
   * Запрос «подставь это в форму». Меняется целиком новым объектом при каждом
   * нажатии, поэтому повторная вставка того же текста тоже срабатывает —
   * сравнение по значению здесь дало бы «кнопка не работает второй раз».
   * Поля перезаписываются, а не дописываются: предложение ИИ — это черновик,
   * который преподаватель дальше правит сам.
   */
  fillRequest?: { comment?: string; score?: number | null } | null
  /**
   * §213. Есть ли из чего переписывать комментарий — то есть непустая ли
   * таблица проверки. Считает вызывающий: таблицу он уже прочитал, и второй
   * запрос ради одной кнопки не нужен.
   *
   * Проп, а не безусловная кнопка: в карточке ученика на странице темы
   * таблицы рядом нет вовсе, и кнопка, которая заведомо ответит «переписывать
   * не из чего», там была бы обещанием без содержания.
   */
  canRewriteComment?: boolean
  /**
   * §210 / §211. Форма стоит в своей колонке (экран проверки), а не в потоке
   * под работой.
   *
   * §210 прижимал комментарий, балл и кнопки к низу колонки, а таблице отдавал
   * отдельный свиток над ними. Владелец посмотрел вживую и попросил иначе:
   * блок стоит ВНИЗУ колонки, за таблицей, и доезжает прокруткой (§211).
   * Прижатие съедало у таблицы 60–70 px на каждой работе, а «Принять» и так
   * нажимают один раз в конце — держать кнопку на виду всё время ради этого
   * не стоит. Колонка со своим свитком (тоже §210) осталась: прокручивается
   * она целиком, вместе с формой.
   *
   * Проп остался ради одного: в карточке ученика на странице темы колонки
   * нет, и там форме нужен отступ сверху (`mt-3`), а в колонке он лишний.
   */
  columnLayout?: boolean
}) {
  const [comment, setComment] = useState('')
  const commentRef = useAutoGrowTextarea(comment)
  const [score, setScore] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Балл введён руками — дальше таблица его не трогает. */
  const [scoreByHand, setScoreByHand] = useState(false)
  /**
   * §213. «Переписать по таблице». Результат живёт ПРЕДЛОЖЕНИЕМ, а не сразу в
   * поле: в поле лежит текст преподавателя, и затирать его молча нельзя —
   * даже если он сам нажал кнопку, он мог нажать её, уже дописав своё.
   */
  const [rewriting, setRewriting] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [rewriteError, setRewriteError] = useState<string | null>(null)

  async function rewriteComment() {
    setRewriting(true)
    setRewriteError(null)
    setSuggestion(null)
    try {
      const result = await rewriteCommentByTable(attempt.id)
      setSuggestion(result.text)
    } catch (e: any) {
      setRewriteError(e?.message ?? 'Не удалось переписать комментарий')
    } finally {
      setRewriting(false)
    }
  }

  useEffect(() => {
    if (!fillRequest) return
    if (typeof fillRequest.comment === 'string') setComment(fillRequest.comment)
    if (fillRequest.score != null) setScore(String(fillRequest.score))
  }, [fillRequest])

  const blocked = Boolean(disabledReason)
  // Балл из таблицы. Только пока поле не тронуто руками: подстановка поверх
  // введённого числа — это спор с человеком, а не помощь ему.
  useEffect(() => {
    if (scoreByHand || tableScore == null) return
    setScore(String(tableScore))
  }, [tableScore, scoreByHand])

  // Комментарий обязателен только при возврате. То же условие держит
  // CHECK topic_homework_reviews_comment_chk — здесь оно ради подсказки,
  // а не вместо базы.
  const canReturn = comment.trim().length > 0 && !blocked

  const scoreMax = gradeScale === 'five' ? 5 : gradeScale === 'hundred' ? 100 : null
  const scoreNum = score === '' ? null : parseInt(score, 10)
  const scoreValid = scoreMax == null || (scoreNum != null && scoreNum >= 0 && scoreNum <= scoreMax)
  const canAccept = !blocked && (scoreMax == null || (scoreNum != null && scoreValid))

  async function run(decision: 'accepted' | 'returned_for_revision') {
    setBusy(true)
    setError(null)
    try {
      const scoreToPass = decision === 'accepted' ? scoreNum : null
      await onReview(attempt.id, decision, comment, scoreToPass)
      setComment('')
      setScore('')
      setScoreByHand(false)
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось сохранить решение')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="review-actions"
      className={cn(
        'rounded-xl border border-gray-200 bg-gray-50/60 p-3',
        // §211. В колонке — обычный поток: таблица, под ней вердикт. Свою
        // прокрутку здесь больше никто не заводит, прокручивается колонка.
        !columnLayout && 'mt-3',
      )}
    >
      {above && (
        <div data-testid="review-actions-above" className="mb-3">
          {above}
        </div>
      )}
      <div>
      {/*
        §207. Подсказка про публикацию пометок — под знаком вопроса, а не
        абзацем. Она верная и новому человеку нужна, но висела над формой при
        каждой проверке, а узнают из неё ровно один раз.
      */}
      {hint && (
        <div className="mb-1 flex justify-end">
          <HintNote label="Что делает решение по работе" testId="review-hint" lines={[hint]} />
        </div>
      )}
      {disabledReason && (
        <p
          data-testid="review-blocked-reason"
          className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
        >
          {disabledReason}
        </p>
      )}
      {/*
        §213. «Переписать по таблице». Комментарий ИИ пишет сразу после
        проверки, по своей таблице; преподаватель потом эту таблицу правит —
        и комментарий начинает ей противоречить: в нём «задания 3 и 5 не
        совпадают с эталоном», а в таблице они уже верные. Кнопка просит
        модель написать текст заново, по исправленным данным.
      */}
      {canRewriteComment && !blocked && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button
            data-testid="review-rewrite-button"
            size="sm"
            variant="secondary"
            onClick={() => { void rewriteComment() }}
            disabled={rewriting}
          >
            {rewriting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {rewriting ? 'Пишу…' : 'Переписать по таблице'}
          </Button>
          <span className="text-xs text-gray-500">по исправленной таблице заданий</span>
        </div>
      )}
      {/*
        Отказ показываем рядом с кнопкой и НЕ трогаем поле: человек в этот
        момент, возможно, уже что-то написал.
      */}
      {rewriteError && (
        <div data-testid="review-rewrite-error" className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
          {rewriteError}
        </div>
      )}
      {suggestion != null && (
        <div
          data-testid="review-rewrite-suggestion"
          className="mb-2 rounded-xl border border-violet-200 bg-violet-50/70 p-2.5"
        >
          <div className="mb-1.5 text-xs font-semibold text-violet-900">Предложение по таблице</div>
          <p data-testid="review-rewrite-suggestion-text" className="whitespace-pre-line text-sm text-gray-800">
            {suggestion}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              data-testid="review-rewrite-apply"
              size="sm"
              variant="primary"
              onClick={() => { setComment(suggestion); setSuggestion(null) }}
            >
              Вставить
            </Button>
            <Button
              data-testid="review-rewrite-cancel"
              size="sm"
              variant="secondary"
              onClick={() => setSuggestion(null)}
            >
              Отмена
            </Button>
          </div>
        </div>
      )}
      {/*
        §208. Шесть строк вместо двух и рост под содержимое: в это поле
        подставляется разбор ИИ, и владелец его ПРАВИТ, а не пишет с нуля —
        править то, из чего видно две строки, невозможно. Потолок и уголок
        изменения размера — в `useAutoGrowTextarea`.
      */}
      <textarea
        ref={commentRef}
        data-testid="review-comment-input"
        value={comment}
        onChange={e => setComment(e.target.value)}
        disabled={blocked}
        placeholder="Комментарий (обязателен при возврате на доработку)"
        aria-label="Комментарий к работе"
        rows={COMMENT_ROWS}
        className="mb-2 w-full rounded-xl border border-gray-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
      />

      {/*
        §212. Балл и подпись — в одной строке, кнопки «Взять из таблицы»
        больше нет. Кнопка решала задачу, которой не было: поле и так
        заполнено баллом из таблицы, пока его не тронули руками, а если
        тронули — человек уже решил, и звать его обратно нечем. Осталась
        справка «рекомендуемый балл N»: она отвечает на единственный вопрос,
        ради которого сюда смотрели.
      */}
      {scoreMax != null && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <input
            data-testid="review-score-input"
            type="number"
            value={score}
            onChange={e => { setScoreByHand(true); setScore(e.target.value) }}
            disabled={blocked}
            placeholder={`Балл (0–${scoreMax})`}
            aria-label={`Балл (0–${scoreMax})`}
            min="0"
            max={scoreMax}
            className="w-28 rounded-xl border border-gray-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          {tableScore != null && (
            <span data-testid="review-score-from-table" className="text-xs text-gray-500">
              рекомендуемый балл <b className="font-semibold text-gray-700">{tableScore}</b>
            </span>
          )}
        </div>
      )}

      {error && <div className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</div>}

      {/*
        §212. Решения — своей строкой под полем балла и на одном уровне.
        Пояснения переехали под них: раньше «Для возврата нужен комментарий»
        стояло в том же ряду и на узкой колонке сталкивало кнопки на разные
        строки, из-за чего «Вернуть» выглядело второстепенным действием.
      */}
      <div data-testid="review-decision-row" className="flex flex-wrap items-center gap-2">
        <Button data-testid="review-accept-button" size="sm" variant="success" onClick={() => run('accepted')} loading={busy} disabled={busy || !canAccept}>
          <Check size={14} />
          Принять
        </Button>
        <Button
          data-testid="review-return-button"
          size="sm"
          variant="secondary"
          onClick={() => run('returned_for_revision')}
          disabled={busy || !canReturn}
          title={blocked ? disabledReason ?? undefined : canReturn ? undefined : 'Напишите, что исправить'}
        >
          <RotateCcw size={14} />
          Вернуть на доработку
        </Button>
      </div>
      {((!canReturn && !blocked) || (scoreMax != null && !scoreValid && score !== '')) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {!canReturn && !blocked && (
            <span className="text-xs text-gray-400">Для возврата нужен комментарий</span>
          )}
          {scoreMax != null && !scoreValid && score !== '' && (
            <span className="text-xs text-red-600">Введите число от 0 до {scoreMax}</span>
          )}
        </div>
      )}
      </div>
    </div>
  )
}

// ─── Карточка ученика ─────────────────────────────────────────────────────────

function SubmissionCard({
  submission, studentName, attemptFiles, reviews, gradeScale, onReview,
}: {
  submission: StudentSubmission
  studentName: string
  attemptFiles: TopicHomeworkAttemptFileRow[]
  reviews: TopicHomeworkReviewRow[]
  gradeScale?: 'five' | 'hundred' | null
  onReview: (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string, score?: number | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const { latest, history } = submission
  const filesOf = (id: string) => attemptFiles.filter(f => f.attempt_id === id)
  const scoreMax = gradeScale === 'five' ? 5 : gradeScale === 'hundred' ? 100 : null
  const latestReviewData = latestReview(reviews, latest.id)

  return (
    <li className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">{studentName}</span>
        <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', ATTEMPT_STATUS_TONE[latest.status])}>
          {TEACHER_ATTEMPT_STATUS_LABEL[latest.status]}
        </span>
        <span className="text-xs text-gray-400">
          Попытка №{latest.attempt_number}
          {formatDate(latest.submitted_at) && ` · ${formatDate(latest.submitted_at)}`}
        </span>
      </div>

      <div className="mt-2">
        <AttemptFiles files={filesOf(latest.id)} />
      </div>

      {latestReviewData?.comment && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          {latestReviewData.comment}
        </p>
      )}

      {latest.status === 'accepted' && latestReviewData?.score != null && scoreMax != null && (
        <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
          Оценка: {latestReviewData.score}/{scoreMax}
        </p>
      )}

      {isReviewable(latest) && <ReviewActions attempt={latest} gradeScale={gradeScale} onReview={onReview} />}

      {history.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Предыдущие попытки ({history.length})
          </button>

          {open && (
            <ul className="mt-2 space-y-2">
              {history.map(a => {
                const review = latestReview(reviews, a.id)
                return (
                  <li key={a.id} className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-gray-700">Попытка №{a.attempt_number}</span>
                      <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', ATTEMPT_STATUS_TONE[a.status])}>
                        {TEACHER_ATTEMPT_STATUS_LABEL[a.status]}
                      </span>
                      {formatDate(a.submitted_at) && (
                        <span className="text-[11px] text-gray-400">{formatDate(a.submitted_at)}</span>
                      )}
                    </div>
                    <div className="mt-1.5">
                      <AttemptFiles files={filesOf(a.id)} />
                    </div>
                    {review?.comment && (
                      <p className="mt-1.5 rounded-lg bg-white px-2 py-1 text-[11px] text-gray-600">
                        {review.comment}
                      </p>
                    )}
                    {a.status === 'accepted' && review?.score != null && scoreMax != null && (
                      <p className="mt-1 text-[11px] text-emerald-700">
                        Оценка: {review.score}/{scoreMax}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

// ─── Список сдач по теме ──────────────────────────────────────────────────────

/**
 * Локальная проверка ДЗ внутри темы. Общей очереди здесь нет — она отдельно.
 *
 * Список приходит из RLS: преподаватель видит попытки только своего курса,
 * ученик этот компонент не получает вовсе — он смонтирован лишь в
 * преподавательской модалке темы. Клиент ничего дополнительно не проверяет.
 */
export function TopicHomeworkReview({
  attempts,
  attemptFiles,
  reviews,
  studentNames,
  gradeScale,
  loading,
  onReview,
  className,
}: {
  attempts: TopicHomeworkAttemptRow[]
  attemptFiles: TopicHomeworkAttemptFileRow[]
  reviews: TopicHomeworkReviewRow[]
  studentNames: Record<string, string>
  gradeScale?: 'five' | 'hundred' | null
  loading?: boolean
  onReview: (attemptId: string, decision: 'accepted' | 'returned_for_revision', comment?: string, score?: number | null) => Promise<void>
  className?: string
}) {
  const submissions = groupAttemptsByStudent(attempts)

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-4 text-sm text-gray-400', className)}>
        <Loader2 size={15} className="animate-spin" />
        Загрузка работ…
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <Users size={13} />
        Работы учеников
        {submissions.length > 0 && <span>· {submissions.length}</span>}
      </div>

      {submissions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
          Работ пока нет
        </p>
      ) : (
        <ul className="space-y-3">
          {submissions.map(s => (
            <SubmissionCard
              key={s.studentId}
              submission={s}
              studentName={studentNames[s.studentId] ?? 'Ученик'}
              attemptFiles={attemptFiles}
              reviews={reviews}
              gradeScale={gradeScale}
              onReview={onReview}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
