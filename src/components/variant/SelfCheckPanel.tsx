import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { VariantItem } from '@/hooks/useVariantAttempt'
import { resolveTaskHtml } from '@/components/catalog/CatalogTaskContent'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'

/** Local-only (never persisted server-side) self-assessment score per item,
 * keyed by variant_item_id. Kept in sessionStorage so a page refresh doesn't
 * wipe it, but nothing here ever touches the network. */
function storageKey(assignmentId: string) {
  return `self-check:${assignmentId}`
}

function loadScores(assignmentId: string): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(storageKey(assignmentId))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveScores(assignmentId: string, scores: Record<string, number>) {
  try {
    sessionStorage.setItem(storageKey(assignmentId), JSON.stringify(scores))
  } catch {
    // sessionStorage unavailable (private mode, quota) — self-check just
    // won't survive a refresh; nothing to save on the server either way.
  }
}

export function useSelfCheckScores(assignmentId: string) {
  const [scores, setScores] = useState<Record<string, number>>(() => loadScores(assignmentId))

  useEffect(() => { setScores(loadScores(assignmentId)) }, [assignmentId])

  const setScore = useCallback((itemId: string, value: number | null) => {
    setScores(prev => {
      const next = { ...prev }
      if (value === null || isNaN(value)) delete next[itemId]
      else next[itemId] = value
      saveScores(assignmentId, next)
      return next
    })
  }, [assignmentId])

  return { scores, setScore }
}

interface SelfCheckItemProps {
  item: VariantItem
  studentAnswer: string
  score: number | null
  onScoreChange: (value: number | null) => void
}

/** Solution/criteria reveal + local score input for one part-2 (or
 * unmarked-part) item in a self-built variant. Renders nothing to the DB —
 * purely a study aid the student fills in for themselves. */
export function SelfCheckItem({ item, studentAnswer, score, onScoreChange }: SelfCheckItemProps) {
  const [expanded, setExpanded] = useState(false)
  const hasReveal = !!(item.solution_html || item.solution_plan_html || item.grade_criteria_html)

  return (
    <div data-testid={`self-check-item-${item.item_id}`} className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
          Самопроверка
        </span>
        {hasReveal && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? 'Скрыть решение и критерии' : 'Показать решение и критерии'}
          </button>
        )}
      </div>

      {studentAnswer && (
        <p className="mt-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 inline-block">
          Ваш ответ: <span className="font-medium">{studentAnswer}</span>
        </p>
      )}

      {expanded && (
        <div className="mt-2 space-y-3">
          {item.solution_html && (
            <div>
              <div className="text-xs font-semibold text-purple-600 uppercase tracking-wide mb-1">Решение</div>
              <TaskContentRenderer html={resolveTaskHtml(item.solution_html, item.assets ?? [])} />
            </div>
          )}
          {item.solution_plan_html && (
            <div>
              <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">План решения</div>
              <TaskContentRenderer html={resolveTaskHtml(item.solution_plan_html, item.assets ?? [])} />
            </div>
          )}
          {item.grade_criteria_html && (
            <div>
              <div className="text-xs font-semibold text-teal-600 uppercase tracking-wide mb-1">Критерии оценки</div>
              <TaskContentRenderer html={resolveTaskHtml(item.grade_criteria_html, item.assets ?? [])} />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <label className="text-sm text-gray-600">Оцените себя:</label>
        <input
          type="number"
          min={0}
          data-testid={`self-check-score-${item.item_id}`}
          value={score ?? ''}
          onChange={e => {
            const raw = e.target.value
            onScoreChange(raw === '' ? null : Number(raw))
          }}
          placeholder="0"
          className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
        <span className="text-xs text-gray-400">баллов — не сохраняется, только для вас</span>
      </div>
    </div>
  )
}

/** Summary strip showing the sum of locally self-assessed scores across all
 * part-2/unmarked items in the variant, entirely client-side. */
export function SelfCheckSummary({ items, scores }: { items: VariantItem[]; scores: Record<string, number> }) {
  const selfCheckItems = items.filter(i => i.exam_part !== 1)
  if (selfCheckItems.length === 0) return null
  const total = selfCheckItems.reduce((sum, i) => sum + (scores[i.item_id] ?? 0), 0)

  return (
    <div data-testid="self-check-summary" className="mt-6 bg-amber-50 rounded-xl border border-amber-200 p-4">
      <h3 className="font-semibold text-amber-800 mb-1">Самопроверка (часть 2)</h3>
      <p className="text-sm text-amber-700">
        Ваша самооценка: <span className="font-bold">{total}</span> — этот балл нигде не сохраняется
        и не влияет на статистику.
      </p>
    </div>
  )
}
