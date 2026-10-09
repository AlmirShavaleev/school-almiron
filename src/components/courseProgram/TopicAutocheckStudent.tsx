import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { MinusToggle } from '@/components/ui/MinusToggle'
import { SignedImage } from '@/components/ui/SignedImage'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { PREVIEW_NOOP_MESSAGE } from '@/store/staffModeStore'
import {
  AUTOCHECK_MAX_ATTEMPTS,
  answerFormatError,
  autocheckSummary,
  formatCorrectAnswer,
  type AutocheckState,
  type AutocheckTask,
} from '@/lib/autocheck'
import type { CheckResult } from '@/hooks/useTopicAutocheck'
import { cn } from '@/utils/cn'
import { renderCatalogContent } from '@/lib/catalogContent'
import { upgradeMathIn } from '@/lib/katexLoader'

/**
 * §266. Блок «Задачи с автопроверкой» тренировочного урока — по макету
 * владельца: прогресс «Решено N из M · оценка …», карточки задач (условие
 * картинкой, поле ответа + единица, «Проверить», «Осталось попыток»), после
 * закрытия — вердикт и решение картинкой.
 *
 * Эталона и решения у клиента до закрытия нет вовсе (их не отдаёт сервер),
 * поэтому «показать раньше времени» тут нечего — экран рисует то, что пришло.
 *
 * §279: задачи не лентой, а по одной — как шаги на Stepik: сверху ряд
 * квадратиков с номерами (цвет = состояние), под ним одна задача и «Назад /
 * Далее». Открывается первая незакрытая задача.
 */
