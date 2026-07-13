import { useState, useEffect, useCallback } from 'react'
import type { VariantItem } from '@/hooks/useVariantAttempt'
import { resolveTaskHtml } from '@/components/catalog/CatalogTaskContent'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'

function getSelfCheckItems(items: VariantItem[]) {
  return items.filter(item => item.exam_part !== 1)
}

function clampScoreToItemLimit(item: VariantItem, value: number): number {
  const nonNegative = Math.max(0, value)
  if (item.max_points === null || item.max_points === undefined) return nonNegative
  return Math.min(nonNegative, item.max_points)
}

function getTotalSelfCheckCap(items: VariantItem[]): number | null {
  const selfCheckItems = getSelfCheckItems(items)
  if (!selfCheckItems.length) return 0
  if (selfCheckItems.some(item => item.max_points === null || item.max_points === undefined)) return null
  return selfCheckItems.reduce((sum, item) => sum + (item.max_points ?? 0), 0)
}

function sanitizeScores(
  rawScores: Record<string, number>,
  items: VariantItem[],
  changedItemId?: string,
): Record<string, number> {
  const selfCheckItems = getSelfCheckItems(items)
  if (!selfCheckItems.length) return {}

  const itemById = new Map(selfCheckItems.map(item => [item.item_id, item]))
  const next: Record<string, number> = {}

  for (const [itemId, rawValue] of Object.entries(rawScores)) {
    const item = itemById.get(itemId)
    if (!item || rawValue === null || Number.isNaN(rawValue)) continue
    next[itemId] = clampScoreToItemLimit(item, rawValue)
  }

  const totalCap = getTotalSelfCheckCap(selfCheckItems)
  if (totalCap === null) return next

  const total = Object.values(next).reduce((sum, value) => sum + value, 0)
  const overflow = total - totalCap
  if (overflow <= 0) return next

  const fallbackItemId = changedItemId && next[changedItemId] !== undefined
    ? changedItemId
    : Object.keys(next).at(-1)
  if (!fallbackItemId) return next

  next[fallbackItemId] = Math.max(0, next[fallbackItemId] - overflow)
  if (next[fallbackItemId] === 0) delete next[fallbackItemId]
  return next
}

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

export function useSelfCheckScores(assignmentId: string, items: VariantItem[] = []) {
  const [scores, setScores] = useState<Record<string, number>>(() => sanitizeScores(loadScores(assignmentId), items))

  useEffect(() => {
    setScores(sanitizeScores(loadScores(assignmentId), items))
  }, [assignmentId, items])

  const setScore = useCallback((itemId: string, value: number | null) => {
    setScores(prev => {
      const next = { ...prev }
      if (value === null || isNaN(value)) delete next[itemId]
      else next[itemId] = value
      const sanitized = sanitizeScores(next, items, itemId)
      saveScores(assignmentId, sanitized)
      return sanitized
    })
  }, [assignmentId, items])

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
  const hasReveal = !!(item.solution_html || item.solution_plan_html || item.grade_criteria_html)
  const maxPoints = item.max_points ?? null

  return (
    <div data-testid={`self-check-item-${item.item_id}`} className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
          Самопроверка
        </span>
      </div>

      {studentAnswer && (
        <p className="mt-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 inline-block">
          Ваш ответ: <span className="font-medium">{studentAnswer}</span>
        </p>
      )}

      {hasReveal && (
        <div className="mt-3 space-y-4">
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
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-start justify-between gap-4 flex-col md:flex-row md:items-start">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-1">Критерии оценки</div>
                {item.grade_criteria_html ? (
                  <TaskContentRenderer html={resolveTaskHtml(item.grade_criteria_html, item.assets ?? [])} />
                ) : (
                  <p className="text-sm text-gray-600">Критерии для этой задачи пока не добавлены.</p>
                )}
              </div>
              <div className="w-full md:w-48 shrink-0 rounded-lg border border-white/80 bg-white/90 p-3">
                <label className="text-sm font-medium text-gray-700 block mb-2">Баллы себе</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={maxPoints ?? undefined}
                    data-testid={`self-check-score-${item.item_id}`}
                    value={score ?? ''}
                    onChange={e => {
                      const raw = e.target.value
                      if (raw === '') {
                        onScoreChange(null)
                        return
                      }

                      const parsed = Number(raw)
                      if (Number.isNaN(parsed)) {
                        onScoreChange(null)
                        return
                      }

                      onScoreChange(clampScoreToItemLimit(item, parsed))
                    }}
                    placeholder="0"
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                  <span className="text-xs text-gray-500">
                    {maxPoints !== null ? `из ${maxPoints}` : 'без лимита'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {maxPoints !== null ? `Допустимо: 0-${maxPoints}` : 'Баллы не сохраняются на сервере'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      {maxPoints === null && (
        <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Максимум для этой задачи не определён.
        </p>
      )}
    </div>
  )
}

/** Summary strip showing the sum of locally self-assessed scores across all
 * part-2/unmarked items in the variant, entirely client-side. */
export function SelfCheckSummary({ items, scores }: { items: VariantItem[]; scores: Record<string, number> }) {
  const selfCheckItems = getSelfCheckItems(items)
  if (selfCheckItems.length === 0) return null
  const total = selfCheckItems.reduce((sum, i) => sum + (scores[i.item_id] ?? 0), 0)
  const totalCap = getTotalSelfCheckCap(selfCheckItems)

  return (
    <div data-testid="self-check-summary" className="mt-6 bg-amber-50 rounded-xl border border-amber-200 p-4">
      <h3 className="font-semibold text-amber-800 mb-1">Самопроверка (часть 2)</h3>
      <p className="text-sm text-amber-700">
        Ваша самооценка: <span className="font-bold">{total}</span>
        {totalCap !== null ? <> / <span className="font-bold">{totalCap}</span></> : null}
        {' '}— этот балл нигде не сохраняется
        и не влияет на статистику.
      </p>
      {totalCap === null && (
        <p className="text-xs text-amber-800 mt-2">
          Общий максимум части 2 пока определён не для всех задач, поэтому суммарный предел не зафиксирован.
        </p>
      )}
    </div>
  )
}
