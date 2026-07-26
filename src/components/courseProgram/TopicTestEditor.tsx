import { useEffect, useState } from 'react'
import {
  Eye, EyeOff, Loader2, Plus, Trash2, AlertCircle,
} from 'lucide-react'
import { useTopicTest } from '@/hooks/useTopicTest'
import { useCatalogSections, useCatalogSearch } from '@/hooks/useCatalog'
import { Button } from '@/components/ui/Button'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { totalMaxPoints, hasTextAnswer } from '@/lib/topicTest'
import { cn } from '@/utils/cn'

/**
 * Преподавательский конструктор тестов по теме: создание, редактирование,
 * добавление заданий из каталога и локальная публикация.
 */
export function TopicTestEditor({ topicId }: { topicId: string }) {
  const {
    test, items, hasAttempts, loading, error,
    createTest, updateTest, setPublished, deleteTest, addItem, removeItem,
  } = useTopicTest(topicId)

  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    setTitle(test?.title ?? '')
  }, [test?.id, test?.title])

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
        Загрузка теста…
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

      {!test && (
        <div className="rounded-2xl border border-dashed border-gray-200 p-4">
          <div className="mb-2 text-sm font-semibold text-gray-900">Тест по теме</div>
          <p className="mb-3 text-xs text-gray-500">Проверочный тест: задания из каталога, автоматическая проверка по эталонам.</p>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Тест по теме"
            aria-label="Название теста"
            className="mb-3 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <Button onClick={() => run(() => createTest(title))} loading={busy}>
            <Plus size={15} />
            Создать тест
          </Button>
        </div>
      )}

      {test && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Тест по теме</span>
              {!test.is_published && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                  Черновик
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={test.is_published ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => run(() => setPublished(!test.is_published))}
                disabled={busy}
              >
                {test.is_published ? <EyeOff size={14} /> : <Eye size={14} />}
                {test.is_published ? 'Скрыть' : 'Опубликовать'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  if (window.confirm('Удалить тест? Это действие нельзя отменить.')) {
                    void run(() => deleteTest())
                  }
                }}
                disabled={busy}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>

          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() !== test.title) {
                void run(() => updateTest({ title: title.trim() }))
              }
            }}
            aria-label="Название теста"
            className="mb-3 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />

          {/* Список заданий */}
          {hasAttempts && (
            <div className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
              По тесту уже есть попытки — состав заданий заморожен.
            </div>
          )}

          <div className="mb-3 space-y-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
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
                        aria-label="Удалить задание"
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
                      Эталон ответа: <span className="font-normal">{item.answer_text}</span>
                    </summary>
                  </details>
                </div>
              ))
            )}
          </div>

          <div className="mb-3 text-xs text-gray-500">
            Всего: <span className="font-semibold text-gray-700">{totalMaxPoints(items)} б.</span> · <span className="font-semibold text-gray-700">{items.length} заданий</span>
          </div>

          {!hasAttempts && (
            <Button
              variant="secondary"
              onClick={() => setShowPicker(!showPicker)}
              disabled={busy}
            >
              <Plus size={14} />
              Добавить задание из каталога
            </Button>
          )}

          {showPicker && !hasAttempts && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <CatalogTaskPicker
                onSelect={taskId => {
                  void run(() => addItem(taskId)).then(() => setShowPicker(false))
                }}
                alreadyAdded={new Set(items.map(i => i.task_id).filter((id): id is string => id !== null))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Панель выбора задания из каталога.
 */
function CatalogTaskPicker({
  onSelect,
  alreadyAdded,
}: {
  onSelect: (taskId: string) => void
  alreadyAdded: Set<string>
}) {
  const [subject, setSubject] = useState<'Математика' | 'Физика'>('Математика')
  const [examType, setExamType] = useState<'ОГЭ' | 'ЕГЭ'>('ЕГЭ')
  const [sectionId, setSectionId] = useState<string | undefined>()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const { sections, loading: sectionsLoading } = useCatalogSections(subject, examType)
  const { results, loading: resultsLoading } = useCatalogSearch(query, sectionId, query.length >= 2)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={subject}
          onChange={e => {
            setSubject(e.target.value as 'Математика' | 'Физика')
            setSectionId(undefined)
            setQuery('')
          }}
          className="h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <option value="Математика">Математика</option>
          <option value="Физика">Физика</option>
        </select>

        <select
          value={examType}
          onChange={e => {
            setExamType(e.target.value as 'ОГЭ' | 'ЕГЭ')
            setSectionId(undefined)
            setQuery('')
          }}
          className="h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <option value="ОГЭ">ОГЭ</option>
          <option value="ЕГЭ">ЕГЭ</option>
        </select>
      </div>

      {sectionsLoading ? (
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" />
          Загрузка разделов…
        </div>
      ) : (
        <select
          value={sectionId ?? ''}
          onChange={e => {
            setSectionId(e.target.value || undefined)
            setQuery('')
          }}
          className="w-full h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <option value="">Выберите раздел…</option>
          {sections.map(s => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      )}

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Поиск по номеру или тексту (мин. 2 символа)"
        disabled={!sectionId}
        className="w-full h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:bg-gray-50 disabled:text-gray-400"
      />

      {resultsLoading && (
        <div className="flex items-center gap-1 text-xs text-gray-400 py-4 justify-center">
          <Loader2 size={12} className="animate-spin" />
          Поиск…
        </div>
      )}

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {!resultsLoading && results.length === 0 && query.length >= 2 && (
          <p className="text-xs text-gray-400 text-center py-4">Задания не найдены</p>
        )}

        {results.map(task => {
          const isAdded = alreadyAdded.has(task.id)
          const canAdd = task.has_answer && hasTextAnswer(task.answer_html, task.has_answer)

          return (
            <div key={task.id} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {task.exam_part && (
                  <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                    Часть {task.exam_part}
                  </span>
                )}
                {task.max_points && (
                  <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                    {task.max_points} б.
                  </span>
                )}
                {task.partial_type && (
                  <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                    {task.partial_type === 'matching' ? 'Сопоставление' : 'Мультивыбор'}
                  </span>
                )}
              </div>

              <div className="max-h-40 overflow-hidden">
                <TaskContentRenderer
                  html={resolveTaskHtml(task.statement_html, task.assets)}
                  className="text-xs"
                />
              </div>

              <div className="flex items-center gap-2">
                {isAdded ? (
                  <Button variant="secondary" size="sm" disabled>
                    Добавлено
                  </Button>
                ) : canAdd ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setBusy(true)
                      onSelect(task.id)
                      setBusy(false)
                    }}
                    loading={busy}
                  >
                    <Plus size={12} />
                    Добавить
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" disabled title="Нет текстового эталона ответа">
                    Нет эталона
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
