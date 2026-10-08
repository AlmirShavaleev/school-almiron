import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle2, Circle } from 'lucide-react'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { useImageReclassify } from '@/hooks/useImageReclassify'
import { TaskContentRenderer } from './TaskContentRenderer'
import { TaskAnswerCheck } from './TaskAnswerCheck'
import type { CatalogTask, CatalogTaskAsset } from '@/hooks/useCatalog'
import type { CheckOutcome } from '@/hooks/useCatalogPractice'
import type { TaskPracticeState } from '@/lib/catalogRewards'
import type { PhysicsDifficulty } from '@/lib/physicsDifficulty'
import { applyTaskTexts, fetchCatalogTaskTexts, revealCatalogTaskTexts, type CatalogTaskTexts } from '@/lib/catalogTaskTexts'
import { isCatalogMarkdown } from '@/lib/catalogMarkdown'
import { digitsOrderNote, examTaskLabel, taskCodeLabel, toleranceLine, withRealMinus } from '@/lib/catalogAnswerSpec'
import { useStaffAnswerSpec } from '@/hooks/useStaffAnswerSpec'
import { useAuthStore } from '@/store/authStore'

/**
 * §256. Режим ученика: поле ответа + «Проверить» у проверяемых задач, а
 * кнопки ответа и решения сначала отмечают раскрытие в базе —
 * после этого задача в прогноз и баллы не идёт. Без `practice` (персонал,
 * подборки, корзина, функция базы ещё не применена) карточка как прежде.
 *
 * §262. Тексты ответа, решения, плана и критериев приходят с сервера по
 * правилу (`task.answers_locked` — пока не положено, поля пустые). Закрытую
 * задачу любая из четырёх кнопок открывает так: есть `practice` и задача ещё
 * не решена и не открыта — `practice.onReveal` (раскрытие + тексты); по
 * состоянию страницы уже положено (решена, открыта, без проверки), а данные
 * задачи устарели — просто тексты, без отметки; состояния нет (корзина,
 * подборка, задача за пределами первых 300) — раскрытие `catalog_reveal_answers`.
 * Персоналу задачи не закрываются — карточка как прежде.
 *
 * §269. Задача переписанного каталога (Markdown + LaTeX, метка `<!--md-->`):
 * в шапке «№ N» (место в списке), «Задание K ЕГЭ» (номер в экзамене, если
 * страница его знает) и код задачи «#96090»; под ответом персоналу — допуск
 * «засчитываем от X до Y» (ученику допуск не показывается). Ответ-число — с «−».
 */
const STAFF_ROLES = new Set(['teacher', 'curator', 'admin', 'owner'])

export interface TaskPracticeProps {
  state: TaskPracticeState | undefined
  onCheck: (answer: string) => Promise<CheckOutcome>
  onReveal: () => Promise<CatalogTaskTexts | null>
}

export interface TaskDisplayCardProps {
  task: CatalogTask & { assets?: CatalogTaskAsset[] }
  /** 1-based position number shown in the card header. Hidden if undefined. */
  number?: number
  /** When provided, renders a completion toggle button. */
  onToggle?: () => void
  /** Extra action buttons rendered in the footer row (e.g. AddToCartButton). */
  extraActions?: React.ReactNode
  /** Visual accent for completed tasks */
  completed?: boolean
  /** Which sections to show by default (all hidden by default) */
  defaultOpen?: {
    answer?:    boolean
    solution?:  boolean
    plan?:      boolean
    criteria?:  boolean
  }
  /** Force-open overrides (controlled from parent, e.g. collection tabs) */
  forceOpen?: {
    answer?:    boolean
    solution?:  boolean
    plan?:      boolean
    criteria?:  boolean
  }
  /** §256: проверка ответа учеником (см. TaskPracticeProps). */
  practice?: TaskPracticeProps
  /** §269: номер задания в экзамене (раздел каталога) — для «Задание N ЕГЭ». */
  examNumber?: number | null
}

