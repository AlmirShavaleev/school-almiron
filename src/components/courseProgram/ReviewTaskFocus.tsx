import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, MoreHorizontal, Plus, Sparkles } from 'lucide-react'
import {
  aiErrorMessage,
  aiTasksOf,
  type AiFindingRow,
  type AiJobRow,
} from '@/lib/aiHomeworkCheck'
import {
  REVIEW_TASK_VERDICT_LABEL,
  aiCheckIsNewerThanTable,
  type ReviewTaskPatch,
  type ReviewTaskRow,
  type ReviewTaskVerdict,
} from '@/lib/homeworkReviewTasks'
import { noteTaskKey, notesOfTask, pendingFindings, type ReviewNote } from '@/lib/reviewNotes'
import {
  FOCUS_VERDICTS,
  FOCUS_VERDICT_KEYS,
  FOCUS_VERDICT_LABEL,
  aiHintsByRow,
  aiLineText,
  focusCounts,
  hasAiHint,
  isTypingTarget,
  stepIndex,
  stripTone,
  type FocusVerdict,
  type StripTone,
} from '@/lib/reviewFocus'
import { taskNoOfFinding } from '@/lib/aiHomeworkCheck'
import type { ReviewTasksSaveState } from '@/hooks/useHomeworkReviewTasks'
import { FindingSuggestion, NoteLine } from './ReviewTaskTable'
import { cn } from '@/utils/cn'

const NO_IDS: readonly string[] = []
const NO_NOTES: readonly ReviewNote[] = []
const NO_FINDINGS: readonly AiFindingRow[] = []

const STRIP_TONE_CLASS: Record<StripTone, string> = {
  ok: 'border-transparent bg-verdict-ok-tint text-verdict-ok-ink',
  part: 'border-transparent bg-verdict-part-tint text-verdict-part-ink',
  bad: 'border-transparent bg-verdict-bad-tint text-verdict-bad-ink',
  neutral: 'border-graphite-200 bg-white text-graphite-500',
}

const VERDICT_PRESSED_CLASS: Record<FocusVerdict, string> = {
  correct: 'border-verdict-ok bg-verdict-ok text-white',
  partial: 'border-verdict-part bg-verdict-part text-white',
  wrong: 'border-verdict-bad bg-verdict-bad text-white',
}

/** Слово вердикта в подписи номера для читалки: «Задание 4: неверно». */
const STRIP_WORD: Record<ReviewTaskVerdict, string> = {
  correct: 'верно',
  partial: 'частично',
  wrong: 'неверно',
  unchecked: 'не проверено',
  unsolved: 'не решено',
}

/**
 * §248. Правая панель спокойного экрана проверки — ОДНО текущее задание.
 *
 * Сверху полоса номеров (8 в ряд): цвет — вердикт, синяя точка — у ИИ есть
 * подсказка, обводка — где вы сейчас. Под ней — текущее задание: ответ
 * ученика и эталон друг под другом, строка «ИИ: …», три кнопки вердикта
 * (клавиши 1/2/3), «+ Замечание ученику», «Решение в эталоне» и «Назад /
 * Дальше» (клавиши ←/→).
 *
 * Что ушло с глаз, но не пропало (владелец назвал это шумом):
 *  - фильтры-счётчики, светофор «зелёные свёрнуты», «16 проверить» — всё
 *    это живёт в полной таблице заданий (`ReviewTaskTable`), она открывается
 *    из «…» в шапке;
 *  - «Не решено» и «Не сверено» — в «…» у задания: вердикты редкие, а клавиши
 *    1/2/3 — только три основных;
 *  - «Обвести на фото» и «Убрать задание» — там же.
 *
 * Вердикт пишется тем же путём, что в таблице: `onPatchTask(id, { verdict })`
 * → `useHomeworkReviewTasks.patchRow`. ИИ сюда ничего не пишет.
 */
