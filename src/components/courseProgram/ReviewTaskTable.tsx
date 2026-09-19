import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
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
  aiCheckIsNewerThanTable,
  groupReviewTasks,
  reviewTasksScore,
  summarizeReviewTasks,
  type ReviewTableItem,
  type ReviewTaskPatch,
  type ReviewTaskRow,
  type ReviewTaskVerdict,
} from '@/lib/homeworkReviewTasks'
import type { ReviewTasksSaveState } from '@/hooks/useHomeworkReviewTasks'
import type { GradeScale } from '@/lib/topicHomework'
import { plural } from '@/lib/plural'
import { HintNote } from '@/components/shared/HintNote'
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
 *
 * §207. Столбец вердикта ужат с 7,5rem до 6rem: список вердикта держал слово
 * целиком и отъедал ширину у ответа и заметки — ровно у того содержимого,
 * ради которого таблицу и читают («в 144 р…», «2 30/49», «Ошибка в решении:»).
 * Освободившееся отдано заметке.
 */
const COLS = 'sm:grid-cols-[2.25rem_6rem_minmax(0,1fr)_minmax(0,1.5fr)_1.75rem]'
const NO_ROWS: ReviewTaskRow[] = []
const ROW = 'grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 px-1 py-1.5 sm:gap-2'

/**
 * §207. Пояснения, которые раньше стояли на экране абзацами. Тексты верные,
 * поэтому не выброшены, — но читают их один раз, а место они занимали всегда.
 */