export function TaskDisplayCard({
  task,
  number,
  onToggle,
  extraActions,
  completed = false,
  defaultOpen = {},
  forceOpen,
  practice,
  examNumber,
}: TaskDisplayCardProps) {
  const [showAnswer,        setShowAnswer]        = useState(defaultOpen.answer    ?? false)
  const [showSolution,      setShowSolution]      = useState(defaultOpen.solution  ?? false)
  const [showPlan,          setShowPlan]          = useState(defaultOpen.plan      ?? false)
  const [showGradeCriteria, setShowGradeCriteria] = useState(defaultOpen.criteria  ?? false)

  const cardRef = useRef<HTMLDivElement>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  // §262: тексты, полученные раскрытием в этой карточке (данные задачи — без них).
  const [opened, setOpened] = useState<CatalogTaskTexts | null>(null)
  const view = opened && opened.task_id === task.id ? applyTaskTexts(task, opened) : task
  const locked = view.answers_locked === true

  // §256. Проверяемая задача ученика: ответ и решение открываются через
  // раскрытие (пока задача не решена и ответ ещё не открыт).
  const pState = practice?.state
  const checkable = pState?.checkable === true
  const needsReveal = checkable && !pState?.solved && !pState?.revealed
  const practiceAllows = !!pState && (!pState.checkable || pState.solved || pState.revealed)
  async function openGated(open: () => void) {
    if (!(needsReveal && practice) && !locked) { open(); return }
    setRevealError(null)
    try {
      let texts: CatalogTaskTexts | null | undefined
      if (needsReveal && practice) texts = await practice.onReveal()
      else if (practiceAllows) texts = (await fetchCatalogTaskTexts([task.id])).get(task.id)
      else texts = (await revealCatalogTaskTexts([task.id])).get(task.id)
      if (texts) setOpened(texts)
      open()
    } catch {
      setRevealError('Не удалось открыть ответ — попробуйте ещё раз')
    }
  }
  const toggleAnswer = () => (showAnswer ? setShowAnswer(false) : void openGated(() => setShowAnswer(true)))
  const toggleSolution = () => (showSolution ? setShowSolution(false) : void openGated(() => setShowSolution(true)))
  const togglePlan = () => (showPlan ? setShowPlan(false) : void openGated(() => setShowPlan(true)))
  const toggleCriteria = () => (showGradeCriteria ? setShowGradeCriteria(false) : void openGated(() => setShowGradeCriteria(true)))

  // Re-runs when task or any section visibility changes
  useImageReclassify(cardRef, [
    task.id,
    showAnswer   || (forceOpen?.answer    ?? false),
    showSolution || (forceOpen?.solution  ?? false),
    showPlan     || (forceOpen?.plan      ?? false),
    showGradeCriteria || (forceOpen?.criteria ?? false),
  ])

  // Math ЕГЭ/ОГЭ only: real figures in statement/solution rendered smaller (see index.css .scale-figures-math-exam)
  const isMathExam = task.subject === 'Математика' && (task.exam_type === 'ЕГЭ' || task.exam_type === 'ОГЭ')
  const figureScaleClass = isMathExam ? 'scale-figures-math-exam' : ''

  // Resolve asset URLs once per task (memo-like — new object only when task changes)
  const stmt    = resolveTaskHtml(task.statement_html,      task.assets)
  const ans     = resolveTaskHtml(withRealMinus(view.answer_html), task.assets)
  const sol     = resolveTaskHtml(view.solution_html,       task.assets)
  const plan    = resolveTaskHtml(view.solution_plan_html,  task.assets)
  const crit    = resolveTaskHtml(view.grade_criteria_html, task.assets)
  const hasPlan     = !!view.solution_plan_html  || view.has_plan === true
  const hasCriteria = !!view.grade_criteria_html || view.has_criteria === true

  const ansOpen  = forceOpen?.answer    ?? showAnswer
  const solOpen  = forceOpen?.solution  ?? showSolution
  const planOpen = forceOpen?.plan      ?? showPlan
  const critOpen = forceOpen?.criteria  ?? showGradeCriteria
  const difficultyBadge = getDifficultyBadge(task.difficulty)

  // §269: шапка задачи переписанного каталога и допуск ответа для персонала.
  const isMd = isCatalogMarkdown(task.statement_html)
  const role = useAuthStore(st => st.profile?.role ?? null)
  const isStaff = !!role && STAFF_ROLES.has(role)
  const staffSpec = useStaffAnswerSpec(task.id, isMd && isStaff && ansOpen && !!ans)
  const staffNotes = [toleranceLine(staffSpec), digitsOrderNote(staffSpec)].filter((x): x is string => !!x)
  const codeLabel = isMd ? taskCodeLabel(task.external_id) : null
  const examLabel = isMd ? examTaskLabel(examNumber, task.exam_type) : null

  return (
    <div
      ref={cardRef}
      data-task-id={task.id}
      className={`relative bg-white rounded-xl border transition-all ${
        completed ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
      }`}
    >
      {/* Statement. Бейдж сложности — обычный элемент строки, а не absolute в
          углу: раньше он ложился ровно на кружок «выполнено» и закрывал его
          (§154, вопрос владельца «где отмечать»). */}
      {isMd && (number !== undefined || examLabel || codeLabel) && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs" data-testid="task-md-header">
          {number !== undefined && (
            <span className="font-bold text-gray-700" data-testid="task-md-number">№ {number}</span>
          )}
          {examLabel && <span className="text-gray-500" data-testid="task-exam-label">{examLabel}</span>}
          {codeLabel && (
            <span
              className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 font-mono text-gray-500"
              title="Код задачи в каталоге"
              data-testid="task-code"
            >
              {codeLabel}
            </span>
          )}
        </div>
      )}
      <div className={`flex items-start gap-3 p-4${isMd ? ' pt-2' : ''}`}>
        {number !== undefined && !isMd && (
          <span className="text-xs font-mono text-gray-400 mt-0.5 w-6 flex-shrink-0">
            #{number}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <TaskContentRenderer html={stmt} className={figureScaleClass} />
        </div>
        {difficultyBadge && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${difficultyBadge.className}`}
            data-testid="task-difficulty-badge"
          >
            {difficultyBadge.label}
          </span>
        )}
      </div>

      {checkable && practice && (
        <TaskAnswerCheck taskId={task.id} state={practice.state} onCheck={practice.onCheck} />
      )}

      {/* Action row. Отметка «выполнено» — первая кнопка с подписью, а не
          безымянный кружок в углу: на телефоне кружок не читался как действие. */}
      <div className="px-4 pb-4 flex gap-2 flex-wrap items-center">
        {onToggle && (
          <button
            onClick={onToggle}
            aria-pressed={completed}
            title={completed ? 'Отменить отметку' : practice ? 'Отметить для себя — в прогноз и баллы не идёт' : 'Отметить выполненной'}
            data-testid="task-complete-toggle"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              completed
                ? 'bg-green-50 text-green-700 hover:bg-green-100'
                : 'bg-gray-50 text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
            }`}
          >
            {completed
              ? <CheckCircle2 className="w-4 h-4 text-green-500" />
              : <Circle       className="w-4 h-4 text-gray-400" />
            }
            {completed ? 'Выполнено' : 'Отметить выполненной'}
          </button>
        )}
        {extraActions}

        {/* Answer toggle (only when not force-controlled) */}
        {forceOpen?.answer === undefined && (
          task.has_answer ? (
            <button
              onClick={toggleAnswer}
              data-testid="task-show-answer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
            >
              {ansOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {ansOpen ? 'Скрыть ответ' : 'Показать ответ'}
            </button>
          ) : (
            <span className="text-xs text-gray-400 italic px-1" data-testid="no-answer-placeholder">
              Ответ пока недоступен
            </span>
          )
        )}

        {/* Solution toggle */}
        {forceOpen?.solution === undefined && task.has_solution && (
          <button
            onClick={toggleSolution}
            data-testid="task-show-solution"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors"
          >
            {solOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {solOpen ? 'Скрыть решение' : 'Показать решение'}
          </button>
        )}

        {/* Plan toggle */}
        {forceOpen?.plan === undefined && hasPlan && (
          <button
            onClick={togglePlan}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
          >
            {planOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {planOpen ? 'Скрыть план' : 'План решения'}
          </button>
        )}

        {/* Grade criteria toggle */}
        {forceOpen?.criteria === undefined && hasCriteria && (
          <button
            onClick={toggleCriteria}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100 transition-colors"
          >
            {critOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {critOpen ? 'Скрыть критерии' : 'Критерии оценки'}
          </button>
        )}
      </div>

      {revealError && <p role="alert" className="px-4 pb-3 text-sm font-semibold text-verdict-bad-ink">{revealError}</p>}

      {/* Answer */}
      {ansOpen && ans && (
        <Section color="blue" label="Ответ">
          <TaskContentRenderer html={ans} />
          {staffNotes.length > 0 && (
            <p className="mt-1 text-xs text-gray-500" data-testid="task-answer-tolerance">
              {staffNotes.join(' · ')}
            </p>
          )}
        </Section>
      )}

      {/* No-answer placeholder for force-open mode */}
      {forceOpen?.answer && !task.has_answer && (
        <Section color="blue" label="Ответ">
          <span className="text-sm text-gray-400 italic">Ответ пока недоступен</span>
        </Section>
      )}

      {/* Solution */}
      {solOpen && sol && (
        <Section color="purple" label="Решение">
          <TaskContentRenderer html={sol} className={figureScaleClass} />
        </Section>
      )}

      {forceOpen?.solution && !task.has_solution && (
        <Section color="purple" label="Решение">
          <span className="text-sm text-gray-400 italic">Решение пока недоступно</span>
        </Section>
      )}

      {/* Plan */}
      {planOpen && plan && (
        <Section color="amber" label="План решения">
          <TaskContentRenderer html={plan} />
        </Section>
      )}

      {/* Criteria */}
      {critOpen && crit && (
        <Section color="teal" label="Критерии оценки">
          <TaskContentRenderer html={crit} />
        </Section>
      )}
    </div>
  )
}

function getDifficultyBadge(difficulty: string | null | undefined): { label: PhysicsDifficulty; className: string } | null {
  if (difficulty === 'лёгкая') {
    return { label: difficulty, className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
  }
  if (difficulty === 'средняя') {
    return { label: difficulty, className: 'bg-amber-50 text-amber-700 ring-amber-200' }
  }
  if (difficulty === 'сложная') {
    return { label: difficulty, className: 'bg-rose-50 text-rose-700 ring-rose-200' }
  }
  return null
}

// ── Section divider ───────────────────────────────────────────────────────────

type SectionColor = 'blue' | 'purple' | 'amber' | 'teal'

const SECTION_STYLES: Record<SectionColor, { border: string; label: string }> = {
  blue:   { border: 'border-blue-100',   label: 'text-blue-600'   },
  purple: { border: 'border-purple-100', label: 'text-purple-600' },
  amber:  { border: 'border-amber-100',  label: 'text-amber-600'  },
  teal:   { border: 'border-teal-100',   label: 'text-teal-600'   },
}

function Section({
  color,
  label,
  children,
}: {
  color:    SectionColor
  label:    string
  children: React.ReactNode
}) {
  const s = SECTION_STYLES[color]
  return (
    <div className={`border-t ${s.border} mx-4 mb-4 pt-3`}>
      <div className={`text-xs font-semibold ${s.label} uppercase tracking-wide mb-2`}>
        {label}
      </div>
      {children}
    </div>
  )
}
