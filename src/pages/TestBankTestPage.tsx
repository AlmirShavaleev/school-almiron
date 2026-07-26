import { AlertCircle, ArrowLeft, Loader2, Trash2 } from 'lucide-react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useBankTest, useTestResults } from '@/hooks/useTopicTest'
import { Button } from '@/components/ui/Button'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { totalMaxPoints, formatScore, scorePercent } from '@/lib/topicTest'
import { cn } from '@/utils/cn'
import { CatalogTaskBrowser } from '@/components/courseProgram/CatalogTaskBrowser'

/**
 * Страница теста в банке: редактирование заданий и просмотр результатов.
 */
export function TestBankTestPage() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()

  const { test, items, hasAttempts, loading, error, updateTest, addItem, removeItem } = useBankTest(testId ?? null)
  const { results, loading: resultsLoading, error: resultsError } = useTestResults(testId ?? null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [activeTab, setActiveTab] = useState<'items' | 'results'>('items')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setTitle(test?.title ?? '')
    setDescription(test?.description ?? '')
  }, [test?.id, test?.title, test?.description])

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setLocalError(null)
    try {
      await fn()
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загрузка теста…
      </div>
    )
  }

  if (!test) {
    return (
      <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        Тест не найден
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <Link
        to="/tests"
        className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 mb-2"
      >
        <ArrowLeft size={16} />
        Банк тестов
      </Link>

      {/* Errors */}
      {(error || localError || resultsError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{localError || error || resultsError}</span>
        </div>
      )}

      {/* Title & Description */}
      <div className="space-y-3">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() !== test.title) {
              void run(() => updateTest({ title: title.trim() }))
            }
          }}
          placeholder="Название теста"
          disabled={busy}
          className="w-full text-2xl font-bold text-gray-900 border-0 border-b-2 border-transparent focus:outline-none focus:border-primary-400 disabled:opacity-50"
        />

        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={() => {
            if (description.trim() !== (test.description ?? '')) {
              void run(() => updateTest({ description: description.trim() || null }))
            }
          }}
          placeholder="Описание теста (опционально)"
          disabled={busy}
          className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50 resize-none"
          rows={2}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('items')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'items'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          )}
        >
          Задания
        </button>
        <button
          onClick={() => setActiveTab('results')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            activeTab === 'results'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          )}
        >
          Результаты
        </button>
      </div>

      {/* Tab: Items */}
      {activeTab === 'items' && (
        <div className="space-y-3">
          {/* Frozen warning */}
          {hasAttempts && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>По тесту уже есть попытки — состав заданий заморожен</span>
            </div>
          )}

          {/* Items list */}
          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
            {items.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-4">Заданий ещё нет</p>
            ) : (
              items.map((item, idx) => (
                <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-gray-500">
                        {idx + 1}.
                      </span>
                      {item.exam_part && (
                        <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                          Часть {item.exam_part}
                        </span>
                      )}
                      <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                        {item.max_points} б.
                      </span>
                      {item.partial_type && (
                        <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                          Частичный балл
                        </span>
                      )}
                    </div>
                    {!hasAttempts && (
                      <button
                        onClick={() => {
                          if (window.confirm('Удалить задание?')) {
                            void run(() => removeItem(item.id))
                          }
                        }}
                        disabled={busy}
                        className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-1 disabled:opacity-50"
                        title="Удалить задание"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <TaskContentRenderer
                    html={resolveTaskHtml(item.statement_html, item.assets)}
                    className="text-xs"
                  />

                  <details className="text-xs text-gray-600">
                    <summary className="cursor-pointer font-medium">
                      Эталон ответа: <span className="font-normal">{item.answer_text || '(пусто)'}</span>
                    </summary>
                  </details>
                </div>
              ))
            )}
          </div>

          {/* Total points */}
          <div className="text-xs text-gray-500">
            Всего: <span className="font-semibold text-gray-700">{totalMaxPoints(items)} б.</span> · <span className="font-semibold text-gray-700">{items.length} заданий</span>
          </div>

          {/* Catalog browser or frozen message */}
          {hasAttempts ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>По тесту уже есть попытки — добавлять новые задания нельзя</span>
            </div>
          ) : (
            <div className="border-t border-gray-200 pt-3 mt-3">
              <CatalogTaskBrowser
                onAdd={taskId => run(() => addItem(taskId))}
                addedTaskIds={new Set(items.map(i => i.task_id).filter((id): id is string => id !== null))}
              />
            </div>
          )}
        </div>
      )}

      {/* Tab: Results */}
      {activeTab === 'results' && (
        <div className="space-y-3">
          {resultsLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" />
              Загрузка результатов…
            </div>
          ) : results.length === 0 ? (
            <div className="rounded-lg bg-gray-50 px-4 py-6 text-center">
              <p className="text-sm text-gray-600">
                Тест ещё никому не прикреплён или попыток нет
              </p>
            </div>
          ) : (
            results.map(result => (
              <div key={result.assignment.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                {/* Assignment header */}
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-900">
                    {result.courseTitle} → {result.topicTitle}
                  </h3>
                </div>

                {/* Results table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Ученик</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Балл</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Статус</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-700">Дата</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {result.attempts.map(attempt => {
                        const percent = scorePercent(attempt.total_points, attempt.max_points)
                        const statusColor = attempt.status === 'completed'
                          ? percent !== null && percent >= 70
                            ? 'text-green-700'
                            : percent !== null && percent >= 40
                            ? 'text-amber-700'
                            : 'text-red-700'
                          : 'text-gray-600'
                        return (
                          <tr key={attempt.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900">{attempt.studentName}</td>
                            <td className="px-4 py-3 text-gray-900">
                              <span className="font-medium">{formatScore(attempt.total_points, attempt.max_points)}</span>
                              {percent !== null && (
                                <span className={`ml-1 text-xs font-semibold ${statusColor}`}>
                                  {percent}%
                                </span>
                              )}
                            </td>
                            <td className={cn('px-4 py-3 text-xs font-medium', statusColor)}>
                              {attempt.status === 'completed' ? 'Завершён' : 'В процессе'}
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              {attempt.completed_at
                                ? new Date(attempt.completed_at).toLocaleDateString('ru-RU')
                                : attempt.started_at
                                ? new Date(attempt.started_at).toLocaleDateString('ru-RU')
                                : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
