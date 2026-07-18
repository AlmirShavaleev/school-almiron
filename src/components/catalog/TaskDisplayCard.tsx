import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle2, Circle } from 'lucide-react'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { useImageReclassify } from '@/hooks/useImageReclassify'
import { TaskContentRenderer } from './TaskContentRenderer'
import type { CatalogTask, CatalogTaskAsset } from '@/hooks/useCatalog'
import type { PhysicsDifficulty } from '@/lib/physicsDifficulty'

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
}

export function TaskDisplayCard({
  task,
  number,
  onToggle,
  extraActions,
  completed = false,
  defaultOpen = {},
  forceOpen,
}: TaskDisplayCardProps) {
  const [showAnswer,        setShowAnswer]        = useState(defaultOpen.answer    ?? false)
  const [showSolution,      setShowSolution]      = useState(defaultOpen.solution  ?? false)
  const [showPlan,          setShowPlan]          = useState(defaultOpen.plan      ?? false)
  const [showGradeCriteria, setShowGradeCriteria] = useState(defaultOpen.criteria  ?? false)

  const cardRef = useRef<HTMLDivElement>(null)

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
  const ans     = resolveTaskHtml(task.answer_html,         task.assets)
  const sol     = resolveTaskHtml(task.solution_html,       task.assets)
  const plan    = resolveTaskHtml(task.solution_plan_html,  task.assets)
  const crit    = resolveTaskHtml(task.grade_criteria_html, task.assets)

  const ansOpen  = forceOpen?.answer    ?? showAnswer
  const solOpen  = forceOpen?.solution  ?? showSolution
  const planOpen = forceOpen?.plan      ?? showPlan
  const critOpen = forceOpen?.criteria  ?? showGradeCriteria
  const difficultyBadge = getDifficultyBadge(task.difficulty)

  return (
    <div
      ref={cardRef}
      className={`relative bg-white rounded-xl border transition-all ${
        completed ? 'border-green-200 bg-green-50/30' : 'border-gray-200'
      }`}
    >
      {difficultyBadge && (
        <span
          className={`absolute right-4 top-4 z-10 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${difficultyBadge.className}`}
          data-testid="task-difficulty-badge"
        >
          {difficultyBadge.label}
        </span>
      )}

      {/* Statement */}
      <div className="flex items-start gap-3 p-4">
        {number !== undefined && (
          <span className="text-xs font-mono text-gray-400 mt-0.5 w-6 flex-shrink-0">
            #{number}
          </span>
        )}
        <div className={`flex-1 min-w-0 ${difficultyBadge ? 'pr-20 sm:pr-24' : ''}`}>
          <TaskContentRenderer html={stmt} className={figureScaleClass} />
        </div>
        {onToggle && (
          <button
            onClick={onToggle}
            title={completed ? 'Отменить отметку' : 'Отметить выполненной'}
            className="flex-shrink-0 mt-0.5"
          >
            {completed
              ? <CheckCircle2 className="w-6 h-6 text-green-500 hover:text-green-600 transition-colors" />
              : <Circle       className="w-6 h-6 text-gray-300 hover:text-primary-500 transition-colors" />
            }
          </button>
        )}
      </div>

      {/* Action row */}
      <div className="px-4 pb-4 flex gap-2 flex-wrap items-center">
        {extraActions}

        {/* Answer toggle (only when not force-controlled) */}
        {forceOpen?.answer === undefined && (
          task.has_answer ? (
            <button
              onClick={() => setShowAnswer(v => !v)}
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
            onClick={() => setShowSolution(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors"
          >
            {solOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {solOpen ? 'Скрыть решение' : 'Показать решение'}
          </button>
        )}

        {/* Plan toggle */}
        {forceOpen?.plan === undefined && task.solution_plan_html && (
          <button
            onClick={() => setShowPlan(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 transition-colors"
          >
            {planOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {planOpen ? 'Скрыть план' : 'План решения'}
          </button>
        )}

        {/* Grade criteria toggle */}
        {forceOpen?.criteria === undefined && task.grade_criteria_html && (
          <button
            onClick={() => setShowGradeCriteria(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 text-sm font-medium hover:bg-teal-100 transition-colors"
          >
            {critOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {critOpen ? 'Скрыть критерии' : 'Критерии оценки'}
          </button>
        )}
      </div>

      {/* Answer */}
      {ansOpen && ans && (
        <Section color="blue" label="Ответ">
          <TaskContentRenderer html={ans} />
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
