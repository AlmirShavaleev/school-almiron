import { AlertCircle, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useTestBank } from '@/hooks/useTopicTest'
import { Button } from '@/components/ui/Button'

/**
 * Банк тестов: список всех тестов с кнопкой создания.
 * Преподаватель видит тесты, может создавать новые и удалять.
 */
export function TestBankPage() {
  const navigate = useNavigate()
  const { tests, loading, error, createTest, deleteTest, refresh } = useTestBank()

  const [busy, setBusy] = useState(false)
  const [showCreateField, setShowCreateField] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleCreate() {
    setBusy(true)
    setLocalError(null)
    try {
      const title = newTitle.trim()
      if (!title) throw new Error('Название теста не может быть пустым')
      const testId = await createTest(title)
      navigate(`/tests/${testId}`)
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось создать тест')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(testId: string) {
    if (!window.confirm('Удалить тест? Это действие нельзя отменить.')) return
    setBusy(true)
    setLocalError(null)
    try {
      await deleteTest(testId)
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось удалить тест')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Банк тестов</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Тесты составляются из каталога и прикрепляются к темам курсов
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50"
        >
          <RefreshCw size={13} />
          Обновить
        </button>
      </div>

      {/* Errors */}
      {(error || localError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{localError || error}</span>
        </div>
      )}

      {/* Create button / inline field */}
      {!showCreateField ? (
        <Button onClick={() => setShowCreateField(true)} disabled={busy}>
          <Plus size={15} />
          Создать тест
        </Button>
      ) : (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') setShowCreateField(false)
            }}
            placeholder="Введите название теста…"
            className="flex-1 h-10 rounded-lg border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <Button onClick={handleCreate} loading={busy}>
            Создать
          </Button>
          <button
            onClick={() => {
              setShowCreateField(false)
              setNewTitle('')
              setLocalError(null)
            }}
            disabled={busy}
            className="h-10 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50"
          >
            Отменить
          </button>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 size={16} className="animate-spin" />
          Загрузка тестов…
        </div>
      ) : tests.length === 0 ? (
        /* Empty state */
        <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center">
          <div className="text-sm font-semibold text-gray-900 mb-1">Тестов ещё нет</div>
          <p className="text-xs text-gray-500 mb-3">
            Создайте первый тест и начните добавлять задания из каталога
          </p>
        </div>
      ) : (
        /* Test cards */
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {tests.map(test => (
            <div
              key={test.id}
              className="rounded-2xl border border-gray-200 bg-white p-4 hover:border-primary-300 hover:shadow-md transition-all cursor-pointer group"
              onClick={() => navigate(`/tests/${test.id}`)}
            >
              {/* Title */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-semibold text-sm text-gray-900 line-clamp-2 group-hover:text-primary-600 transition-colors">
                  {test.title}
                </h3>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    void handleDelete(test.id)
                  }}
                  disabled={busy}
                  className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-1 disabled:opacity-50"
                  title="Удалить тест"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Description */}
              {test.description && (
                <p className="text-xs text-gray-500 line-clamp-2 mb-2">
                  {test.description}
                </p>
              )}

              {/* Meta */}
              <div className="text-xs text-gray-500 mb-3">
                <span className="font-medium text-gray-700">{test.itemCount}</span> заданий ·{' '}
                <span className="font-medium text-gray-700">{test.assignmentCount}</span> привязок
              </div>

              {/* Date */}
              <div className="text-xs text-gray-400">
                {new Date(test.created_at).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  year: test.created_at.startsWith(new Date().getFullYear().toString()) ? undefined : 'numeric',
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
