import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Loader2,
  MinusCircle,
  MoreHorizontal,
  Plus,
  Save,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  aiTasksOf,
  isPartialCheck,
  partialCheckReason,
  referenceNotice,
  shouldShowScore,
  summarizeTasks,
  TASK_VERDICT_LABEL,
  taskNoOfFinding,
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
  aiCheckIsNewerThanTable,
  groupReviewTasks,
  reviewTasksScore,
  summarizeReviewTasks,
  type ReviewTableItem,
  type ReviewTaskPatch,
  type ReviewTaskRow,
  type ReviewTaskVerdict,
} from '@/lib/homeworkReviewTasks'
import {
  VERDICT_CONFLICT_LABEL,
  answerView,
  noteTaskKey,
  notesOfTask,
  orphanNotes,
  pendingFindings,
  uncheckedIds,
  verdictConflictsWithNotes,
  type ReviewNote,
} from '@/lib/reviewNotes'
import type { ReviewTasksSaveState } from '@/hooks/useHomeworkReviewTasks'
import type { GradeScale } from '@/lib/topicHomework'
import { plural } from '@/lib/plural'
import { HintNote } from '@/components/shared/HintNote'
import { cn } from '@/utils/cn'

/**
 * Значок и цвет вердикта строки. Цвет тут несёт смысл, а не украшает: по
 * столбцу надо пробегать глазами, не читая слов.
 *
 * §209. Слово рядом со значком в строке больше не печатается: восемь
 * одинаковых «верно» подряд — колонна шума, а значок читается быстрее. Слова
 * остались там, где выбирают, — в списке вердиктов и в подсказке под знаком
 * вопроса, так что неразличающий цвет человек их по-прежнему получает.
 */
const VERDICT_STYLE: Record<AiTaskVerdict, { icon: typeof CheckCircle2; className: string; tone: string }> = {
  correct: { icon: CheckCircle2, className: 'text-emerald-700 bg-emerald-50 border-emerald-200', tone: 'text-emerald-600' },
  wrong: { icon: XCircle, className: 'text-red-700 bg-red-50 border-red-200', tone: 'text-red-600' },
  partial: { icon: MinusCircle, className: 'text-amber-700 bg-amber-50 border-amber-200', tone: 'text-amber-600' },
  unchecked: { icon: HelpCircle, className: 'text-gray-600 bg-gray-100 border-gray-200', tone: 'text-gray-400' },
}

/** §209. Одна клавиша — один вердикт. Мнемоника названа в подсказке. */
const VERDICT_KEYS: Record<string, ReviewTaskVerdict> = {
  '1': 'correct',
  '2': 'wrong',
  '3': 'partial',
  '4': 'unchecked',
}

const NO_ROWS: ReviewTaskRow[] = []
const NO_NOTES: ReviewNote[] = []
const NO_FINDINGS: AiFindingRow[] = []
const NO_IDS: readonly string[] = []

/**
 * §207. Пояснения, которые раньше стояли на экране абзацами. Тексты верные,
 * поэтому не выброшены, — но читают их один раз, а место они занимали всегда.
 *
 * §209. Абзац про правую колонку убран: колонки больше нет. Вместо него —
 * список клавиш: самое сильное ускорение для того, кто проверяет каждый день,
 * бесполезно, пока о нём не сказано.
 */
const TABLE_HINTS = [
  'Замечание — это рамка на работе. «+ Заметка» включает рисование: обведите место, выберите тип, напишите текст.',
  'Клавиши: ↑ ↓ — по строкам, 1 верно, 2 неверно, 3 частично, 4 не сверено, Enter — новое замечание, Esc — выйти.',
  'ИИ может ошибиться в чтении почерка и в самом решении. Таблицу выше вы правите, и ученик увидит именно её — вместе с вашим вердиктом.',
]

/**
 * Таблица проверки работы — бывшая «панель ИИ» (§186), с §199 это уже не
 * черновик, а результат.
 *
 * Что здесь главное: таблица по заданиям — СВОЯ, `topic_homework_review_tasks`,
 * а не `topic_homework_ai_jobs.tasks`. Слепок модели неприкосновенен (по нему
 * сравнивают версии проверки и считают выдумки), поэтому таблица преподавателя
 * рождается его копией и дальше живёт сама.
 *
 * §209. Единственная сущность на экране — задание. У него номер, ответ, статус
 * и замечания; замечание — рамка на работе, привязанная к заданию. Отдельного
 * списка «Комментарии» больше нет: он был второй жизнью тех же данных, и
 * из-за него экран читался как два документа.
 *
 * Чего здесь больше нет:
 * — списка находок ИИ (§199) и правой колонки «Комментарии» (§209);
 * — блока «Резюме ИИ» со вторым рядом счётчиков (§207);
 * — кнопки «Перенести рамки» (§209): её роль взяли «взять» у каждой находки.
 *   Молча тащить находки в разбор нельзя — именно от этого мусора владелец и
 *   просил избавиться, а выбрасывать их совсем тоже нельзя: модель часто
 *   права, и работа по их получению уже оплачена.
 *
 * Ученик этой панели не видит никогда: RLS отдаёт `topic_homework_ai_*` только
 * персоналу курса. Свои строки таблицы он видит после вердикта — отдельным
 * блоком (`ReviewTaskList`).
 */