const TABLE_HINTS = [
  'Тексты находок — в «Комментариях» справа, привязанные к местам в работе.',
  'ИИ может ошибиться в чтении почерка и в самом решении. Таблицу выше вы правите, и ученик увидит именно её — вместе с вашим вердиктом.',
]

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
 * Чего здесь больше нет:
 * — списка находок ИИ (§199): он дословно дублировал правую колонку
 *   «Комментарии», куда рамки ИИ переносятся автоматически при открытии
 *   работы, — те же тексты, но привязанные к местам в работе;
 * — блока «Резюме ИИ» со вторым рядом счётчиков (§207) — но не кнопки
 *   «Вставить в комментарий», которая в нём жила: разбор с экрана ушёл, а
 *   вернуть его в комментарий по-прежнему бывает нужно. Счётчики ИИ спорили с
 *   табличными: таблица заполняется при ПЕРВОЙ проверке и намеренно не
 *   перезаписывается (§199), а свежий прогон показывал своё, и экран выглядел
 *   так, будто система спорит сама с собой. После §199 результат проверки —
 *   таблица преподавателя, и счётчик должен быть один, её. Про устаревшую
 *   таблицу вместо спора — спокойная строка и кнопка «Заполнить заново»;
 * — имени модели и слов про уверенность: преподавателю при проверке это ни о
 *   чём не говорит, а строку занимало.
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
}: {
  job: AiJobRow | null
  findings: AiFindingRow[]
  running: boolean
  error: string | null
  onRun: () => void
  /** Переносит рамки ИИ в разбор. Возвращает, сколько реально легло. */
  onApplyFrames: () => Promise<number>
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
}) {
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<number | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [deduping, setDeduping] = useState(false)

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
  const stale = aiCheckIsNewerThanTable(job, rows)

  const hints = useMemo(() => {
    const out = [...TABLE_HINTS]
    const dropped = job?.dropped_findings ?? 0
    // §180. Сколько находок код отбросил как самопротиворечивые («должно быть
    // 0,78, а не 0,78») и негодные. Это мера качества модели — наше измерение,
    // не рабочая информация преподавателя, поэтому под тем же знаком вопроса.
    if (dropped > 0) {
      out.push(
        `ИИ отбросил ${dropped} ${plural(dropped, 'находку', 'находки', 'находок')} как противоречивые.`,
      )
    }
    return out
  }, [job?.dropped_findings])

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
      // сцены §186 и соседние карточки на него ссылаются, а переименование
      // testid ничего не объясняет — объясняет имя компонента.
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
        заменить сами мы не имеем права: в таблице его правки. Одна спокойная
        строка, решение за ним.
      */}
      {stale && onRefillFromAi && (
        <StaleTableNotice onRefill={onRefillFromAi} />
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
            {/*
              §207. Кнопка пережила блок «Резюме ИИ», хотя жила внутри него.
              Сам разбор подставляется в комментарий сам при открытии работы;
              кнопка нужна ровно в одном случае — преподаватель стёр текст и
              хочет вернуть. Без неё это тупик: текста на экране больше нет.
            */}
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

          {(findings.length > 0 || duplicateFrames > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {findings.length > 0 && (
                <button
                  type="button"
                  data-testid="ai-check-apply-frames"
                  onClick={applyFrames}
                  disabled={applying}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {applying ? <Loader2 size={12} className="animate-spin" /> : <SquareDashed size={12} />}
                  Перенести рамки ({findings.length})
                </button>
              )}
              {/*
                §207. Кнопку показываем только при точных совпадениях — и
                только кнопку. Дубли, накопленные прежними переносами, пометки
                источника не имеют, отличить их от ручных нечем, а ручная рамка
                не восстанавливается. Значит, чистить может только человек и
                только видимым нажатием.
              */}
              {duplicateFrames > 0 && onRemoveDuplicates && (
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
              )}
              {applied != null && (
                <span data-testid="ai-check-frames-applied" className="text-[11px] text-violet-700">
                  Перенесено рамок: {applied}
                </span>
              )}
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
 * их не восстановить. Второе нажатие — цена одной секунды против потерянной
 * работы.
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
 * Тот, кто любит смотреть всё, раскрывает пачку один раз, а не на каждой
 * работе. `sessionStorage`, а не состояние экрана: очередь размонтирует панель
 * при переходе к следующей работе. Обращение в try — приватный режим и
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
  const [correctOpen, setCorrectOpen] = useState(readCorrectOpen)
  /**
   * Строки, которым преподаватель только что поставил вердикт. Без этого
   * строка, помеченная «верно», исчезала бы прямо из-под курсора: пачка
   * верных свёрнута, и правка сама себя прячет. Помеченное в этот заход
   * остаётся на виду до перехода к следующей работе.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const items = useMemo(() => groupReviewTasks(rows), [rows])

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

  const line = (row: ReviewTaskRow) => (
    editable
      ? (
        <EditableTaskLine
          key={row.id}
          row={row}
          onPatch={value => patch(row.id, value)}
          onRemove={() => onRemoveTask?.(row.id)}
        />
      )
      : <ReadOnlyTaskLine key={row.id} task={asAiTask(row)} testId="review-task-row" />
  )

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
          : items.map(item => renderItem(item, { line, correctOpen, toggleCorrect, touched }))}
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
  // на ошибки. Строки, которым вердикт поставили только что, остаются видны —
  // иначе правка прячет саму себя.
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
 * раз. Раскрытие по клику: номера заданий всё-таки нужны, когда дело доходит
 * до правки.
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
 * §207. Вердикт — компактная кнопка со значком и словом, список по клику.
 *
 * Был `<select>`: он держал слово целиком, и столбец приходилось растягивать
 * под «не сверено», отбирая ширину у ответа и заметки — у того, ради чего
 * таблицу и читают. Владелец просил «как выпадающее окно», и оно остаётся —
 * меняется только то, сколько места занимает закрытое состояние.
 *
 * Список — кнопки в `role="listbox"`, а не нативный `<select>`: покрасить
 * значок внутри опции нативный список не даёт ни в одном браузере, а цвет
 * здесь и есть способ пробежать столбец глазами.
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
    <div ref={boxRef} className="relative min-w-0">
      <button
        type="button"
        data-testid="review-task-verdict"
        data-value={verdict}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Вердикт задания ${no}`}
        onClick={() => setOpen(value => !value)}
        className={cn(
          'inline-flex w-full min-w-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] font-medium',
          style.className,
        )}
      >
        <Icon size={11} className="shrink-0" />
        <span className="truncate">{TASK_VERDICT_LABEL[verdict]}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          data-testid="review-task-verdict-menu"
          aria-label={`Вердикт задания ${no}`}
          className="absolute left-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
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
                  <OptionIcon size={11} className={cn('shrink-0', option.className.split(' ')[0])} />
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
 * Строка таблицы преподавателя.
 *
 * Вердикт уходит в базу сразу: это одно движение, ждать от него нечего.
 * Текстовые поля пишутся по уходу из поля и по Enter, а не на каждую букву:
 * «сразу по изменению» — про изменение, а не про нажатие клавиши, и запись на
 * каждый символ дала бы десятки запросов на одну заметку.
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
          <VerdictPicker
            verdict={row.verdict}
            no={row.no}
            onPick={verdict => { void onPatch({ verdict }) }}
          />
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
          {/*
            §207. Плейсхолдера здесь больше нет. Пятнадцать строк серого
            «заметка — её увидит ученик» ни о чём не сообщали: что поле для
            заметки, видно по столбцу, а повторённый пятнадцать раз серый текст
            и складывался в ту самую кашу, на которую жаловался владелец.
          */}
          <TextField
            value={row.note ?? ''}
            ariaLabel={`Заметка по заданию ${row.no}`}
            testId="review-task-note"
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
