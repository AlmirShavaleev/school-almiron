import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  MinusCircle,
  Plus,
  Save,
  Sparkles,
  SquareDashed,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  CONFIDENCE_LABEL,
  aiTasksOf,
  isPartialCheck,
  partialCheckReason,
  referenceNotice,
  shouldShowScore,
  summarizeTasks,
  TASK_VERDICT_LABEL,
  worksheetNotice,
  aiErrorMessage,
  type AiFindingRow,
  type AiJobRow,
  type AiTaskRow,
  type AiTasksSummary,
  type AiTaskVerdict,
} from '@/lib/aiHomeworkCheck'
import {
  REVIEW_TASK_VERDICTS,
  reviewTasksScore,
  summarizeReviewTasks,
  type ReviewTaskPatch,
  type ReviewTaskRow,
  type ReviewTaskVerdict,
} from '@/lib/homeworkReviewTasks'
import type { ReviewTasksSaveState } from '@/hooks/useHomeworkReviewTasks'
import type { GradeScale } from '@/lib/topicHomework'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * Значок и цвет вердикта строки. Цвет тут несёт смысл, а не украшает: по
 * столбцу надо пробегать глазами, не читая слов, — поэтому зелёный/красный/
 * жёлтый/серый, а слово рядом для тех, кто цвет не различает.
 */
