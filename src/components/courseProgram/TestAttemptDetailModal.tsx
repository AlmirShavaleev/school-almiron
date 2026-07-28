import { useEffect, useState } from 'react'
import { X, Loader2, AlertCircle, CheckCircle, XCircle, MinusCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatScore, scorePercent, sortItems, type StudentTestItem, type TopicTestAnswerRow } from '@/lib/topicTest'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { cn } from '@/utils/cn'

/**
 * Разбор одной завершённой попытки теста глазами преподавателя: условие,
 * ответ ученика, эталон, решение — по каждому заданию. Тот же RPC и та же
 * разметка разбора, что и в TopicTestStudent (там ученик видит СВОИ
 * эталоны только после завершения своей попытки; преподавателю
 * topic_test_assignment_items всегда отдаёт всё — v_done=true для персонала
 * банка, см. supabase/migrations/20260726142040_topic_test_bank.sql).
 */
export function TestAttemptDetailModal({
  assignmentId,
  attemptId,
  studentName,
  testTitle,
  totalPoints,
  maxPoints,
  onClose,
}: {
  assignmentId: string
  attemptId: string
  studentName: string
  testTitle: string
  totalPoints: number | null
  maxPoints: number | null
  onClose: () => void
}) {
  const [items, setItems] = useState<StudentTestItem[]>([])
  const [answers, setAnswers] = useState<TopicTestAnswerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [itemsRes, answersRes] = await Promise.all([
          supabase.rpc('topic_test_assignment_items', { p_assignment_id: assignmentId }),
          supabase.from('topic_test_answers').select('*').eq('attempt_id', attemptId),
        ])

        if (itemsRes.error) throw new Error(itemsRes.error.message)
        if (answersRes.error) throw new Error(answersRes.error.message)

        if (!cancelled) {
          setItems(sortItems((itemsRes.data ?? []) as StudentTestItem[]))
          setAnswers((answersRes.data ?? []) as TopicTestAnswerRow[])
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Не удалось загрузить разбор теста')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [assignmentId, attemptId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const percent = scorePercent(totalPoints, maxPoints)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        data-testid="test-attempt-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Разбор теста «${testTitle}» — ${studentName}`}
        className="relative bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-2xl max-h-[92vh] flex flex-col z-10 overflow-hidden"
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 leading-tight truncate">{testTitle}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{studentName}</p>
          </div>
          {(totalPoints !== null && maxPoints !== null) && (
            <div className="text-right shrink-0 ml-3">
              <div className="text-lg font-bold text-gray-900">{formatScore(totalPoints, maxPoints)}</div>
              {percent !== null && (
                <div className={cn('text-xs font-semibold', {
                  'text-green-700': percent >= 70,
                  'text-amber-700': percent < 70 && percent >= 40,
                  'text-red-700': percent < 40,
                })}>
                  {percent}%
                </div>
              )}
            </div>
          )}
          <button
            data-testid="test-attempt-close"
            aria-label="Закрыть"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors ml-3 shrink-0 p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />
              Загрузка разбора…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex gap-2">
                <AlertCircle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && (
            <div className="space-y-4">
              {items.map((item, idx) => {
                const ans = answers.find(a => a.item_id === item.id)
                const isCorrect = ans?.is_correct ?? false
                const hasPartial = (ans?.awarded_points ?? 0) > 0 && !isCorrect

                return (
                  <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="font-semibold text-gray-900">Задание {idx + 1}</span>
                      {isCorrect && <CheckCircle size={18} className="text-green-600" />}
                      {!isCorrect && !hasPartial && <XCircle size={18} className="text-red-600" />}
                      {hasPartial && <MinusCircle size={18} className="text-amber-500" />}
                    </div>

                    {item.statement_html && (
                      <div className="mb-3 text-sm text-gray-700">
                        <TaskContentRenderer html={resolveTaskHtml(item.statement_html, item.assets)} />
                      </div>
                    )}

                    <div className="mb-2 rounded-lg bg-gray-50 p-2.5 text-sm">
                      <div className="text-xs font-medium text-gray-500 mb-1">Ответ ученика:</div>
                      <div className="text-gray-800">{ans?.answer_text || '—'}</div>
                    </div>

                    {ans && (
                      <div className="mb-2 text-xs font-medium text-gray-600">
                        {ans.awarded_points ?? 0}/{item.max_points ?? 0} баллов
                      </div>
                    )}

                    {item.answer_text && (
                      <div className="mb-3 rounded-lg bg-green-50 p-2.5 text-sm border border-green-200">
                        <div className="text-xs font-medium text-green-700 mb-1">Эталонный ответ:</div>
                        <div className="text-green-900">{item.answer_text}</div>
                      </div>
                    )}

                    {item.solution_html && (
                      <details className="mt-3 cursor-pointer">
                        <summary className="text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors">
                          Показать решение
                        </summary>
                        <div className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 border border-blue-200">
                          <TaskContentRenderer html={resolveTaskHtml(item.solution_html, item.assets)} />
                        </div>
                      </details>
                    )}
                  </div>
                )
              })}

              {items.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">В этом тесте нет заданий</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