export function ReviewTaskTable({
  job,
  findings = NO_FINDINGS,
  running,
  error,
  onRun,
  duplicateFrames = 0,
  onRemoveDuplicates,
  onUseText,
  tasks,
  gradeScale,
  saveState = 'idle',
  onAddTask,
  onSeedTasks,
  onRefillFromAi,
  onPatchTask,
  onRemoveTask,
  notes = NO_NOTES,
  activeNoteId = null,
  dismissedFindings = NO_IDS,
  takenFindingIds = NO_IDS,
  onStartNote,
  onFocusNote,
  onDeleteNote,
  onEditNote,
  onTakeFinding,
  onSkipFinding,
  onBulkVerdict,
}: {
  job: AiJobRow | null
  findings?: AiFindingRow[]
  running: boolean
  error: string | null
  onRun: () => void
  /** §207. Сколько на работе точных повторов рамок; 0 — кнопки нет. */
  duplicateFrames?: number
  /** §207. Убрать повторы. Возвращает, сколько рамок убрано. */
  onRemoveDuplicates?: () => Promise<number>
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
  /** §207. Заменить таблицу строками свежей проверки ИИ. */
  onRefillFromAi?: () => Promise<boolean> | void
  onPatchTask?: (id: string, patch: ReviewTaskPatch) => Promise<boolean> | void
  onRemoveTask?: (id: string) => Promise<boolean> | void
  /** §209. Замечания-рамки, как их видит аннотатор. */
  notes?: readonly ReviewNote[]
  /** §209. Рамка, выделенная кликом на работе, — её строка подсвечена. */
  activeNoteId?: string | null
  /** §209. Находки, по которым нажали «мимо». */
  dismissedFindings?: readonly string[]
  /** §209. Находки, уже ставшие замечаниями. */
  takenFindingIds?: readonly string[]
  /** §209. Включить рисование рамки под замечание к заданию. */
  onStartNote?: (taskNo: string) => void
  onFocusNote?: (id: string) => void
  onDeleteNote?: (id: string) => Promise<boolean> | void
  onEditNote?: (id: string, text: string) => Promise<boolean> | void
  onTakeFinding?: (finding: AiFindingRow) => Promise<boolean> | void
  onSkipFinding?: (finding: AiFindingRow) => Promise<boolean> | void
  /** §209. «Все не сверенные — верные». */
  onBulkVerdict?: (ids: string[], verdict: ReviewTaskVerdict) => Promise<boolean> | void
}) {
  const [deduping, setDeduping] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const aiTasks = aiTasksOf(job)
  const aiSummary = aiTasks ? summarizeTasks(aiTasks) : null
  const rows = tasks ?? NO_ROWS
  const editable = rows.length > 0 && onPatchTask != null
  const tableScore = useMemo(() => reviewTasksScore(rows, gradeScale ?? null), [rows, gradeScale])
  /**
   * Сводка и балл считаются по ТОМУ, что блок показывает. Своя таблица —
   * пересчёт по той же формуле, что у ИИ (§180). Слепок ИИ — его собственный
   * балл и его же правило молчания (`shouldShowScore`).
   */
  const summary = rows.length > 0 ? summarizeReviewTasks(rows) : aiSummary
  const sectionScore = rows.length > 0
    ? tableScore.score
    : (job && shouldShowScore(job) ? job.suggested_score : null)
  const partial = isPartialCheck(job)
  const partialReason = partial ? partialCheckReason(job?.summary) : null

  const done = job?.status === 'done'
  const failed = job?.status === 'failed'
  const shownError = error ?? (failed ? aiErrorMessage(job?.last_error) : null)
  const stale = aiCheckIsNewerThanTable(job, rows)

  /**
   * §209. Замечания одной строки: рамки, привязанные к её номеру, плюс старое
   * поле `note` — как замечание без места. Легаси не выбрасываем: у сотен
   * проверенных работ это единственный текст, который видел ученик.
   */
  const notesByTask = useCallback((row: ReviewTaskRow): ReviewNote[] => {
    const own = notesOfTask(notes, row.no)
    const legacy = String(row.note ?? '').trim()
    if (!legacy) return own
    return [
      ...own,
      { id: `legacy:${row.id}`, taskNo: row.no, text: legacy, page: null, type: null, categoryLabel: 'Заметка', legacy: true },
    ]
  }, [notes])

  /** §209. Предложения ИИ, ещё не принятые и не отклонённые. */
  const suggestions = useMemo(
    () => pendingFindings(findings, takenFindingIds, dismissedFindings),
    [dismissedFindings, findings, takenFindingIds],
  )

  const hints = useMemo(() => {
    const out = [...TABLE_HINTS]
    const dropped = job?.dropped_findings ?? 0
    // §180. Сколько находок код отбросил как самопротиворечивые. Это мера
    // качества модели — наше измерение, не рабочая информация преподавателя.
    if (dropped > 0) {
      out.push(
        `ИИ отбросил ${dropped} ${plural(dropped, 'находку', 'находки', 'находок')} как противоречивые.`,
      )
    }
    return out
  }, [job?.dropped_findings])

  async function removeDuplicates() {
    if (!onRemoveDuplicates) return
    setDeduping(true)
    setApplyError(null)
    try {
      await onRemoveDuplicates()
    } catch (e: any) {
      setApplyError(e?.message ?? 'Не удалось убрать повторы')
    } finally {
      setDeduping(false)
    }
  }

  return (
    <div
      // Имя проверки в тестах и сценах харнесса оставлено прежним намеренно:
      // сцены §186 и соседние карточки на него ссылаются.
      data-testid="ai-check-panel"
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-900">
          <Sparkles size={14} />
          Таблица проверки
          <HintNote label="Как читать эту таблицу" testId="ai-check-hint" lines={hints} />
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
        §207. Таблица собрана из проверки, которая старее последней. Молчать
        нельзя — преподаватель сдаст работу по позапрошлому разбору; но и
        заменить сами мы не имеем права: в таблице его правки.
      */}
      {stale && onRefillFromAi && (
        <StaleTableNotice onRefill={onRefillFromAi} />
      )}

      {(rows.length > 0 || done) && (
        <TaskSection
          rows={rows}
          aiTasks={aiTasks}
          editable={editable}
          summary={summary}
          score={sectionScore}
          notesOf={notesByTask}
          allNotes={notes}
          activeNoteId={activeNoteId}
          suggestions={suggestions}
          onAddTask={onAddTask}
          onSeedTasks={onSeedTasks}
          onPatchTask={onPatchTask}
          onRemoveTask={onRemoveTask}
          onStartNote={onStartNote}
          onFocusNote={onFocusNote}
          onDeleteNote={onDeleteNote}
          onEditNote={onEditNote}
          onTakeFinding={onTakeFinding}
          onSkipFinding={onSkipFinding}
          onBulkVerdict={onBulkVerdict}
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

          {/* §135. Проверка без авторского эталона — другой уровень доверия. */}
          {referenceNotice(job) && (
            <p
              data-testid="ai-check-no-reference"
              className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-gray-600"
            >
              {referenceNotice(job)}
            </p>
          )}

          {/* §149.1. То же для условия: без рабочего листа модель угадывала
              состав заданий по решению. */}
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
              // §189. Вместо балла — причина его отсутствия.
              <span
                data-testid="ai-check-partial"
                className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900"
              >
                Проверена не вся работа — балл не выводится
              </span>
            ) : (
              <span className="rounded-md bg-white px-2 py-0.5 text-gray-500">Балл не предлагается</span>
            )}
            {/* §207. Разбор подставляется в комментарий сам при открытии
                работы; кнопка нужна ровно тогда, когда его стёрли. */}
            {onUseText && job.summary && (
              <button
                type="button"
                data-testid="ai-check-use-text"
                onClick={() => onUseText(job.summary ?? '')}
                title="Подставить разбор ИИ в поле комментария"
                className="rounded-md border border-violet-200 bg-white px-2 py-0.5 font-medium text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-50"
              >
                Вставить в комментарий
              </button>
            )}
          </div>

          {partialReason && (
            <p
              data-testid="ai-check-partial-reason"
              className="whitespace-pre-wrap rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900"
            >
              {partialReason}
            </p>
          )}

          {/*
            §207. Кнопку показываем только при точных совпадениях. Дубли,
            накопленные прежними переносами, пометки источника не имеют,
            отличить их от ручных нечем, а ручная рамка не восстанавливается.
            §209: сам перенос ушёл, но старые дубли в базе остались — пока
            есть что чистить, есть и кнопка.
          */}
          {duplicateFrames > 0 && onRemoveDuplicates && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="ai-check-dedupe-frames"
                onClick={removeDuplicates}
                disabled={deduping}
                title="Убрать рамки-двойники: та же страница, тот же текст, то же место"
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:border-amber-400 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deduping ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Убрать повторы ({duplicateFrames})
              </button>
            </div>
          )}

          {applyError && (
            <p className="text-xs text-red-700">{applyError}</p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * §207. «Есть более свежая проверка ИИ» и замена таблицы.
 *
 * Подтверждение здесь не формальность: кнопка стирает правки преподавателя, а
 * их не восстановить.
 */
function StaleTableNotice({ onRefill }: { onRefill: () => Promise<boolean> | void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <div
      data-testid="ai-check-stale"
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white px-2.5 py-1.5 text-xs text-gray-700"
    >
      <span>Есть более свежая проверка ИИ</span>
      {asking ? (
        <>
          <span data-testid="ai-check-refill-warning" className="text-amber-800">
            Таблица будет заменена целиком, ваши правки пропадут.
          </span>
          <button
            type="button"
            data-testid="ai-check-refill-confirm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try { await onRefill() } finally { setBusy(false); setAsking(false) }
            }}
            className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 disabled:opacity-60"
          >
            {busy ? 'Заполняю…' : 'Заменить'}
          </button>
          <button
            type="button"
            data-testid="ai-check-refill-cancel"
            onClick={() => setAsking(false)}
            className="rounded-md px-2 py-0.5 text-gray-500 hover:text-gray-800"
          >
            Отмена
          </button>
        </>
      ) : (
        <button
          type="button"
          data-testid="ai-check-refill"
          onClick={() => setAsking(true)}
          className="rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 font-medium text-violet-800 hover:border-violet-300"
        >
          Заполнить заново из неё
        </button>
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
 * §207. Раскрыты ли верные задания — на время сессии вкладки.
 *
 * `sessionStorage`, а не состояние экрана: очередь размонтирует панель при
 * переходе к следующей работе. Обращение в try — приватный режим и
 * запрещённые сайту хранилища не должны ронять экран проверки.
 */
const CORRECT_OPEN_KEY = 'review-tasks-correct-open'
function readCorrectOpen(): boolean {
  try { return sessionStorage.getItem(CORRECT_OPEN_KEY) === '1' } catch { return false }
}
function writeCorrectOpen(open: boolean) {
  try { sessionStorage.setItem(CORRECT_OPEN_KEY, open ? '1' : '0') } catch { /* необязательное удобство */ }
}

/**
 * Блок «По заданиям» — единственный список экрана проверки (§209).
 *
 * Пока таблицы преподавателя нет, показывается слепок ИИ ТОЛЬКО для чтения:
 * править слепок нельзя (§180), а делать вид, что строк нет, — значит
 * заставить набирать их заново.
 */
function TaskSection({
  rows,
  aiTasks,
  editable,
  summary,
  score,
  notesOf,
  allNotes,
  activeNoteId,
  suggestions,
  onAddTask,
  onSeedTasks,
  onPatchTask,
  onRemoveTask,
  onStartNote,
  onFocusNote,
  onDeleteNote,
  onEditNote,
  onTakeFinding,
  onSkipFinding,
  onBulkVerdict,
}: {
  rows: ReviewTaskRow[]
  aiTasks: AiTaskRow[] | null
  editable: boolean
  summary: AiTasksSummary | null
  score: number | null
  notesOf: (row: ReviewTaskRow) => ReviewNote[]
  allNotes: readonly ReviewNote[]
  activeNoteId: string | null
  suggestions: AiFindingRow[]
  onAddTask?: () => Promise<boolean> | void
  onSeedTasks?: () => Promise<boolean> | void
  onPatchTask?: (id: string, patch: ReviewTaskPatch) => Promise<boolean> | void
  onRemoveTask?: (id: string) => Promise<boolean> | void
  onStartNote?: (taskNo: string) => void
  onFocusNote?: (id: string) => void
  onDeleteNote?: (id: string) => Promise<boolean> | void
  onEditNote?: (id: string, text: string) => Promise<boolean> | void
  onTakeFinding?: (finding: AiFindingRow) => Promise<boolean> | void
  onSkipFinding?: (finding: AiFindingRow) => Promise<boolean> | void
  onBulkVerdict?: (ids: string[], verdict: ReviewTaskVerdict) => Promise<boolean> | void
}) {
  const showAi = rows.length === 0 && aiTasks != null
  const [correctOpen, setCorrectOpen] = useState(readCorrectOpen)
  /**
   * Строки, которым преподаватель только что поставил вердикт. Без этого
   * строка, помеченная «верно», исчезала бы прямо из-под курсора.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  /** §209. Строка под клавиатурой. -1 — курсора нет, экран ведут мышью. */
  const [cursor, setCursor] = useState(-1)
  const listRef = useRef<HTMLDivElement | null>(null)

  const noteMap = useMemo(() => {
    const map = new Map<string, ReviewNote[]>()
    for (const row of rows) map.set(row.id, notesOf(row))
    return map
  }, [notesOf, rows])

  const suggestionsByTask = useMemo(() => {
    const map = new Map<string, AiFindingRow[]>()
    for (const finding of suggestions) {
      const key = taskNoOfFinding(finding)
      if (!key) continue
      map.set(key, [...(map.get(key) ?? []), finding])
    }
    return map
  }, [suggestions])

  const items = useMemo(() => groupReviewTasks(rows, {
    // §209. Не прячем две вещи: верное задание с замечанием (расхождение —
    // ровно то, ради чего таблицу открывают) и строку, по которой ИИ ждёт
    // решения (спрятанное предложение не предложение). Остальные замечания
    // свёртке не мешают: они видны, когда пачку раскрывают.
    keepVisible: row => verdictConflictsWithNotes(row.verdict, noteMap.get(row.id) ?? [])
      || (suggestionsByTask.get(noteTaskKey(row.no))?.length ?? 0) > 0,
    // Свёртка «не сверено» считает одинаковость по всему, что под строкой
    // написано, а не по одному легаси-полю.
    noteOf: row => (noteMap.get(row.id) ?? []).map(note => note.text.trim()).join('|'),
  }), [noteMap, rows, suggestionsByTask])

  /** Строки в том порядке, в каком они видны, — по ним и ходят стрелки. */
  const navRows = useMemo(() => rows, [rows])

  if (rows.length === 0 && !showAi && !onAddTask) return null

  const toggleCorrect = () => {
    setCorrectOpen(open => {
      writeCorrectOpen(!open)
      return !open
    })
  }

  const patch = (id: string, value: ReviewTaskPatch) => {
    if (value.verdict) setTouched(prev => new Set(prev).add(id))
    return onPatchTask?.(id, value)
  }

  /**
   * §209. Клавиатура. Обработчик на блоке, а не на окне, и с остановкой
   * всплытия: аннотатор ловит стрелки на окне, чтобы двигать выделенную рамку,
   * — два хозяина у одной клавиши дали бы прыгающую рамку при ходьбе по
   * строкам.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!editable || navRows.length === 0) return
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    if (event.metaKey || event.ctrlKey || event.altKey) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setCursor(current => {
        const next = current < 0 ? (step > 0 ? 0 : navRows.length - 1) : current + step
        return Math.max(0, Math.min(navRows.length - 1, next))
      })
      return
    }
    const verdict = VERDICT_KEYS[event.key]
    // Цифра без курсора начинает с первой строки: заставлять нажать «вниз»
    // перед первым вердиктом — лишнее нажатие в самом начале работы.
    const index = cursor < 0 ? (verdict ? 0 : -1) : cursor
    if (index < 0) return
    const row = navRows[index]
    if (!row) return

    if (verdict) {
      event.preventDefault()
      event.stopPropagation()
      void patch(row.id, { verdict })
      // §209. Курсор сам уходит на следующую строку: двадцать заданий — это
      // двадцать нажатий, а не сорок. Ради этого клавиатура и заводилась.
      setCursor(Math.min(navRows.length - 1, index + 1))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onStartNote?.(row.no)
      return
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      setCursor(-1)
      listRef.current?.blur()
    }
  }

  const line = (row: ReviewTaskRow) => (
    editable
      ? (
        <TaskLine
          key={row.id}
          row={row}
          current={navRows[cursor]?.id === row.id}
          notes={noteMap.get(row.id) ?? []}
          activeNoteId={activeNoteId}
          suggestions={suggestionsByTask.get(noteTaskKey(row.no)) ?? []}
          onPatch={value => patch(row.id, value)}
          onRemove={() => onRemoveTask?.(row.id)}
          onStartNote={onStartNote}
          onFocusNote={onFocusNote}
          onDeleteNote={onDeleteNote}
          onEditNote={onEditNote}
          onDropLegacyNote={() => patch(row.id, { note: null })}
          onTakeFinding={onTakeFinding}
          onSkipFinding={onSkipFinding}
        />
      )
      : <ReadOnlyTaskLine key={row.id} task={asAiTask(row)} testId="review-task-row" />
  )

  const unchecked = uncheckedIds(rows)
  const orphans = orphanNotes(allNotes, rows)
  /**
   * §209. Находки, которые модель не привязала ни к какому заданию (и те, чей
   * номер в таблице не нашёлся). Их всё равно надо показать: иначе решение по
   * ним принять нечем, а выбрасывать находки нельзя.
   */
  const knownTasks = new Set(rows.map(row => noteTaskKey(row.no)).filter(Boolean))
  const orphanSuggestions = suggestions.filter(finding => {
    const key = taskNoOfFinding(finding)
    return !key || !knownTasks.has(key)
  })

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

      <div
        ref={listRef}
        // §209. Блок ловит клавиши, значит он должен получать фокус — и мышью,
        // и с табуляции. Роль списка, чтобы читалка не называла его группой.
        tabIndex={editable ? 0 : -1}
        role={editable ? 'listbox' : undefined}
        aria-label={editable ? 'Задания работы' : undefined}
        data-testid="review-tasks-list"
        onKeyDown={onKeyDown}
        className="mt-1 outline-none focus-visible:ring-1 focus-visible:ring-violet-300"
      >
        <ul className="divide-y divide-gray-100">
          {showAi
            ? aiTasks!.map(task => <ReadOnlyTaskLine key={task.no} task={task} testId="ai-task-row" />)
            : items.map(item => renderItem(item, { line, correctOpen, toggleCorrect, touched }))}
        </ul>
      </div>

      {/*
        §209. Замечания, не попавшие ни в одно задание: рамки, нарисованные до
        §209, и те, что поставили без «+ Заметка». Прятать их нельзя — это
        работа преподавателя, и ученик их увидит.
      */}
      {(orphans.length > 0 || orphanSuggestions.length > 0) && (
        <div data-testid="review-tasks-orphan-notes" className="mt-2 border-t border-gray-100 pt-2">
          <div className="text-[11px] font-medium text-gray-500">Замечания без задания</div>
          <ul className="mt-1">
            {orphans.map(note => (
              <NoteLine
                key={note.id}
                note={note}
                active={note.id === activeNoteId}
                onFocus={onFocusNote}
                onDelete={onDeleteNote}
                onEdit={onEditNote}
              />
            ))}
          </ul>
          {orphanSuggestions.map(finding => (
            <FindingSuggestion
              key={finding.id}
              finding={finding}
              onTake={onTakeFinding}
              onSkip={onSkipFinding}
            />
          ))}
        </div>
      )}

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
            Задание
          </button>
        )}
        {/*
          §209. Частый случай: ИИ не дочитала работу, и пять строк подряд
          отмечаются одинаково. Ради одной строки кнопка нажатий не экономит,
          поэтому порог — две.
        */}
        {!showAi && onBulkVerdict && unchecked.length > 1 && (
          <button
            type="button"
            data-testid="review-tasks-bulk-correct"
            onClick={() => {
              setTouched(prev => {
                const next = new Set(prev)
                for (const id of unchecked) next.add(id)
                return next
              })
              void onBulkVerdict(unchecked, 'correct')
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50"
          >
            <CheckCircle2 size={12} />
            Все не сверенные — верные ({unchecked.length})
          </button>
        )}
      </div>
    </section>
  )
}

/** Одна позиция списка: обычная строка, пачка «не сверено» или пачка верных. */
function renderItem(
  item: ReviewTableItem<ReviewTaskRow>,
  ctx: {
    line: (row: ReviewTaskRow) => ReactElement
    correctOpen: boolean
    toggleCorrect: () => void
    touched: ReadonlySet<string>
  },
): ReactElement {
  if (item.kind === 'row') return ctx.line(item.row)

  if (item.kind === 'unchecked') {
    return <UncheckedPack key={item.key} label={item.label} rows={item.rows} line={ctx.line} />
  }

  // Верные. Свёрнуты по умолчанию (решение владельца): при проверке смотрят
  // на ошибки. Строки, которым вердикт поставили только что, остаются видны.
  const justTouched = item.rows.filter(row => ctx.touched.has(row.id))
  return (
    <li key={item.key} data-testid="review-tasks-correct-pack">
      <button
        type="button"
        data-testid="review-tasks-correct-toggle"
        aria-expanded={ctx.correctOpen}
        onClick={ctx.toggleCorrect}
        className="flex w-full items-center gap-1.5 px-1 py-1.5 text-left text-[11px] font-medium text-emerald-800 hover:bg-emerald-50/60"
      >
        {ctx.correctOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <CheckCircle2 size={12} className="shrink-0" />
        {item.rows.length} {plural(item.rows.length, 'верное', 'верных', 'верных')}
      </button>
      {ctx.correctOpen
        ? <ul className="divide-y divide-gray-100">{item.rows.map(ctx.line)}</ul>
        : justTouched.length > 0
          ? <ul className="divide-y divide-gray-100">{justTouched.map(ctx.line)}</ul>
          : null}
    </li>
  )
}

/**
 * §207. Подряд идущие «не сверено» с одинаковой заметкой — одной строкой.
 *
 * Пятнадцать одинаковых «нет на фото» — это одна мысль, записанная пятнадцать
 * раз. Раскрытие по клику: номера заданий всё-таки нужны при правке.
 */
function UncheckedPack({
  label,
  rows,
  line,
}: {
  label: string
  rows: ReviewTaskRow[]
  line: (row: ReviewTaskRow) => ReactElement
}) {
  const [open, setOpen] = useState(false)
  return (
    <li data-testid="review-tasks-unchecked-pack" data-count={rows.length}>
      <button
        type="button"
        data-testid="review-tasks-unchecked-toggle"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-1.5 px-1 py-1.5 text-left text-[11px] text-gray-600 hover:bg-gray-50"
      >
        {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <HelpCircle size={12} className="shrink-0 text-gray-400" />
        <span className="min-w-0 break-words">{label}</span>
      </button>
      {open && <ul className="divide-y divide-gray-100">{rows.map(line)}</ul>}
    </li>
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

/**
 * Ответы строки: «12 → 30», «−0,125», «—».
 *
 * §209. Ожидаемый печатается только когда он ДЕЙСТВИТЕЛЬНО отличается:
 * сравнение нормализует запятую и точку, пробелы и разные минусы, иначе
 * `3,5` и `3.5` показывались расхождением, и преподаватель разбирал глазами
 * различия, которых нет.
 */
function Answers({ student, expected, className }: { student: string | null; expected: string | null; className?: string }) {
  const view = answerView(student, expected)
  return (
    <span data-testid="review-task-answers" className={cn('min-w-0 break-words text-[11px] leading-5 text-gray-500', className)}>
      {view.student}
      {view.expected != null && (
        <>
          <span className="px-1 text-gray-300">→</span>
          <span className="text-gray-700">{view.expected}</span>
        </>
      )}
    </span>
  )
}

/** Строка только для чтения — слепок ИИ выглядит так же, только со словом. */
export function ReadOnlyTaskLine({ task, testId }: { task: AiTaskRow; testId: string }) {
  const style = VERDICT_STYLE[task.verdict]
  const Icon = style.icon

  return (
    <li data-testid={testId} data-no={task.no} data-verdict={task.verdict}>
      <div className="flex items-start gap-2 px-1 py-1.5">
        <span
          className={cn('mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', style.className)}
        >
          <Icon size={11} className="shrink-0" />
          {TASK_VERDICT_LABEL[task.verdict]}
        </span>
        <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-gray-500">{task.no}</span>
        <Answers student={task.student_answer} expected={task.expected_answer} className="flex-1" />
      </div>
      {task.note && (
        <p className="px-1 pb-1.5 pl-10 text-[11px] leading-5 text-gray-500">{task.note}</p>
      )}
    </li>
  )
}

/**
 * §209. Вердикт — значок без слова, список из четырёх по клику.
 *
 * Слово ушло из закрытого состояния: в столбце из двадцати строк оно
 * повторяется двадцать раз и ничего не добавляет к цвету и форме значка. В
 * списке, где ВЫБИРАЮТ, слова остались — там они и нужны.
 */
function VerdictPicker({
  verdict,
  no,
  onPick,
}: {
  verdict: ReviewTaskVerdict
  no: string
  onPick: (verdict: ReviewTaskVerdict) => void
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const style = VERDICT_STYLE[verdict]
  const Icon = style.icon

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="review-task-verdict"
        data-value={verdict}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Вердикт задания ${no}: ${TASK_VERDICT_LABEL[verdict]}`}
        title={TASK_VERDICT_LABEL[verdict]}
        onClick={() => setOpen(value => !value)}
        className={cn('flex h-6 w-6 items-center justify-center rounded-md hover:bg-gray-100', style.tone)}
      >
        <Icon size={15} />
      </button>
      {open && (
        <ul
          role="listbox"
          data-testid="review-task-verdict-menu"
          aria-label={`Вердикт задания ${no}`}
          className="absolute left-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {REVIEW_TASK_VERDICTS.map(value => {
            const option = VERDICT_STYLE[value]
            const OptionIcon = option.icon
            return (
              <li key={value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === verdict}
                  data-testid={`review-task-verdict-option-${value}`}
                  onClick={() => { setOpen(false); onPick(value) }}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px]',
                    value === verdict ? 'font-semibold' : 'font-normal',
                    'hover:bg-gray-50',
                  )}
                >
                  <OptionIcon size={11} className={cn('shrink-0', option.tone)} />
                  {TASK_VERDICT_LABEL[value]}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * §209. Строка задания.
 *
 * В покое — текст без рамок: до §209 у каждого поля был свой прямоугольник,
 * четыре в строке и тридцать два на восемь заданий, и рябь от них владелец
 * называл «перегружено». Номер, ответ и ожидаемый теперь справка, а не форма:
 * править их незачем — они пришли из слепка модели, а результат проверки
 * складывается из статуса и замечаний.
 */
function TaskLine({
  row,
  current,
  notes,
  activeNoteId,
  suggestions,
  onPatch,
  onRemove,
  onStartNote,
  onFocusNote,
  onDeleteNote,
  onEditNote,
  onDropLegacyNote,
  onTakeFinding,
  onSkipFinding,
}: {
  row: ReviewTaskRow
  current: boolean
  notes: ReviewNote[]
  activeNoteId: string | null
  suggestions: AiFindingRow[]
  onPatch: (patch: ReviewTaskPatch) => Promise<boolean> | void
  onRemove: () => Promise<boolean> | void
  onStartNote?: (taskNo: string) => void
  onFocusNote?: (id: string) => void
  onDeleteNote?: (id: string) => Promise<boolean> | void
  onEditNote?: (id: string, text: string) => Promise<boolean> | void
  onDropLegacyNote: () => void
  onTakeFinding?: (finding: AiFindingRow) => Promise<boolean> | void
  onSkipFinding?: (finding: AiFindingRow) => Promise<boolean> | void
}) {
  const conflict = verdictConflictsWithNotes(row.verdict, notes)
  const highlighted = notes.some(note => note.id === activeNoteId)

  return (
    <li
      data-testid="review-task-row"
      data-no={row.no}
      data-verdict={row.verdict}
      data-current={current ? 'true' : undefined}
      data-conflict={conflict ? 'true' : undefined}
      className={cn(
        'rounded-md px-0.5',
        current && 'bg-violet-50 ring-1 ring-violet-200',
        highlighted && !current && 'bg-sky-50',
        conflict && 'border-l-2 border-amber-400',
      )}
    >
      <div className="flex items-start gap-2 px-1 py-1.5">
        <VerdictPicker
          verdict={row.verdict}
          no={row.no}
          onPick={verdict => { void onPatch({ verdict }) }}
        />
        <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-gray-600">{row.no}</span>
        <Answers student={row.student_answer} expected={row.expected_answer} className="flex-1" />
        <RowMenu no={row.no} onRemove={onRemove} />
      </div>

      {conflict && (
        <p data-testid="review-task-conflict" className="px-1 pb-1 pl-10 text-[11px] font-medium text-amber-700">
          {VERDICT_CONFLICT_LABEL}
        </p>
      )}

      {notes.length > 0 && (
        <ul className="pb-0.5 pl-9">
          {notes.map(note => (
            <NoteLine
              key={note.id}
              note={note}
              active={note.id === activeNoteId}
              onFocus={onFocusNote}
              onDelete={note.legacy ? undefined : onDeleteNote}
              onEdit={note.legacy ? undefined : onEditNote}
              onDropLegacy={note.legacy ? onDropLegacyNote : undefined}
            />
          ))}
        </ul>
      )}

      {suggestions.map(finding => (
        <FindingSuggestion
          key={finding.id}
          finding={finding}
          onTake={onTakeFinding}
          onSkip={onSkipFinding}
        />
      ))}

      {onStartNote && (
        <button
          type="button"
          data-testid="review-task-add-note"
          onClick={() => onStartNote(row.no)}
          className="ml-9 mb-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-violet-700 hover:bg-violet-50"
        >
          <Plus size={11} />
          Заметка
        </button>
      )}
    </li>
  )
}

/**
 * §209. Замечание под строкой задания: текст, страница, корзина.
 *
 * Корзина удаляет ЗАМЕЧАНИЕ, а не задание, — до §209 единственная корзина в
 * строке убирала строку целиком, и перепутать их было бы дорого. Кнопка
 * «убрать задание» уехала в неприметное меню строки.
 */
function NoteLine({
  note,
  active,
  onFocus,
  onDelete,
  onEdit,
  onDropLegacy,
}: {
  note: ReviewNote
  active: boolean
  onFocus?: (id: string) => void
  onDelete?: (id: string) => Promise<boolean> | void
  onEdit?: (id: string, text: string) => Promise<boolean> | void
  /** Легаси-заметка: «удалить» — это очистить поле строки, а не убрать рамку. */
  onDropLegacy?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)

  useEffect(() => { if (!editing) setDraft(note.text) }, [editing, note.text])

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== note.text) void onEdit?.(note.id, next)
  }

  return (
    <li
      data-testid="review-task-note"
      data-note-id={note.id}
      data-legacy={note.legacy ? 'true' : undefined}
      className={cn('flex items-start gap-1.5 rounded-md px-1 py-0.5', active && 'bg-sky-100')}
    >
      <span
        aria-hidden
        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: note.type === 'good' ? '#16a34a' : note.type === 'inaccuracy' ? '#d97706' : note.type === 'error' ? '#dc2626' : '#94a3b8' }}
      />
      {editing ? (
        <textarea
          data-testid="review-task-note-input"
          aria-label="Текст замечания"
          autoFocus
          rows={2}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={commit}
          // §209. Esc выходит из правки, не потеряв набранное: текст остаётся
          // в поле, и вернуться в него — один клик.
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false) }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); commit() }
          }}
          className="min-w-0 flex-1 rounded-md border border-violet-200 px-1.5 py-1 text-[11px] leading-5 text-gray-800 focus:border-violet-300 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          data-testid="review-task-note-text"
          title={note.page != null ? 'Показать место в работе' : 'Заметка без места в работе'}
          onClick={() => { if (note.page != null) onFocus?.(note.id) }}
          onDoubleClick={() => { if (onEdit) setEditing(true) }}
          className="min-w-0 flex-1 break-words text-left text-[11px] leading-5 text-gray-700 hover:text-gray-900"
        >
          {note.text || note.categoryLabel}
        </button>
      )}
      {note.page != null && (
        <span data-testid="review-task-note-page" className="shrink-0 text-[10px] tabular-nums text-gray-400">
          стр. {note.page}
        </span>
      )}
      {onEdit && !editing && (
        <button
          type="button"
          data-testid="review-task-note-edit"
          aria-label="Изменить замечание"
          title="Изменить текст"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded p-0.5 text-[10px] text-gray-400 hover:text-gray-700"
        >
          ✎
        </button>
      )}
      {(onDelete || onDropLegacy) && (
        <button
          type="button"
          data-testid="review-task-note-remove"
          aria-label="Удалить замечание"
          title="Удалить замечание"
          onClick={() => { if (onDropLegacy) onDropLegacy(); else void onDelete?.(note.id) }}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={11} />
        </button>
      )}
    </li>
  )
}

/**
 * §209. Находка ИИ — предложение, а не замечание.
 *
 * «Взять» делает её замечанием преподавателя вместе с рамкой, «мимо» убирает
 * предложение навсегда. Третьего состояния («лежит рамкой, но никто её не
 * принимал») больше нет: именно оно и порождало мусор, на который жаловался
 * владелец.
 */
function FindingSuggestion({
  finding,
  onTake,
  onSkip,
}: {
  finding: AiFindingRow
  onTake?: (finding: AiFindingRow) => Promise<boolean> | void
  onSkip?: (finding: AiFindingRow) => Promise<boolean> | void
}) {
  const [busy, setBusy] = useState(false)
  if (!onTake && !onSkip) return null
  return (
    <div
      data-testid="ai-finding-suggestion"
      data-finding-id={finding.id}
      className="ml-9 mb-1 flex flex-wrap items-start gap-x-2 gap-y-1 rounded-md bg-gray-50 px-1.5 py-1 text-[11px] text-gray-500"
    >
      <span className="min-w-0 flex-1 break-words">ИИ: {finding.text}</span>
      {onTake && (
        <button
          type="button"
          data-testid="ai-finding-take"
          disabled={busy}
          onClick={async () => { setBusy(true); try { await onTake(finding) } finally { setBusy(false) } }}
          className="shrink-0 rounded border border-violet-200 bg-white px-1.5 py-0.5 font-medium text-violet-700 hover:border-violet-300 disabled:opacity-60"
        >
          взять
        </button>
      )}
      {onSkip && (
        <button
          type="button"
          data-testid="ai-finding-skip"
          disabled={busy}
          onClick={async () => { setBusy(true); try { await onSkip(finding) } finally { setBusy(false) } }}
          className="shrink-0 rounded px-1.5 py-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-60"
        >
          мимо
        </button>
      )}
    </div>
  )
}

/**
 * §209. Неприметное меню строки: «Убрать задание».
 *
 * Действие редкое, а место у него было такое же заметное, как у вердикта, —
 * и корзина строки стояла там же, где теперь корзина замечания. Разводим их
 * намеренно: цена путаницы несимметрична.
 */
function RowMenu({ no, onRemove }: { no: string; onRemove: () => Promise<boolean> | void }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        data-testid="review-task-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Действия с заданием ${no}`}
        onClick={() => setOpen(value => !value)}
        className="rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="review-task-remove"
            onClick={() => { setOpen(false); void onRemove() }}
            className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] text-gray-700 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 size={11} />
            Убрать задание
          </button>
        </div>
      )}
    </div>
  )
}