const VERDICT_STYLE: Record<AiTaskVerdict, { icon: typeof CheckCircle2; className: string }> = {
  correct: { icon: CheckCircle2, className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  wrong: { icon: XCircle, className: 'text-red-700 bg-red-50 border-red-200' },
  partial: { icon: MinusCircle, className: 'text-amber-700 bg-amber-50 border-amber-200' },
  unchecked: { icon: HelpCircle, className: 'text-gray-600 bg-gray-100 border-gray-200' },
}

/**
 * Одна разметка на оба размера: пять столбцов на широком, карточка на узком.
 * Отдельной «мобильной» копии нет намеренно (§186) — две копии разъезжаются, а
 * горизонтальный скролл в панели шириной с телефон недопустим.
 */
const COLS = 'sm:grid-cols-[2.5rem_7.5rem_minmax(0,1fr)_minmax(0,1.2fr)_1.75rem]'
const NO_ROWS: ReviewTaskRow[] = []
const ROW = 'grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 px-1 py-1.5 sm:gap-2'

/**
 * Таблица проверки работы — бывшая «панель ИИ» (§186), с §199 это уже не
 * черновик, а результат.
 *
 * Что здесь главное: таблица по заданиям — СВОЯ, `topic_homework_review_tasks`,
 * а не `topic_homework_ai_jobs.tasks`. Слепок модели неприкосновенен (по нему
 * сравнивают версии проверки и считают выдумки), поэтому таблица преподавателя
 * рождается его копией и дальше живёт сама. Пока копии нет — панель показывает
 * слепок только для чтения и предлагает «Взять таблицу ИИ»: у трёх десятков
 * проверок старее v17 таблицы нет вовсе, и им экран обязан выглядеть как
 * раньше.
 *
 * Чего здесь больше нет (§199, разгрузка экрана): списка находок ИИ. Он
 * дословно дублировал правую колонку «Комментарии», куда рамки ИИ переносятся
 * автоматически при открытии работы, — те же тексты, но привязанные к местам в
 * работе. Спрашивал об этом ещё агент §186 в своём отчёте.
 *
 * Ученик этой панели не видит никогда: RLS отдаёт `topic_homework_ai_*` только
 * персоналу курса. Свои строки таблицы проверки он видит после вердикта —
 * отдельным блоком (`ReviewTaskList`), а не этим экраном.
 */
export function ReviewTaskTable({
  job,
  findings,
  running,
  error,
  onRun,
  onApplyFrames,
  onUseText,
  tasks,
  gradeScale,
  saveState = 'idle',
  onAddTask,
  onSeedTasks,
  onPatchTask,
  onRemoveTask,
}: {
  job: AiJobRow | null
  findings: AiFindingRow[]
  running: boolean
  error: string | null
  onRun: () => void
  /** Переносит рамки ИИ в разбор. Возвращает, сколько реально легло. */
  onApplyFrames: () => Promise<number>
  /** Подставляет текст разбора в поле комментария вердикта. */
  onUseText?: (text: string) => void
  /** Строки таблицы преподавателя. Пусто — показываем слепок ИИ для чтения. */
  tasks?: ReviewTaskRow[]
  /** Шкала курса — из неё считается балл по таблице. */
  gradeScale?: GradeScale | null
  saveState?: ReviewTasksSaveState
  onAddTask?: () => Promise<boolean> | void
  /** Забрать таблицу ИИ себе, когда сама она почему-то не забралась. */
  onSeedTasks?: () => Promise<boolean> | void
  onPatchTask?: (id: string, patch: ReviewTaskPatch) => Promise<boolean> | void
  onRemoveTask?: (id: string) => Promise<boolean> | void
}) {
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<number | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  /**
   * Резюме ИИ свёрнуто по умолчанию (§199): при проверке нужны задания, а
   * абзац разбора читают один раз. Счётчики стоят в заголовке — по ним видно,
   * стоит ли раскрывать.
   */
  const [summaryOpen, setSummaryOpen] = useState(false)

  const aiTasks = aiTasksOf(job)
  const aiSummary = aiTasks ? summarizeTasks(aiTasks) : null
  const rows = tasks ?? NO_ROWS
  const editable = rows.length > 0 && onPatchTask != null
  const tableScore = useMemo(() => reviewTasksScore(rows, gradeScale ?? null), [rows, gradeScale])
  /**
   * Сводка и балл считаются по ТОМУ, что блок показывает. Своя таблица —
   * пересчёт по той же формуле, что у ИИ (§180). Слепок ИИ — его собственный
   * балл и его же правило молчания (`shouldShowScore`): показать здесь число,
   * которое панель выше сознательно не назвала, значило бы обойти правило
   * тихой дверью (§186).
   */
  const summary = rows.length > 0 ? summarizeReviewTasks(rows) : aiSummary
  const sectionScore = rows.length > 0
    ? tableScore.score
    : (job && shouldShowScore(job) ? job.suggested_score : null)
  /**
   * §189. Балла нет, а разбор есть: функция погасила его, потому что работа
   * прочитана не целиком. Молчание тут читается как «ИИ не справился», и
   * преподаватель не узнает, что часть страниц до модели не доехала.
   */
  const partial = isPartialCheck(job)
  const partialReason = partial ? partialCheckReason(job?.summary) : null

  const done = job?.status === 'done'
  const failed = job?.status === 'failed'
  const shownError = error ?? (failed ? aiErrorMessage(job?.last_error) : null)

  async function applyFrames() {
    setApplying(true)
    setApplyError(null)
    try {
      const count = await onApplyFrames()
      setApplied(count)
      if (count === 0) setApplyError('Ни одну рамку перенести не удалось')
    } catch (e: any) {
      setApplyError(e?.message ?? 'Не удалось перенести рамки')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      // Имя проверки в тестах и сценах харнесса оставлено прежним намеренно:
      // сцены §186 и соседние карточки на него ссылаются, а переименование
      // testid ничего не объясняет — объясняет имя компонента.
      data-testid="ai-check-panel"
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-900">
          <Sparkles size={14} />
          Таблица проверки
        </span>
        <div className="flex items-center gap-2">
          <SaveMark state={saveState} />
          <button
            type="button"
            data-testid="ai-check-run"
            onClick={onRun}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {running ? 'Проверяю…' : done || failed ? 'Проверить заново' : 'Проверить с ИИ'}
          </button>
        </div>
      </div>

      {running && (
        <p className="mt-2 text-xs text-violet-700">
          Читаю работу и решаю задачу сам — это занимает до минуты.
        </p>
      )}

      {shownError && (
        <p data-testid="ai-check-error" className="mt-2 flex items-start gap-1.5 text-xs text-red-700">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {shownError}
        </p>
      )}

      {/*
        Таблица преподавателя живёт своей жизнью и без ИИ: строку можно
        добавить руками, и тогда блок есть даже там, где проверки не было.
      */}
      {(rows.length > 0 || done) && (
        <TaskSection
          rows={rows}
          aiTasks={aiTasks}
          editable={editable}
          summary={summary}
          score={sectionScore}
          onAddTask={onAddTask}
          onSeedTasks={onSeedTasks}
          onPatchTask={onPatchTask}
          onRemoveTask={onRemoveTask}
        />
      )}

      {!running && !job && !shownError && rows.length === 0 && (
        <p className="mt-2 text-xs text-violet-800">
          ИИ прочитает работу, решит задачу сам и составит таблицу по заданиям — её вы
          дальше правите, и она станет результатом проверки. Решение остаётся за вами.
        </p>
      )}

      {done && job && (
        <div className="mt-3 space-y-2.5">
          {job.readable === false && (
            <p className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs text-amber-900">
              ИИ не смог разобрать работу — балл не предлагается. Причина ниже.
            </p>
          )}

          {/*
            §135. Проверка без авторского эталона — другой уровень доверия:
            модель сверяла работу со СВОИМ решением. Преподаватель должен
            понимать, чему верит, поэтому плашка спокойная, но обязательная.
          */}
          {referenceNotice(job) && (
            <p
              data-testid="ai-check-no-reference"
              className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600"
            >
              {referenceNotice(job)}
            </p>
          )}

          {/* §149.1. То же для условия: без рабочего листа модель угадывала
              состав заданий по решению — преподаватель должен это видеть. */}
          {worksheetNotice(job) && (
            <p
              data-testid="ai-check-no-worksheet"
              className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600"
            >
              {worksheetNotice(job)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {shouldShowScore(job) ? (
              <span
                data-testid="ai-check-score"
                className="rounded-md border border-violet-300 bg-white px-2 py-0.5 font-semibold text-violet-900"
              >
                Предлагает балл: {job.suggested_score}
              </span>
            ) : partial ? (
              // §189. Вместо балла — причина его отсутствия. Балл по двум
              // третям работы преподаватель принимает не глядя; эта плашка
              // заставляет его открыть страницы и досмотреть самому.
              <span
                data-testid="ai-check-partial"
                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900"
              >
                Проверена не вся работа — балл не выводится
              </span>
            ) : (
              <span className="rounded-md bg-white px-2 py-0.5 text-gray-500">Балл не предлагается</span>
            )}
            {job.confidence && (
              <span className="text-violet-700">{CONFIDENCE_LABEL[job.confidence]}</span>
            )}
            {job.model && (
              // Подпись модели нужна, пока мы сравниваем провайдеров: без неё
              // непонятно, чей это разбор — Qwen или Gemini.
              <span data-testid="ai-check-model" className="text-violet-500">· {job.model}</span>
            )}
          </div>

          {/* Пояснение к плашке — дословно из разбора: список непрочитанных
              страниц и несверенных заданий пишет сама функция. */}
          {partialReason && (
            <p
              data-testid="ai-check-partial-reason"
              className="whitespace-pre-wrap rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900"
            >
              {partialReason}
            </p>
          )}

          {/*
            §199. Резюме ИИ — под раскрытием, свёрнутое по умолчанию. Абзац
            разбора читают один раз, а места он занимал больше, чем таблица,
            ради которой панель и открывают. Счётчики в заголовке — чтобы
            решение «раскрывать или нет» принималось не наугад.
          */}
          {job.summary && (
            <div className="rounded-lg border border-violet-200 bg-white">
              <button
                type="button"
                data-testid="ai-check-summary-toggle"
                onClick={() => setSummaryOpen(open => !open)}
                aria-expanded={summaryOpen}
                className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-left"
              >
                {summaryOpen ? <ChevronDown size={13} className="shrink-0 text-violet-700" /> : <ChevronRight size={13} className="shrink-0 text-violet-700" />}
                <span className="text-xs font-semibold text-violet-900">Резюме ИИ</span>
                {aiSummary && (
                  <span data-testid="ai-check-summary-counts" className="text-[11px] text-gray-500">
                    верно {aiSummary.correct} · неверно {aiSummary.wrong} · частично {aiSummary.partial}
                    {' '}· не сверено {aiSummary.unchecked}
                  </span>
                )}
                {findings.length > 0 && (
                  <span className="text-[11px] text-violet-700">· нашёл мест: {findings.length}</span>
                )}
              </button>
              {summaryOpen && (
                <div className="border-t border-violet-100 px-2.5 py-2">
                  <p
                    data-testid="ai-check-summary"
                    className="whitespace-pre-wrap text-xs leading-5 text-gray-700"
                  >
                    {job.summary}
                  </p>
                  {onUseText && (
                    <button
                      type="button"
                      data-testid="ai-check-use-text"
                      onClick={() => onUseText(job.summary ?? '')}
                      className="mt-2 text-xs font-medium text-violet-700 underline-offset-2 hover:underline"
                    >
                      Вставить в комментарий
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {findings.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="ai-check-apply-frames"
                onClick={applyFrames}
                disabled={applying || applied != null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <SquareDashed size={12} />}
                {applied != null ? `Перенесено рамок: ${applied}` : `Перенести рамки (${findings.length})`}
              </button>
              <span className="text-[11px] text-violet-700">
                Тексты находок — в «Комментариях» справа, привязанные к местам в работе.
              </span>
            </div>
          )}

          {applyError && (
            <p className="text-xs text-red-700">{applyError}</p>
          )}

          <p className="text-[11px] leading-4 text-violet-700">
            ИИ может ошибиться в чтении почерка и в самом решении. Таблицу выше вы правите,
            и ученик увидит именно её — вместе с вашим вердиктом.
          </p>

          {/*
            §180. Сколько находок код отбросил как самопротиворечивые
            («должно быть 0,78, а не 0,78») и негодные. Для преподавателя это
            мера качества модели: число растёт — разбору верить меньше.
          */}
          {(job.dropped_findings ?? 0) > 0 && (
            <p data-testid="ai-check-dropped" className="text-[11px] leading-4 text-gray-500">
              ИИ отбросил {job.dropped_findings}
              {' '}{plural(job.dropped_findings ?? 0, 'находку', 'находки', 'находок')}
              {' '}как противоречивые
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** «Сохранено» рядом с заголовком — по образцу `SubmissionReviewer`. */
function SaveMark({ state }: { state: ReviewTasksSaveState }) {
  if (state === 'idle') return null
  if (state === 'saving') {
    return (
      <span data-testid="review-tasks-save-state" className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700">
        <Loader2 size={11} className="animate-spin" />
        Сохраняю
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span data-testid="review-tasks-save-state" className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700">
        <AlertTriangle size={11} />
        Не сохранено
      </span>
    )
  }
  return (
    <span data-testid="review-tasks-save-state" className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
      <Save size={11} />
      Сохранено
    </span>
  )
}


/**
 * Блок «По заданиям».
 *
 * Два состояния, и различие между ними — не украшение: пока таблицы
 * преподавателя нет, экран показывает слепок ИИ ТОЛЬКО для чтения. Дать
 * править слепок нельзя (§180), а делать вид, что строк нет, — значит
 * заставить набирать их заново. В приложении копию заводит база сама при
 * открытии работы; кнопка «Взять таблицу ИИ» — на случай, когда не завела.
 */
function TaskSection({
  rows,
  aiTasks,
  editable,
  summary,
  score,
  onAddTask,
  onSeedTasks,
  onPatchTask,
  onRemoveTask,
}: {
  rows: ReviewTaskRow[]
  aiTasks: AiTaskRow[] | null
  editable: boolean
  summary: AiTasksSummary | null
  score: number | null
  onAddTask?: () => Promise<boolean> | void
  onSeedTasks?: () => Promise<boolean> | void
  onPatchTask?: (id: string, patch: ReviewTaskPatch) => Promise<boolean> | void
  onRemoveTask?: (id: string) => Promise<boolean> | void
}) {
  const showAi = rows.length === 0 && aiTasks != null
  if (rows.length === 0 && !showAi && !onAddTask) return null

  return (
    <section data-testid="ai-check-tasks" className="mt-3 rounded-lg border border-violet-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-violet-900">По заданиям</span>
        {summary && (
          <span data-testid="ai-check-tasks-summary" className="text-[11px] text-gray-600">
            верно {summary.correct} · неверно {summary.wrong} · частично {summary.partial}
            {' '}· не сверено {summary.unchecked}
          </span>
        )}
        {summary && score != null && (
          <span
            data-testid="ai-check-tasks-score"
            className="rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-900"
          >
            → балл {score}
          </span>
        )}
      </div>

      {/* Шапка столбцов — только там, где строка в столбцы укладывается. */}
      <div className={cn('mt-2 hidden px-1 text-[10px] uppercase tracking-wide text-gray-400 sm:grid sm:gap-2', COLS)}>
        <span>№</span>
        <span>Вердикт</span>
        <span>Ответ → ожидаемый</span>
        <span>Заметка</span>
        <span />
      </div>

      <ul className="mt-1 divide-y divide-gray-100">
        {showAi
          ? aiTasks!.map(task => <ReadOnlyTaskLine key={task.no} task={task} testId="ai-task-row" />)
          : rows.map(row => (
              editable
                ? (
                  <EditableTaskLine
                    key={row.id}
                    row={row}
                    onPatch={patch => onPatchTask?.(row.id, patch)}
                    onRemove={() => onRemoveTask?.(row.id)}
                  />
                )
                : (
                  <ReadOnlyTaskLine
                    key={row.id}
                    task={asAiTask(row)}
                    testId="review-task-row"
                  />
                )
            ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {showAi && onSeedTasks && (
          <button
            type="button"
            data-testid="review-tasks-seed"
            onClick={() => void onSeedTasks()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-50"
          >
            <Sparkles size={12} />
            Взять таблицу ИИ
          </button>
        )}
        {onAddTask && !showAi && (
          <button
            type="button"
            data-testid="review-tasks-add"
            onClick={() => void onAddTask()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-800 transition-colors hover:border-violet-300 hover:bg-violet-50"
          >
            <Plus size={12} />
            Добавить строку
          </button>
        )}
      </div>
    </section>
  )
}

/** Строка таблицы проверки в виде строки слепка — для чтения. */
function asAiTask(row: ReviewTaskRow): AiTaskRow {
  return {
    no: row.no,
    verdict: row.verdict,
    student_answer: row.student_answer ?? '',
    expected_answer: row.expected_answer ?? '',
    note: row.note ?? '',
  }
}

/** Строка только для чтения — слепок ИИ и ученический вид выглядят одинаково. */
export function ReadOnlyTaskLine({ task, testId }: { task: AiTaskRow; testId: string }) {
  const style = VERDICT_STYLE[task.verdict]
  const Icon = style.icon
  const answers = task.student_answer || task.expected_answer

  return (
    <li data-testid={testId} data-no={task.no} data-verdict={task.verdict}>
      <div className={cn(ROW, COLS)}>
        <span className="text-xs font-semibold tabular-nums text-gray-500">{task.no}</span>
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
            style.className,
          )}
        >
          <Icon size={11} className="shrink-0" />
          {TASK_VERDICT_LABEL[task.verdict]}
        </span>
        {answers ? (
          <span className="col-start-2 min-w-0 break-words text-[11px] leading-5 text-gray-700 sm:col-start-3">
            {task.student_answer || '—'}
            <span className="px-1 text-gray-400">→</span>
            {task.expected_answer || '—'}
          </span>
        ) : <span className="hidden sm:block" />}
        {task.note ? (
          <ClampedNote note={task.note} className="col-start-2 sm:col-start-4" />
        ) : <span className="hidden sm:block" />}
        <span className="hidden sm:block" />
      </div>
    </li>
  )
}

/**
 * Заметка в одну строку, полная — по клику (§199).
 *
 * Свёрнута именно строкой, а не высотой: заметка модели бывает в три
 * предложения, и на шести заданиях таблица перестаёт читаться как таблица.
 */
function ClampedNote({ note, className }: { note: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      data-testid="review-task-note-text"
      data-open={open ? 'true' : undefined}
      onClick={() => setOpen(value => !value)}
      title={open ? undefined : note}
      className={cn(
        'min-w-0 break-words text-left text-[11px] leading-5 text-gray-500 hover:text-gray-700',
        open ? 'whitespace-pre-wrap' : 'truncate',
        className,
      )}
    >
      {note}
    </button>
  )
}

const FIELD = 'w-full min-w-0 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[11px] leading-5 text-gray-800 focus:border-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-200'

/**
 * Строка таблицы преподавателя.
 *
 * Вердикт — выпадающий список (владелец просил «как выпадающее окно») и
 * уходит в базу сразу: это одно движение, ждать от него нечего. Текстовые
 * поля пишутся по уходу из поля и по Enter, а не на каждую букву: «сразу по
 * изменению» — про изменение, а не про нажатие клавиши, и запись на каждый
 * символ дала бы десятки запросов на одну заметку.
 */
function EditableTaskLine({
  row,
  onPatch,
  onRemove,
}: {
  row: ReviewTaskRow
  onPatch: (patch: ReviewTaskPatch) => Promise<boolean> | void
  onRemove: () => Promise<boolean> | void
}) {
  const style = VERDICT_STYLE[row.verdict]
  const Icon = style.icon

  return (
    <li data-testid="review-task-row" data-no={row.no} data-verdict={row.verdict}>
      <div className={cn(ROW, COLS)}>
        <TextField
          value={row.no}
          ariaLabel={`Номер задания ${row.no}`}
          testId="review-task-no"
          className="tabular-nums"
          onCommit={value => { if (value.trim()) onPatch({ no: value.trim() }) }}
        />

        <div className="col-start-2 flex min-w-0 items-center gap-1 sm:col-start-2">
          <span className={cn('hidden shrink-0 rounded-md border p-0.5 sm:inline-flex', style.className)}>
            <Icon size={11} />
          </span>
          <select
            data-testid="review-task-verdict"
            aria-label={`Вердикт задания ${row.no}`}
            value={row.verdict}
            onChange={event => { void onPatch({ verdict: event.target.value as ReviewTaskVerdict }) }}
            className={cn(FIELD, 'appearance-none')}
          >
            {REVIEW_TASK_VERDICTS.map(verdict => (
              <option key={verdict} value={verdict}>{TASK_VERDICT_LABEL[verdict]}</option>
            ))}
          </select>
        </div>

        <div className="col-start-2 flex min-w-0 items-center gap-1 sm:col-start-3">
          <TextField
            value={row.student_answer ?? ''}
            ariaLabel={`Ответ ученика, задание ${row.no}`}
            testId="review-task-student-answer"
            placeholder="ответ ученика"
            onCommit={value => { void onPatch({ student_answer: value.trim() || null }) }}
          />
          <span className="shrink-0 text-gray-400">→</span>
          <TextField
            value={row.expected_answer ?? ''}
            ariaLabel={`Ожидаемый ответ, задание ${row.no}`}
            testId="review-task-expected-answer"
            placeholder="ожидаемый"
            onCommit={value => { void onPatch({ expected_answer: value.trim() || null }) }}
          />
        </div>

        <div className="col-start-2 min-w-0 sm:col-start-4">
          <TextField
            value={row.note ?? ''}
            ariaLabel={`Заметка по заданию ${row.no}`}
            testId="review-task-note"
            placeholder="заметка — её увидит ученик"
            grow
            onCommit={value => { void onPatch({ note: value.trim() || null }) }}
          />
        </div>

        <button
          type="button"
          data-testid="review-task-remove"
          aria-label={`Удалить строку задания ${row.no}`}
          title="Удалить строку"
          onClick={() => { void onRemove() }}
          // На узком экране строка — карточка, и кнопка удаления прижата к её
          // правому краю: слева под заметкой она читалась бы как часть
          // следующей строки.
          className="col-start-2 justify-self-end rounded-md p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 sm:col-start-5 sm:justify-self-center"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  )
}

/**
 * Поле строки таблицы: пока пишут — местное состояние, в базу — по уходу из
 * поля и по Enter. Внешнее значение перебивает местное только вне фокуса,
 * иначе оптимистичная правка соседнего поля стирала бы набранное.
 *
 * `grow` — заметка: одна строка, а в фокусе три. Это `textarea` в обоих
 * состояниях, а не подмена `input` на `textarea`: подмена размонтировала бы
 * поле ровно в момент попадания в него фокуса, и первая буква уходила бы в
 * никуда.
 */
function TextField({
  value,
  ariaLabel,
  testId,
  placeholder,
  className,
  grow,
  onCommit,
}: {
  value: string
  ariaLabel: string
  testId: string
  placeholder?: string
  className?: string
  grow?: boolean
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])

  const shared = {
    'data-testid': testId,
    'aria-label': ariaLabel,
    value: draft,
    placeholder,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false)
      if (draft !== value) onCommit(draft)
    },
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    className: cn(FIELD, className),
  }

  if (grow) {
    return (
      <textarea
        {...shared}
        data-open={focused ? 'true' : undefined}
        rows={focused ? 3 : 1}
        className={cn(shared.className, !focused && 'resize-none overflow-hidden')}
      />
    )
  }

  return (
    <input
      {...shared}
      type="text"
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          ;(event.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
