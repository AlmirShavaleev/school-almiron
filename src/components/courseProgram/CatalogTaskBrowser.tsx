'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Plus, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCatalogSections, ALL_SUBJECTS, type CatalogTask, type CatalogTaskAsset } from '@/hooks/useCatalog'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { hasTextAnswer } from '@/lib/topicTest'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function CatalogTaskBrowser({
  onAdd,
  addedTaskIds,
}: {
  onAdd: (taskId: string) => Promise<void>
  addedTaskIds: Set<string>
}) {
  const [subject, setSubject] = useState<'Математика' | 'Физика'>('Математика')
  const [examType, setExamType] = useState<'ОГЭ' | 'ЕГЭ'>('ЕГЭ')
  const [sectionId, setSectionId] = useState<string | undefined>()
  const [examPart, setExamPart] = useState<string>('all')
  const [search, setSearch] = useState('')

  const { sections, loading: sectionsLoading } = useCatalogSections(subject, examType)

  const [tasks, setTasks] = useState<CatalogTask[]>([])
  const [assets, setAssets] = useState<Record<string, CatalogTaskAsset[]>>({})
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [addingStatus, setAddingStatus] = useState<Record<string, boolean>>({})
  const [addError, setAddError] = useState<string | null>(null)

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(0)
      setTasks([])
    }, 400)
    return () => clearTimeout(timer)
  }, [search])

  // Reset when filters change
  useEffect(() => {
    setPage(0)
    setTasks([])
    setAssets({})
    setAddError(null)
  }, [sectionId, examPart, subject, examType])

  // Load tasks when section or search changes
  useEffect(() => {
    if (!sectionId) {
      setTasks([])
      setAssets({})
      return
    }

    async function loadTasks() {
      setLoading(true)
      setLoadingError(null)
      try {
        let q = db
          .from('catalog_tasks')
          .select('id, external_id, section_id, subject, exam_type, statement_html, answer_html, has_answer, partial_type, max_points, exam_part, position')
          .eq('section_id', sectionId)
          .eq('is_published', true)

        if (examPart !== 'all') {
          q = q.eq('exam_part', parseInt(examPart, 10))
        }

        const query = debouncedSearch
        if (/^\d+$/.test(query)) {
          q = q.eq('external_id', parseInt(query, 10))
        } else if (query.length >= 2) {
          q = q.ilike('statement_html', `%${query}%`)
        }

        const { data, error } = await q
          .order('position')
          .order('external_id')
          .range(page * 20, page * 20 + 19)

        if (error) throw new Error(error.message ?? 'Не удалось загрузить задачи')

        const newTasks = (data ?? []) as CatalogTask[]

        if (page === 0) {
          setTasks(newTasks)
        } else {
          setTasks(prev => [...prev, ...newTasks])
        }

        // Load assets for these tasks
        if (newTasks.length > 0) {
          const taskIds = newTasks.map(t => t.id)
          const { data: assetsData, error: assetsError } = await db
            .from('catalog_task_assets')
            .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
            .in('task_id', taskIds)
            .order('position')

          if (assetsError) throw new Error(assetsError.message ?? 'Не удалось загрузить активы')

          const newAssets: Record<string, CatalogTaskAsset[]> = {}
          for (const asset of (assetsData ?? []) as (CatalogTaskAsset & { task_id: string })[]) {
            if (!newAssets[asset.task_id]) newAssets[asset.task_id] = []
            newAssets[asset.task_id].push(asset)
          }

          setAssets(prev => ({ ...prev, ...newAssets }))
        }
      } catch (e) {
        setLoadingError(e instanceof Error ? e.message : 'Не удалось загрузить задачи')
      } finally {
        setLoading(false)
      }
    }

    loadTasks()
  }, [sectionId, examPart, debouncedSearch, page])

  const handleAdd = useCallback(async (taskId: string) => {
    setAddingStatus(prev => ({ ...prev, [taskId]: true }))
    setAddError(null)
    try {
      await onAdd(taskId)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Не удалось добавить задачу')
    } finally {
      setAddingStatus(prev => ({ ...prev, [taskId]: false }))
    }
  }, [onAdd])

  const handleLoadMore = () => {
    if (tasks.length === (page + 1) * 20) {
      setPage(prev => prev + 1)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Каталог задач</h3>

        {/* Filters */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={subject}
              onChange={e => {
                setSubject(e.target.value as 'Математика' | 'Физика')
                setSectionId(undefined)
                setSearch('')
                setPage(0)
              }}
              className="h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              {ALL_SUBJECTS.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={examType}
              onChange={e => {
                setExamType(e.target.value as 'ОГЭ' | 'ЕГЭ')
                setSectionId(undefined)
                setSearch('')
                setPage(0)
              }}
              className="h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="ОГЭ">ОГЭ</option>
              <option value="ЕГЭ">ЕГЭ</option>
            </select>
          </div>

          {/* Section selector */}
          {sectionsLoading ? (
            <div className="flex items-center gap-1 text-xs text-gray-400 h-9">
              <Loader2 size={12} className="animate-spin" />
              Загрузка разделов…
            </div>
          ) : (
            <select
              value={sectionId ?? ''}
              onChange={e => {
                setSectionId(e.target.value || undefined)
                setSearch('')
                setPage(0)
              }}
              className="w-full h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="">Выберите раздел…</option>
              {sections.map(s => (
                <option key={s.id} value={s.id}>
                  {s.exam_number ? `№${s.exam_number} ` : ''}{s.title}
                </option>
              ))}
            </select>
          )}

          {/* Part filter and search */}
          <div className="grid grid-cols-2 gap-2">
            <select
              value={examPart}
              onChange={e => setExamPart(e.target.value)}
              disabled={!sectionId}
              className="h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="all">Часть: Все</option>
              <option value="1">Часть: 1</option>
              <option value="2">Часть: 2</option>
            </select>

            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск (№ или текст)"
              disabled={!sectionId}
              className="h-9 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>
      </div>

      {/* Error messages */}
      {(loadingError || addError) && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
          <span className="flex-1">{loadingError || addError}</span>
        </div>
      )}

      {/* Empty section state */}
      {!sectionId && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-center">
          <p className="text-xs text-gray-500">Выберите раздел, чтобы посмотреть задачи</p>
        </div>
      )}

      {/* Tasks list */}
      {sectionId && (
        <div className="space-y-2">
          {loading && tasks.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" />
              Загрузка задач…
            </div>
          )}

          {!loading && tasks.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-center">
              <p className="text-xs text-gray-500">Задач не найдено</p>
            </div>
          )}

          {tasks.length > 0 && (
            <>
              <div className="text-xs text-gray-500 px-1">
                Показано <span className="font-semibold">{tasks.length}</span> задач
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-200 overflow-hidden">
                {tasks.map(task => {
                  const isAdded = addedTaskIds.has(task.id)
                  const hasAnswer = hasTextAnswer(task.answer_html, task.has_answer)
                  const isAdding = addingStatus[task.id] ?? false

                  return (
                    <div key={task.id} className="p-3 space-y-2">
                      {/* Badges row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                          №{task.external_id}
                        </span>
                        {task.exam_part && (
                          <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                            Часть {task.exam_part}
                          </span>
                        )}
                        <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                          {task.max_points ?? 1} б.
                        </span>
                        {task.partial_type && (
                          <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                            {task.partial_type === 'matching' ? 'Сопоставление' : 'Мультивыбор'}
                          </span>
                        )}
                      </div>

                      {/* Content */}
                      <div className="max-h-48 overflow-y-auto">
                        <TaskContentRenderer
                          html={resolveTaskHtml(task.statement_html, assets[task.id])}
                          className="text-sm"
                        />
                      </div>

                      {/* Button */}
                      <div className="flex justify-end pt-2">
                        {isAdded ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled
                            className="text-green-700"
                          >
                            <CheckCircle2 size={12} />
                            В тесте
                          </Button>
                        ) : !hasAnswer ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled
                            title="Автопроверка невозможна: у задачи нет текстового ответа"
                          >
                            Нет эталона
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleAdd(task.id)}
                            disabled={isAdding}
                          >
                            {isAdding ? (
                              <>
                                <Loader2 size={12} className="animate-spin" />
                              </>
                            ) : (
                              <>
                                <Plus size={12} />
                                Добавить
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Load more button */}
              {tasks.length === (page + 1) * 20 && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                      </>
                    ) : (
                      'Показать ещё'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