export function TopicAutocheckStudent({
  state,
  onCheck,
  preview = false,
}: {
  state: AutocheckState
  onCheck: (taskId: string, answer: string) => Promise<CheckResult>
  /** Предпросмотр персонала: поле и кнопка выключены, ничего не отправляется. */
  preview?: boolean
}) {
  const total = state.total || state.tasks.length
  const pct = total > 0 ? Math.round((100 * state.solved) / total) : 0

  return (
    <section data-testid="autocheck-block" aria-label="Задачи с автопроверкой" className="platform-surface space-y-4 rounded-card bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-bold text-graphite-900">Задачи с автопроверкой</h2>
        <span data-testid="autocheck-summary" className="text-[13px] text-graphite-500 tabular-nums">
          {autocheckSummary(state)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-graphite-200"
        role="progressbar"
        aria-label="Решено задач"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={state.solved}
      >
        <div className="h-full rounded-full bg-verdict-ok transition-[width] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>

      {state.tasks.length === 0 ? (
        <p className="text-sm text-graphite-500">Задачи ещё не добавлены.</p>
      ) : (
        <TaskStepper tasks={state.tasks} onCheck={onCheck} preview={preview} />
      )}

      <p className="text-[13px] leading-snug text-graphite-500">
        На каждую задачу {AUTOCHECK_MAX_ATTEMPTS} попытки. После верного ответа или третьей ошибки открывается решение.
        Оценка — доля решённых задач по 100-балльной шкале; она попадёт в журнал, когда закрыты все задачи.
      </p>
    </section>
  )
}

type StepTone = 'solved' | 'failed' | 'tried' | 'new'

function stepTone(t: AutocheckTask): StepTone {
  if (t.closed) return t.solved ? 'solved' : 'failed'
  return t.answers.length > 0 ? 'tried' : 'new'
}

const STEP_LABEL: Record<StepTone, string> = {
  solved: 'решена',
  failed: 'попытки закончились',
  tried: 'есть неверный ответ',
  new: 'не начата',
}

const STEP_CLS: Record<StepTone, string> = {
  solved: 'border-verdict-ok bg-verdict-ok text-white',
  failed: 'border-verdict-bad bg-verdict-bad text-white',
  tried: 'border-verdict-part bg-verdict-part-tint text-verdict-part-ink',
  new: 'border-graphite-200 bg-graphite-50 text-graphite-700 hover:border-primary-300 hover:bg-primary-50',
}

/** Индекс первой незакрытой задачи (все закрыты — первая). */
function firstOpenIndex(tasks: AutocheckTask[]): number {
  const i = tasks.findIndex(t => !t.closed)
  return i < 0 ? 0 : i
}

function TaskStepper({
  tasks,
  onCheck,
  preview,
}: {
  tasks: AutocheckTask[]
  onCheck: (taskId: string, answer: string) => Promise<CheckResult>
  preview: boolean
}) {
  const [current, setCurrent] = useState(() => firstOpenIndex(tasks))
  const idx = Math.min(current, tasks.length - 1)
  const task = tasks[idx]

  // «Далее» после закрытой задачи ведёт к следующей незакрытой, если она есть.
  const nextOpen = useMemo(() => {
    for (let k = 1; k <= tasks.length; k++) {
      const j = (idx + k) % tasks.length
      if (!tasks[j].closed) return j
    }
    return -1
  }, [tasks, idx])

  return (
    <div className="space-y-3">
      <nav aria-label="Задачи" data-testid="autocheck-steps">
        <ol className="flex flex-wrap gap-1.5">
          {tasks.map((t, i) => {
            const tone = stepTone(t)
            const active = i === idx
            return (
              <li key={t.id}>
                <button
                  type="button"
                  data-testid="autocheck-step"
                  data-tone={tone}
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Задача ${i + 1}: ${STEP_LABEL[tone]}`}
                  onClick={() => setCurrent(i)}
                  className={cn(
                    'grid h-9 min-w-9 place-items-center rounded-lg border-[1.5px] px-1.5 text-[13px] font-extrabold tabular-nums transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                    STEP_CLS[tone],
                    active && 'ring-2 ring-primary-600 ring-offset-2',
                  )}
                >
                  {i + 1}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <ol>
        <AutocheckTaskCard key={task.id} task={task} n={idx + 1} onCheck={onCheck} preview={preview} />
      </ol>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="autocheck-prev"
          disabled={idx === 0}
          onClick={() => setCurrent(idx - 1)}
        >
          <ChevronLeft size={15} aria-hidden />Назад
        </Button>
        <span className="text-[13px] text-graphite-500 tabular-nums">{idx + 1} из {tasks.length}</span>
        {task.closed && nextOpen >= 0 ? (
          <Button type="button" size="sm" data-testid="autocheck-next" onClick={() => setCurrent(nextOpen)}>
            Следующая задача<ChevronRight size={15} aria-hidden />
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="autocheck-next"
            disabled={idx === tasks.length - 1}
            onClick={() => setCurrent(idx + 1)}
          >
            Далее<ChevronRight size={15} aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}

function AutocheckTaskCard({
  task,
  n,
  onCheck,
  preview,
}: {
  task: AutocheckTask
  n: number
  onCheck: (taskId: string, answer: string) => Promise<CheckResult>
  preview: boolean
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const inputId = `autocheck-${task.id}`
  const msgId = `${inputId}-msg`

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (preview || task.closed || busy) return
    const formatError = answerFormatError(task.answerType, value)
    if (formatError) { setMessage({ tone: 'bad', text: formatError }); return }
    setBusy(true)
    setMessage(null)
    try {
      const res = await onCheck(task.id, value)
      if (!res.ok) setMessage({ tone: 'bad', text: res.error ?? 'Не удалось проверить ответ' })
      else if (!res.correct) setMessage({ tone: 'bad', text: 'Неверно, попробуйте ещё' })
      else setMessage(null)
      if (res.ok && !res.correct) setValue('')
    } finally {
      setBusy(false)
    }
  }

  const correctAnswer = formatCorrectAnswer(task)
  const last = task.answers[task.answers.length - 1]

  return (
    <li
      data-testid="autocheck-task"
      data-state={task.closed ? (task.solved ? 'solved' : 'failed') : 'open'}
      className={cn(
        'space-y-3 rounded-xl border-[1.5px] p-3 sm:p-4',
        task.closed ? (task.solved ? 'border-verdict-ok' : 'border-verdict-bad') : 'border-graphite-200',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-extrabold text-primary-700">№ {n}</span>
        {task.closed && <VerdictMark state={task.solved ? 'ok' : 'bad'} size={16} />}
      </div>

      {task.statementMd
        ? <TaskText md={task.statementMd} testid="autocheck-statement-text" />
        : <ZoomableImage path={task.statementPath} alt={`Условие задачи ${n}`} />}

      {!task.closed ? (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2" noValidate>
          <label htmlFor={inputId} className="sr-only">Ответ к задаче {n}</label>
          <input
            ref={inputRef}
            id={inputId}
            data-testid="autocheck-input"
            inputMode={task.answerType === 'number' ? 'decimal' : 'numeric'}
            autoComplete="off"
            placeholder="Ответ"
            value={value}
            onChange={e => { setValue(e.target.value); if (message) setMessage(null) }}
            disabled={preview || busy}
            title={preview ? PREVIEW_NOOP_MESSAGE : undefined}
            aria-describedby={message ? msgId : undefined}
            aria-invalid={message?.tone === 'bad' ? true : undefined}
            className="min-h-11 w-32 rounded-lg border-[1.5px] border-graphite-300 bg-white px-3 py-1.5 text-base tabular-nums text-graphite-900 placeholder-graphite-400 focus:border-primary-600 focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:bg-graphite-50 sm:min-h-9 sm:text-[15px]"
          />
          {task.answerType === 'number' && !preview && (
            <MinusToggle
              value={value}
              getInput={() => inputRef.current}
              onChange={v => { setValue(v); if (message) setMessage(null) }}
              disabled={busy}
              testid="autocheck-minus"
              className="min-h-11 sm:h-9 sm:min-h-9"
            />
          )}
          {task.unit && <span className="text-sm text-graphite-500">{task.unit}</span>}
          <Button
            type="submit"
            size="sm"
            data-testid="autocheck-submit"
            // Одна главная кнопка на экран: синяя — только там, где ответ уже набран.
            variant={value.trim() ? 'primary' : 'secondary'}
            disabled={preview || busy || !value.trim()}
            title={preview ? PREVIEW_NOOP_MESSAGE : undefined}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Проверить
          </Button>
          <span data-testid="autocheck-tries" className="text-[13px] text-graphite-500 tabular-nums">
            Осталось попыток: {task.attemptsLeft}
          </span>
          {task.answerType === 'digits' && (
            <span className="basis-full text-[13px] text-graphite-500">
              Ответ — цифры подряд{task.digitsAnyOrder ? ', порядок не важен' : ''}.
            </span>
          )}
        </form>
      ) : null}

      {message && (
        <p id={msgId} role="status" className={cn('text-[13.5px] font-bold', message.tone === 'ok' ? 'text-verdict-ok-ink' : 'text-verdict-bad-ink')}>
          {message.text}
        </p>
      )}
      {!task.closed && !message && last && !last.correct && (
        <p className="text-[13px] text-graphite-500">
          Последний ответ «{last.answer}» — неверно.
        </p>
      )}

      {task.closed && (
        <div className="space-y-2">
          <p
            data-testid="autocheck-verdict"
            role="status"
            className={cn('text-[13.5px] font-bold', task.solved ? 'text-verdict-ok-ink' : 'text-verdict-bad-ink')}
          >
            {task.solved
              ? `Верно${task.attemptsUsed > 1 ? ` · с ${task.attemptsUsed}-й попытки` : ''}`
              : `Попытки закончились.${correctAnswer ? ` Верный ответ: ${correctAnswer}` : ''}`}
          </p>
          {task.answers.length > 0 && (
            <p className="text-[13px] text-graphite-500">
              Ваши ответы: {task.answers.map(a => `${a.answer}${a.correct ? ' ✓' : ''}`).join(' · ')}
            </p>
          )}
          {task.solutionMd || task.solutionPath ? (
            <div data-testid="autocheck-solution" className="rounded-lg bg-verdict-ok-tint p-2 sm:p-3">
              <div className="mb-1.5 text-[12px] font-extrabold uppercase tracking-[0.05em] text-verdict-ok-ink">Решение</div>
              {task.solutionMd
                ? <div className="rounded bg-white p-2 sm:p-3"><TaskText md={task.solutionMd} testid="autocheck-solution-text" /></div>
                : <ZoomableImage path={task.solutionPath!} alt={`Решение задачи ${n}`} sensitive hint={false} className="rounded bg-white" />}
            </div>
          ) : null}
        </div>
      )}
    </li>
  )
}

/**
 * §278. Условие или решение текстом — тот же безопасный рендер, что у каталога
 * (§269): Markdown экранируется, формулы — KaTeX (догружается лениво и
 * дорисовывается на месте), рисунки — только из бакета рисунков каталога.
 * Текст подстраивается под ширину экрана — увеличивать нечего.
 */
function TaskText({ md, testid }: { md: string; testid: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderCatalogContent(md), [md])
  useEffect(() => { void upgradeMathIn(ref.current) }, [html])
  return (
    <div
      ref={ref}
      data-testid={testid}
      className="prose prose-sm max-w-none break-words text-graphite-900 catalog-html [&_img]:max-w-full [&_img]:h-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Условие и решение — картинки, свёрстанные под колонку листа PDF (~720 px).
 * На телефоне во всю ширину текст на них мельче 13 px, поэтому картинку можно
 * увеличить нажатием: она становится 640 px и прокручивается вбок внутри
 * карточки (страница вбок не едет). На ноутбуке — до 640 px, увеличивать нечего.
 */
function ZoomableImage({ path, alt, sensitive = false, hint = true, className }: { path: string; alt: string; sensitive?: boolean; hint?: boolean; className?: string }) {
  const [zoom, setZoom] = useState(false)
  return (
    <div className="max-w-[640px]">
      <div className="overflow-x-auto" data-testid="autocheck-image">
        <button
          type="button"
          onClick={() => setZoom(z => !z)}
          aria-pressed={zoom}
          aria-label={zoom ? `${alt}: уменьшить` : `${alt}: увеличить`}
          className={cn('block max-w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500', zoom && 'max-w-none')}
        >
          {/* §274.2: картинка в своём размере (SVG знает ширину), не растягивается на всю карточку — иначе текст огромный.
              Узкий экран — ужимается до ширины; нажатие — исходный размер с прокруткой вбок. */}
          <SignedImage bucket="topic-autocheck" path={path} alt={alt} sensitive={sensitive} className={cn('block h-auto', zoom ? 'max-w-none' : 'max-w-full', className)} />
        </button>
      </div>
      {hint && <span className="mt-1 block text-[13px] text-graphite-500 sm:hidden">
        {zoom ? 'Нажмите ещё раз, чтобы уменьшить' : 'Нажмите на картинку, чтобы увеличить'}
      </span>}
    </div>
  )
}
