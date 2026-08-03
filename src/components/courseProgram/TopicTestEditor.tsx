import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { useTopicTestAssignment, useTestBank } from '@/hooks/useTopicTest'
import { TopicVariantAttach } from '@/components/courseProgram/TopicVariantAttach'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

/**
 * Привязка теста из банка к теме.
 *
 * Показывает текущую привязку (если есть) с ссылкой на редактирование в банке.
 * Если привязки нет, показывает список тестов из банка с фильтром по названию.
 *
 * Ниже — отдельный блок тестирований из раздела «Тесты» (§58). Это другая
 * система (test_variants против topic_tests), и раньше её здесь не было вовсе:
 * собранный в разделе тест в этом списке не находился, потому что искали
 * только по банку.
 */
export function TopicTestEditor({ topicId }: { topicId: string }) {
  const { assignment, hasAttempts, loading, error, attach, detach } = useTopicTestAssignment(topicId)
  const { tests, loading: testsLoading } = useTestBank()

  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')

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
      <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загрузка привязки…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {(error || localError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{localError || error}</span>
        </div>
      )}

      {assignment?.test ? (
        /* Assigned test card */
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-900 mb-1">
                {assignment.test.title}
              </div>
              {assignment.test.description && (
                <p className="text-xs text-gray-500 line-clamp-2">
                  {assignment.test.description}
                </p>
              )}
            </div>
            {hasAttempts && (
              <Badge variant="info" className="shrink-0">
                есть попытки
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to={`/tests/${assignment.test_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 px-3 py-1.5 text-xs text-primary-600 hover:border-primary-300 hover:bg-primary-50 transition-colors"
            >
              Открыть в банке →
            </Link>
            {!hasAttempts && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (window.confirm('Открепить тест? По нему ещё нет попыток.')) {
                    void run(() => detach())
                  }
                }}
                disabled={busy}
              >
                <Trash2 size={14} />
                Открепить
              </Button>
            )}
          </div>
        </div>
      ) : (
        /* No assignment: show test picker */
        <div className="rounded-2xl border border-dashed border-gray-200 p-4">
          <div className="mb-2 text-sm font-semibold text-gray-900">Тест по теме</div>
          <p className="mb-4 text-xs text-gray-500">
            Прикрепите тест из банка. Тесты могут быть созданы и отредактированы в конструкторе.
          </p>

          {/* Filter */}
          <input
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder="Поиск теста по названию…"
            className="w-full h-9 rounded-lg border border-gray-200 px-3 text-xs mb-3 focus:outline-none focus:ring-2 focus:ring-primary-400"
          />

          {testsLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" />
              Загрузка тестов…
            </div>
          ) : tests.length === 0 ? (
            <p className="text-xs text-gray-500 py-3 italic">Тестов в банке ещё нет</p>
          ) : (
            <div className="space-y-2 mb-3 max-h-64 overflow-y-auto">
              {tests
                .filter(t => t.title.toLowerCase().includes(filterText.toLowerCase()))
                .map(test => (
                  <div key={test.id} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="text-xs font-semibold text-gray-900 line-clamp-2 flex-1">
                        {test.title}
                      </h4>
                    </div>
                    <div className="text-[10px] text-gray-500 mb-2">
                      <span className="font-medium text-gray-700">{test.itemCount}</span> заданий
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void run(() => attach(test.id))}
                      loading={busy}
                      disabled={test.itemCount === 0}
                      title={test.itemCount === 0 ? 'В тесте нет заданий' : undefined}
                    >
                      Прикрепить
                    </Button>
                  </div>
                ))}

              {tests.filter(t => t.title.toLowerCase().includes(filterText.toLowerCase())).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-3">
                  Тесты не найдены
                </p>
              )}
            </div>
          )}

          <div className="text-center">
            <Link
              to="/tests"
              className="inline-text text-xs text-primary-600 hover:text-primary-700 hover:underline"
            >
              Создать новый тест в банке →
            </Link>
          </div>
        </div>
      )}

      {/* Тестирования из раздела «Тесты» — другая система, отдельный блок. */}
      <div className="pt-3 border-t border-gray-100">
        <TopicVariantAttach topicId={topicId} />
      </div>
    </div>
  )
}
