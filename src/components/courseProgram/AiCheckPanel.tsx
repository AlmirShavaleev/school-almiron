import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  MinusCircle,
  Sparkles,
  SquareDashed,
  XCircle,
} from 'lucide-react'
import {
  CONFIDENCE_LABEL,
  FINDING_CATEGORY_LABEL,
  TASK_VERDICT_LABEL,
  aiTasksOf,
  findingsOfTask,
  normalizeTaskNo,
  referenceNotice,
  shouldShowScore,
  summarizeTasks,
  taskNoFromText,
  worksheetNotice,
  aiErrorMessage,
  type AiFindingRow,
  type AiJobRow,
  type AiTaskRow,
  type AiTaskVerdict,
} from '@/lib/aiHomeworkCheck'
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
 * Панель черновика ИИ в разборе работы.
 *
 * Тон здесь важнее вёрстки. Это предложение, а не результат проверки, и
 * интерфейс обязан говорить об этом сам, без пояснений в документации:
 * отсюда «предлагает», а не «оценил», отдельная кнопка переноса рамок и
 * молчание про балл, когда модель не уверена (shouldShowScore).
 *
 * Ученик этой панели не видит никогда: RLS отдаёт topic_homework_ai_* только
 * персоналу курса.
 */
export function AiCheckPanel({
  job,
  findings,
  running,
  error,
  onRun,
  onApplyFrames,
  onUseText,
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
}) {
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<number | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  /** Задание, по строке которого щёлкнули: его находки подсвечены ниже. */
  const [activeTask, setActiveTask] = useState<string | null>(null)

  const tasks = aiTasksOf(job)
  const summary = tasks ? summarizeTasks(tasks) : null
  /**
   * Номера заданий, у которых находка вообще есть. Строка без находки
   * кликабельной не делается: нажатие, которое ничего не меняет, читается
   * как поломка интерфейса, а не как «тут нечего показывать».
   */
  const tasksWithFindings = useMemo(() => {
    const set = new Set<string>()
    for (const f of findings) {
      const no = normalizeTaskNo(taskNoFromText(f.text))
      if (no) set.add(no)
    }
    return set
  }, [findings])

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
      data-testid="ai-check-panel"
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-900">
          <Sparkles size={14} />
          Черновик ИИ
        </span>
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

      {!running && !job && !shownError && (
        <p className="mt-2 text-xs text-violet-800">
          ИИ прочитает работу, решит задачу сам и предложит рамки, балл и текст обратной связи.
          Решение остаётся за вами — ученик увидит только то, что вы подтвердите.
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
            ) : (
              <span className="rounded-md bg-white px-2 py-0.5 text-gray-500">Балл не предлагается</span>
            )}
            {job.confidence && (
              <span className="text-violet-700">{CONFIDENCE_LABEL[job.confidence]}</span>
            )}
            {findings.length > 0 && (
              <span className="text-violet-700">· нашёл мест: {findings.length}</span>
            )}
            {job.model && (
              // Подпись модели нужна, пока мы сравниваем провайдеров: без неё
              // непонятно, чей это разбор — Qwen или Gemini.
              <span data-testid="ai-check-model" className="text-violet-500">· {job.model}</span>
            )}
          </div>

          {job.summary && (
            <div className="rounded-lg border border-violet-200 bg-white p-2.5">
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

          {/*
            §186. Таблица по заданиям — то, из чего код посчитал балл (§180).
            До неё преподаватель читал абзац резюме там, где хватает пробежать
            глазами строки и увидеть, на каком задании ИИ ошибся. Проверок
            старее v17 в базе три десятка: у них tasks пуст, и блока нет вовсе.
          */}
          {tasks && summary && (
            <section data-testid="ai-check-tasks" className="rounded-lg border border-violet-200 bg-white p-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-semibold text-violet-900">По заданиям</span>
                <span data-testid="ai-check-tasks-summary" className="text-[11px] text-gray-600">
                  верно {summary.correct} · неверно {summary.wrong} · частично {summary.partial}
                  {' '}· не сверено {summary.unchecked}
                </span>
                {/*
                  Балл рядом со сводкой, а не отдельно: он и есть её итог.
                  Прячем по тому же правилу, что и балл в шапке панели
                  (shouldShowScore) — показать здесь число, которое панель выше
                  сознательно не назвала, значило бы обойти правило §180.
                */}
                {shouldShowScore(job) && (
                  <span
                    data-testid="ai-check-tasks-score"
                    className="rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-900"
                  >
                    → балл {job.suggested_score}
                  </span>
                )}
              </div>

              {/* Шапка столбцов — только там, где строка в столбцы укладывается. */}
              <div className="mt-2 hidden px-1 text-[10px] uppercase tracking-wide text-gray-400 sm:grid sm:grid-cols-[2.25rem_6.75rem_minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-2">
                <span>№</span>
                <span>Вердикт</span>
                <span>Ответ → ожидаемый</span>
                <span>Заметка</span>
              </div>

              <ul className="mt-1 divide-y divide-gray-100">
                {tasks.map(task => (
                  <TaskLine
                    key={task.no}
                    task={task}
                    active={activeTask != null && activeTask === normalizeTaskNo(task.no)}
                    // Подсвечивать нечего — и нажимать не на что.
                    selectable={
                      (task.verdict === 'wrong' || task.verdict === 'partial')
                      && tasksWithFindings.has(normalizeTaskNo(task.no))
                    }
                    onSelect={() => setActiveTask(current => {
                      const no = normalizeTaskNo(task.no)
                      return current === no ? null : no
                    })}
                  />
                ))}
              </ul>
            </section>
          )}

          {/*
            Список находок. Раньше панель их только считала («нашёл мест: 3») и
            умела перенести рамками — прочитать текст можно было, лишь ткнув в
            каждую рамку на странице. Строка таблицы подсвечивает свою находку
            здесь; к рамке на странице панель не прокручивает — это §184.
          */}
          {findings.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-violet-900">Находки</p>
              <ul data-testid="ai-check-findings" className="space-y-1.5">
                {findings.map(finding => {
                const no = normalizeTaskNo(taskNoFromText(finding.text))
                const active = activeTask != null && no !== '' && no === activeTask
                return (
                  <li
                    key={finding.id}
                    data-testid="ai-check-finding"
                    data-task={no || undefined}
                    data-active={active ? 'true' : undefined}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 transition-colors',
                      active ? 'border-violet-400 bg-violet-100' : 'border-gray-200 bg-white',
                    )}
                  >
                    <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                      {FINDING_CATEGORY_LABEL[finding.category] ?? 'Замечание'}
                    </span>
                    <p className="mt-0.5 break-words text-xs leading-5 text-gray-700">{finding.text}</p>
                  </li>
                )
              })}
              </ul>
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
                Станут вашими пометками — их можно двигать и удалять.
              </span>
            </div>
          )}

          {applyError && (
            <p className="text-xs text-red-700">{applyError}</p>
          )}

          <p className="text-[11px] leading-4 text-violet-700">
            ИИ может ошибиться в чтении почерка и в самом решении. Балл и вердикт ставите вы —
            ученик ничего из этого не видит.
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