export function ReviewTaskFocus({
  tasks,
  job,
  findings = NO_FINDINGS,
  running = false,
  error = null,
  onRun,
  saveState = 'idle',
  currentNo,
  onCurrentChange,
  onPatchTask,
  onRemoveTask,
  onAddTask,
  onSeedTasks,
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
  onShowReference,
  onOpenTable,
  keyboard = true,
}: {
  tasks: readonly ReviewTaskRow[]
  job: AiJobRow | null
  findings?: readonly AiFindingRow[]
  running?: boolean
  error?: string | null
  onRun?: () => void
  saveState?: ReviewTasksSaveState
  /** Номер текущего задания; нет или не найден — первое. */
  currentNo: string | null
  onCurrentChange: (no: string) => void
  onPatchTask?: (id: string, patch: ReviewTaskPatch) => Promise<boolean> | void
  onRemoveTask?: (id: string) => Promise<boolean> | void
  onAddTask?: () => Promise<boolean> | void
  onSeedTasks?: () => Promise<boolean> | void
  /** Рамки-замечания аннотатора (§209). */
  notes?: readonly ReviewNote[]
  /** Рамка, выбранная кликом на фото: её задание становится текущим. */
  activeNoteId?: string | null
  dismissedFindings?: readonly string[]
  takenFindingIds?: readonly string[]
  onStartNote?: (taskNo: string) => void
  onFocusNote?: (id: string) => void
  onDeleteNote?: (id: string) => Promise<boolean> | void
  onEditNote?: (id: string, text: string) => Promise<boolean> | void
  onTakeFinding?: (finding: AiFindingRow) => Promise<boolean> | void
  onSkipFinding?: (finding: AiFindingRow) => Promise<boolean> | void
  /** Открыть эталон (панель поверх фото или блок ниже — решает экран). */
  onShowReference?: (() => void) | null
  /** Полная таблица заданий — всё, что с этого экрана убрано. */
  onOpenTable?: () => void
  /**
   * Клавиши экрана. Выключаются, пока открыта полная таблица (у неё своя
   * раскладка §209: там 2 — «неверно») или выбрана рамка на фото (стрелки
   * тогда двигают рамку, §184).
   */
  keyboard?: boolean
}) {
  const rows = tasks
  const editable = rows.length > 0 && onPatchTask != null
  const aiTasks = useMemo(() => aiTasksOf(job), [job])
  const suggestions = useMemo(
    () => pendingFindings(findings, takenFindingIds, dismissedFindings),
    [dismissedFindings, findings, takenFindingIds],
  )
  const hints = useMemo(() => aiHintsByRow(rows, aiTasks, suggestions), [aiTasks, rows, suggestions])
  const counts = focusCounts(rows)
  const anyHint = rows.some(row => hasAiHint(hints.get(row.id)))

  const currentIndex = Math.max(0, rows.findIndex(row => noteTaskKey(row.no) === noteTaskKey(currentNo)))
  const current = rows[currentIndex] ?? null

  // Текущее задание едет наружу: по нему экран подсвечивает рамку на фото и
  // строку в эталоне. Пока снаружи номера нет — сообщаем первое.
  useEffect(() => {
    if (current && noteTaskKey(current.no) !== noteTaskKey(currentNo)) onCurrentChange(current.no)
  }, [current, currentNo, onCurrentChange])

  // Кликнули рамку на фото — текущим становится её задание: номер на рамке и
  // задание справа обязаны говорить об одном (§226).
  const appliedNoteRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeNoteId || appliedNoteRef.current === activeNoteId) return
    appliedNoteRef.current = activeNoteId
    const note = notes.find(item => item.id === activeNoteId)
    const key = noteTaskKey(note?.taskNo)
    const row = key ? rows.find(item => noteTaskKey(item.no) === key) : undefined
    if (row) onCurrentChange(row.no)
  }, [activeNoteId, notes, onCurrentChange, rows])

  function go(index: number) {
    const row = rows[index]
    if (row) onCurrentChange(row.no)
  }

  function setVerdict(row: ReviewTaskRow, verdict: ReviewTaskVerdict) {
    if (!onPatchTask || row.verdict === verdict) return
    void onPatchTask(row.id, { verdict })
  }

  // Клавиши — на окне: фокус у проверяющего где угодно (на фото, на кнопке),
  // а цифра должна попасть в текущее задание. Свежие значения — через ref,
  // чтобы подписка не пересоздавалась на каждый рендер.
  const keysRef = useRef({ editable, keyboard, rows, currentIndex })
  useEffect(() => { keysRef.current = { editable, keyboard, rows, currentIndex } })
  const actionsRef = useRef({ setVerdict, go })
  useEffect(() => { actionsRef.current = { setVerdict, go } })
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const state = keysRef.current
      if (!state.keyboard || state.rows.length === 0) return
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      const verdict = FOCUS_VERDICT_KEYS[event.key]
      if (verdict) {
        if (!state.editable) return
        const row = state.rows[state.currentIndex]
        if (!row) return
        event.preventDefault()
        actionsRef.current.setVerdict(row, verdict)
        // §209: цифра ставит вердикт и уводит к следующему — двадцать заданий
        // это двадцать нажатий, а не сорок. На последнем остаёмся.
        actionsRef.current.go(stepIndex(state.currentIndex, 1, state.rows.length))
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        actionsRef.current.go(stepIndex(state.currentIndex, event.key === 'ArrowRight' ? 1 : -1, state.rows.length))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const stale = aiCheckIsNewerThanTable(job, rows)
  const failed = job?.status === 'failed'
  const shownError = error ?? (failed ? aiErrorMessage(job?.last_error) : null)

  if (rows.length === 0) {
    return (
      <EmptyPanel
        running={running}
        error={shownError}
        canSeed={Boolean(aiTasks && aiTasks.length > 0 && onSeedTasks)}
        hasJob={job != null}
        onRun={onRun}
        onSeed={onSeedTasks}
        onAdd={onAddTask}
      />
    )
  }

  const hint = current ? hints.get(current.id) : undefined
  const aiLine = aiLineText(hint)
  const rootCheck = hint?.triage?.rootCheck
  const taskNotes = current ? notesOfTask(notes, current.no) : []
  const taskSuggestions = current
    ? suggestions.filter(finding => noteTaskKey(taskNoOfFinding(finding)) === noteTaskKey(current.no))
    : []

  return (
    <section data-testid="review-focus" aria-label="Задания" className="flex flex-col gap-3.5">
      <div>
        <div
          data-testid="review-focus-strip"
          role="group"
          aria-label="Номера заданий"
          className="grid grid-cols-8 gap-[5px]"
        >
          {rows.map((row, index) => {
            const tone = stripTone(row.verdict)
            const dot = hasAiHint(hints.get(row.id))
            const isCurrent = index === currentIndex
            return (
              <button
                key={row.id}
                type="button"
                data-testid="review-focus-cell"
                data-no={row.no}
                data-tone={tone}
                data-verdict={row.verdict}
                data-ai={dot ? 'true' : undefined}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`Задание ${row.no}: ${STRIP_WORD[row.verdict]}${dot ? ', есть подсказка ИИ' : ''}`}
                onClick={() => go(index)}
                className={cn(
                  'relative h-8 min-w-0 rounded-lg border text-[13px] font-extrabold tabular-nums transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
                  STRIP_TONE_CLASS[tone],
                  tone === 'neutral' && 'hover:border-graphite-300 hover:text-graphite-900',
                  isCurrent && 'outline outline-2 outline-offset-1 outline-graphite-900',
                )}
              >
                {row.no}
                {dot && (
                  <span
                    aria-hidden
                    data-testid="review-focus-ai-dot"
                    className="absolute right-[3px] top-[3px] h-[5px] w-[5px] rounded-full bg-primary-600"
                  />
                )}
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-graphite-500">
          <span data-testid="review-focus-legend">
            {counts.correct} верно · {counts.partial} частично · {counts.wrong} неверно
          </span>
          {anyHint && <span>точка — есть подсказка ИИ</span>}
        </div>
      </div>

      {current && (
        <div data-testid="review-focus-task" data-no={current.no} className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[17px] font-extrabold leading-tight text-graphite-900">Задание {current.no}</h3>
            <span className="flex items-center gap-1">
              <span data-testid="review-focus-position" className="text-xs tabular-nums text-graphite-400">
                {currentIndex + 1} из {rows.length}
              </span>
              <SaveDot state={saveState} />
              <TaskMenu
                no={current.no}
                verdict={current.verdict}
                editable={editable}
                onVerdict={verdict => setVerdict(current, verdict)}
                onStartNote={onStartNote ? () => onStartNote(current.no) : undefined}
                onRemove={onRemoveTask ? () => { void onRemoveTask(current.id) } : undefined}
              />
            </span>
          </div>

          {(current.verdict === 'unchecked' || current.verdict === 'unsolved') && (
            <p data-testid="review-focus-rare" className="-mt-1 text-xs font-semibold text-graphite-500">
              Сейчас: {REVIEW_TASK_VERDICT_LABEL[current.verdict]}
            </p>
          )}

          <div className="grid gap-1.5">
            <div className="grid gap-0.5 rounded-[10px] bg-graphite-50 px-2.5 py-2">
              <small className="text-[11px] font-bold uppercase tracking-[0.04em] text-graphite-500">Ответ ученика</small>
              <span data-testid="review-focus-student" className="break-words text-base font-bold text-graphite-900">
                {current.student_answer?.trim() || '—'}
              </span>
            </div>
            <div className="grid gap-0.5 rounded-[10px] bg-primary-50 px-2.5 py-2">
              <small className="text-[11px] font-bold uppercase tracking-[0.04em] text-graphite-500">Эталон</small>
              <span data-testid="review-focus-expected" className="break-words text-base font-bold text-graphite-900">
                {current.expected_answer?.trim() || <span className="text-sm font-medium text-graphite-500">ответа в таблице нет</span>}
              </span>
            </div>
          </div>

          {aiLine && (
            <p data-testid="review-focus-ai" className="flex items-start gap-1.5 text-[13px] leading-snug text-graphite-600">
              <b className="shrink-0 font-extrabold text-primary-700">ИИ</b>
              <span className="min-w-0 break-words">{aiLine}</span>
            </p>
          )}
          {rootCheck && (
            <p
              data-testid="review-focus-rootcheck"
              className={cn('-mt-1 text-xs leading-snug', rootCheck.verdict === 'false_claim' ? 'text-verdict-part-ink' : 'text-graphite-500')}
            >
              Система проверила: {rootCheck.value} {rootCheck.actual ? 'входит' : 'не входит'} в {rootCheck.interval}
              {rootCheck.verdict === 'false_claim' ? ' — претензия ИИ, скорее всего, ложная.' : '.'}
            </p>
          )}

          <div role="group" aria-label={`Вердикт задания ${current.no}`} className="grid grid-cols-3 gap-1.5">
            {FOCUS_VERDICTS.map((verdict, index) => {
              const on = current.verdict === verdict
              return (
                <button
                  key={verdict}
                  type="button"
                  data-testid={`review-focus-verdict-${verdict}`}
                  aria-pressed={on}
                  aria-keyshortcuts={String(index + 1)}
                  disabled={!editable}
                  onClick={() => setVerdict(current, verdict)}
                  className={cn(
                    'grid gap-px rounded-[10px] border px-1 py-2.5 text-sm font-extrabold transition-colors disabled:opacity-50',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600',
                    on ? VERDICT_PRESSED_CLASS[verdict] : 'border-graphite-200 bg-white text-graphite-900 hover:border-graphite-300',
                  )}
                >
                  {FOCUS_VERDICT_LABEL[verdict]}
                  <small className={cn('text-[11px] font-bold', on ? 'text-white/80' : 'text-graphite-400')}>{index + 1}</small>
                </button>
              )
            })}
          </div>

          <StudentRemark
            key={current.id}
            row={current}
            editable={editable}
            onSave={note => onPatchTask?.(current.id, { note })}
            onShowReference={onShowReference ?? undefined}
          />

          {(taskNotes.length > 0 || taskSuggestions.length > 0) && (
            <div data-testid="review-focus-frames" className="space-y-1.5">
              {taskNotes.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-graphite-500">Рамки на фото</span>
                  <ul>
                    {taskNotes.map(note => (
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
                </div>
              )}
              {taskSuggestions.map(finding => (
                <FindingSuggestion key={finding.id} finding={finding} onTake={onTakeFinding} onSkip={onSkipFinding} />
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              data-testid="review-focus-prev"
              aria-keyshortcuts="ArrowLeft"
              disabled={currentIndex <= 0}
              onClick={() => go(currentIndex - 1)}
              className="flex-1 rounded-[10px] border border-graphite-200 bg-white px-2 py-2 text-sm font-bold text-graphite-900 transition-colors hover:border-graphite-300 disabled:opacity-40"
            >
              ← Назад
            </button>
            <button
              type="button"
              data-testid="review-focus-next"
              aria-keyshortcuts="ArrowRight"
              disabled={currentIndex >= rows.length - 1}
              onClick={() => go(currentIndex + 1)}
              className="flex-1 rounded-[10px] border border-graphite-200 bg-white px-2 py-2 text-sm font-bold text-graphite-900 transition-colors hover:border-graphite-300 disabled:opacity-40"
            >
              Дальше →
            </button>
          </div>
        </div>
      )}

      <AiStatus
        running={running}
        error={shownError}
        stale={stale}
        onRun={onRun}
        onOpenTable={onOpenTable}
      />
    </section>
  )
}

/**
 * «+ Замечание ученику» — поле `note` строки таблицы: его ученик видит под
 * заданием после вердикта (`ReviewTaskList`, §209 — старое поле показывается
 * по-прежнему). Раскрывается по нажатию; уже написанное видно сразу.
 * Сохраняется на уходе из поля — тем же `patchRow`, что и вердикт.
 * Рамку с замечанием рисуют прямо на фото (подсказка над фото) — это второй,
 * прежний путь (§209), он не тронут.
 */
function StudentRemark({
  row, editable, onSave, onShowReference,
}: {
  row: ReviewTaskRow
  editable: boolean
  onSave: (note: string | null) => Promise<boolean> | void
  onShowReference?: () => void
}) {
  const saved = String(row.note ?? '')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(saved)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { if (!open) setDraft(saved) }, [open, saved])
  useEffect(() => { if (open) areaRef.current?.focus() }, [open])

  function commit() {
    setOpen(false)
    const next = draft.trim()
    if (next !== saved.trim()) void onSave(next || null)
  }

  const hasNote = saved.trim().length > 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        {editable && !open && (
          <button
            type="button"
            data-testid="review-focus-remark-toggle"
            onClick={() => setOpen(true)}
            className="font-bold text-primary-700 hover:text-primary-800"
          >
            {hasNote ? 'Править замечание' : '+ Замечание ученику'}
          </button>
        )}
        {(!editable || open) && <span />}
        {onShowReference && (
          <button
            type="button"
            data-testid="review-focus-show-reference"
            onClick={onShowReference}
            className="font-bold text-primary-700 hover:text-primary-800"
          >
            Решение в эталоне
          </button>
        )}
      </div>
      {open ? (
        <textarea
          ref={areaRef}
          data-testid="review-focus-remark"
          aria-label={`Замечание ученику к заданию ${row.no}`}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setDraft(saved)
              setOpen(false)
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commit() }
          }}
          placeholder="Что не так в этом задании — увидит ученик"
          rows={3}
          className="block min-h-[64px] w-full resize-y rounded-[10px] border border-graphite-200 bg-white px-2.5 py-2 text-sm text-graphite-900 focus:border-primary-500 focus:outline-none"
        />
      ) : hasNote && (
        <p
          data-testid="review-focus-remark-text"
          className="whitespace-pre-line break-words rounded-[10px] bg-graphite-50 px-2.5 py-2 text-[13px] leading-snug text-graphite-800"
        >
          <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.04em] text-graphite-500">Ученику:</span>
          {saved}
        </p>
      )}
    </div>
  )
}

/** Меню «…» у задания: редкие вердикты и редкие действия. */
function TaskMenu({
  no, verdict, editable, onVerdict, onStartNote, onRemove,
}: {
  no: string
  verdict: ReviewTaskVerdict
  editable: boolean
  onVerdict: (verdict: ReviewTaskVerdict) => void
  onStartNote?: () => void
  onRemove?: () => void
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (!editable) return null
  const item = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-graphite-900 hover:bg-graphite-50'
  return (
    <div ref={boxRef} className="relative" data-review-keys="off">
      <button
        type="button"
        data-testid="review-focus-task-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Ещё по заданию ${no}`}
        onClick={() => setOpen(value => !value)}
        className="rounded-md p-1 text-graphite-400 transition-colors hover:bg-graphite-100 hover:text-graphite-900"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="review-focus-task-menu-list"
          className="absolute right-0 top-full z-30 mt-1 grid w-52 rounded-xl border border-graphite-200 bg-white p-1.5 shadow-[0_10px_30px_rgba(18,35,74,.14)]"
        >
          {(['unsolved', 'unchecked'] as const).map(value => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={verdict === value}
              data-testid={`review-focus-verdict-${value}`}
              onClick={() => { setOpen(false); onVerdict(value) }}
              className={item}
            >
              {value === 'unsolved' ? 'Не решено' : 'Не сверено'}
              {verdict === value && <span className="ml-auto text-xs text-primary-700">✓</span>}
            </button>
          ))}
          {onStartNote && (
            <button type="button" role="menuitem" data-testid="review-focus-draw" onClick={() => { setOpen(false); onStartNote() }} className={item}>
              Обвести на фото
            </button>
          )}
          {onRemove && (
            <button type="button" role="menuitem" data-testid="review-focus-remove" onClick={() => { setOpen(false); onRemove() }} className={cn(item, 'text-verdict-bad-ink hover:bg-verdict-bad-tint')}>
              Убрать задание
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Сохранение строки — точкой, без слов: слово «Сохранено» тут было бы шумом. */
function SaveDot({ state }: { state: ReviewTasksSaveState }) {
  if (state === 'idle' || state === 'saved') return null
  if (state === 'saving') {
    return <Loader2 data-testid="review-tasks-save-state" aria-label="Сохраняю" size={12} className="animate-spin text-graphite-400" />
  }
  return (
    <span data-testid="review-tasks-save-state" title="Не сохранено" className="inline-flex items-center text-verdict-bad-ink">
      <AlertTriangle size={12} aria-label="Не сохранено" />
    </span>
  )
}

/** Состояние ИИ-проверки одной тихой строкой под заданием — только когда есть что сказать. */
function AiStatus({
  running, error, stale, onRun, onOpenTable,
}: {
  running: boolean
  error: string | null
  stale: boolean
  onRun?: () => void
  onOpenTable?: () => void
}) {
  if (!running && !error && !stale) return null
  return (
    <div data-testid="review-focus-ai-status" className="space-y-1 border-t border-graphite-200 pt-2.5 text-xs text-graphite-500">
      {running && (
        <p className="flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          ИИ проверяет работу — это занимает до минуты.
        </p>
      )}
      {error && (
        <p className="flex flex-wrap items-center gap-1.5 text-verdict-bad-ink">
          <AlertTriangle size={12} className="shrink-0" />
          {error}
          {onRun && !running && (
            <button type="button" onClick={onRun} className="font-bold text-primary-700 hover:underline">Проверить заново</button>
          )}
        </p>
      )}
      {stale && (
        <p>
          Есть более свежая проверка ИИ.{' '}
          {onOpenTable && (
            <button type="button" data-testid="review-focus-stale-open" onClick={onOpenTable} className="font-bold text-primary-700 hover:underline">
              Открыть таблицу
            </button>
          )}
        </p>
      )}
    </div>
  )
}

/** Таблицы заданий ещё нет: черновик ИИ идёт, не удался или его не было. */
function EmptyPanel({
  running, error, canSeed, hasJob, onRun, onSeed, onAdd,
}: {
  running: boolean
  error: string | null
  canSeed: boolean
  hasJob: boolean
  onRun?: () => void
  onSeed?: () => Promise<boolean> | void
  onAdd?: () => Promise<boolean> | void
}) {
  const button = 'inline-flex items-center gap-1.5 rounded-[10px] border border-graphite-200 bg-white px-3 py-2 text-[13px] font-bold text-graphite-900 transition-colors hover:border-primary-400 hover:text-primary-700 disabled:opacity-50'
  return (
    <section data-testid="review-focus-empty" aria-label="Задания" className="space-y-3">
      <p className="text-sm font-bold text-graphite-900">Заданий пока нет</p>
      <p className="text-[13px] leading-snug text-graphite-500">
        {running
          ? 'ИИ читает работу и составляет таблицу по заданиям — это до минуты.'
          : error
            ? error
            : hasJob
              ? 'У черновика ИИ нет таблицы по заданиям. Её можно набрать руками — вердикт всё равно ставите вы.'
              : 'Черновика ИИ по этой работе нет. Проверьте с ИИ или добавьте задания руками — вердикт ставите вы.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {canSeed && onSeed && (
          <button type="button" data-testid="review-tasks-seed" onClick={() => void onSeed()} className={button}>
            <Sparkles size={14} />
            Взять таблицу ИИ
          </button>
        )}
        {onRun && (
          <button type="button" data-testid="ai-check-run" onClick={onRun} disabled={running} className={button}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {running ? 'Проверяю…' : hasJob ? 'Проверить заново' : 'Проверить с ИИ'}
          </button>
        )}
        {onAdd && (
          <button type="button" data-testid="review-tasks-add" onClick={() => void onAdd()} className={button}>
            <Plus size={14} />
            Задание
          </button>
        )}
      </div>
    </section>
  )
}