/**
 * Строка таблицы заданий.
 *
 * Одна разметка на оба размера: на широком экране четыре столбца, на узком —
 * карточка (номер и вердикт в строке, ответы и заметка под ними). Отдельной
 * «мобильной» копии нет намеренно — две копии разъезжаются, а горизонтальный
 * скролл в панели шириной с телефон недопустим.
 */
function TaskLine({
  task,
  active,
  selectable,
  onSelect,
}: {
  task: AiTaskRow
  active: boolean
  selectable: boolean
  onSelect: () => void
}) {
  const style = VERDICT_STYLE[task.verdict]
  const Icon = style.icon
  const answers = task.student_answer || task.expected_answer

  const body = (
    <>
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
        <span className="col-start-2 min-w-0 break-words text-[11px] leading-5 text-gray-500 sm:col-start-4">
          {task.note}
        </span>
      ) : <span className="hidden sm:block" />}
    </>
  )

  const grid = 'grid w-full grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 px-1 py-1.5 text-left sm:grid-cols-[2.25rem_6.75rem_minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-2'

  return (
    <li
      data-testid="ai-task-row"
      data-no={task.no}
      data-verdict={task.verdict}
      data-active={active ? 'true' : undefined}
    >
      {selectable ? (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={active}
          className={cn(
            grid,
            'rounded-md transition-colors hover:bg-violet-50',
            active && 'bg-violet-100',
          )}
        >
          {body}
        </button>
      ) : (
        <div className={grid}>{body}</div>
      )}
    </li>
  )
}
