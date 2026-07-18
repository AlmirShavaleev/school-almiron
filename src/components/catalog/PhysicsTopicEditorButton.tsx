import { useMemo, useState } from 'react'
import { Loader2, PencilLine, Search, Star, X } from 'lucide-react'
import { useCatalogPhysicsTaskTopicEditor, type CatalogTask } from '@/hooks/useCatalog'

interface PhysicsTopicEditorButtonProps {
  task: CatalogTask
  topicId?: string
  sectionId?: string
  retryKey?: number
}

export function PhysicsTopicEditorButton({ task, topicId, sectionId, retryKey }: PhysicsTopicEditorButtonProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const editor = useCatalogPhysicsTaskTopicEditor(task.id, topicId, sectionId, retryKey)

  const groupedOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const filtered = normalizedSearch
      ? editor.topicOptions.filter(option =>
          option.title.toLowerCase().includes(normalizedSearch)
          || option.sectionTitle.toLowerCase().includes(normalizedSearch)
          || String(option.external_id).includes(normalizedSearch)
        )
      : editor.topicOptions

    const grouped = new Map<string, typeof filtered>()
    for (const option of filtered) {
      const bucket = grouped.get(option.sectionTitle) ?? []
      bucket.push(option)
      grouped.set(option.sectionTitle, bucket)
    }
    return [...grouped.entries()]
  }, [editor.topicOptions, search])

  const currentPrimaryId = editor.links.find(link => link.is_primary)?.topic_id ?? null
  const linkedTopicIds = new Set(editor.links.map(link => link.topic_id))
  const canAddMore = editor.links.length < 3

  async function runAction(actionKey: string, action: () => Promise<void>) {
    setPendingAction(actionKey)
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось изменить темы задачи')
    } finally {
      setPendingAction(null)
    }
  }

  if (!editor.canEdit) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
      >
        <PencilLine className="h-4 w-4" />
        Изменить темы
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">AI physics topics</div>
                <h2 className="mt-1 text-2xl font-bold text-slate-900">Редактор тем задачи</h2>
                <p className="mt-1 text-sm text-slate-500">Меняет только связи `source='ai_physics_v1'`.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Закрыть редактор тем"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid max-h-[calc(90vh-96px)] gap-6 overflow-y-auto px-6 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className="space-y-4">
                <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/80">
                  <div className="text-sm font-semibold text-slate-900">Текущие темы</div>
                  <div className="mt-3 space-y-2">
                    {editor.loading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Загружаем связи…
                      </div>
                    ) : editor.links.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500">
                        У задачи пока нет AI-тем. Это допустимо: задача выпадет из режима `physics-topics`.
                      </div>
                    ) : (
                      editor.links
                        .slice()
                        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.topic?.external_id ?? 0) - (b.topic?.external_id ?? 0))
                        .map(link => (
                          <div key={link.topic_id} className="rounded-2xl bg-white px-3 py-3 ring-1 ring-slate-200">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-semibold text-slate-900">{link.topic?.title ?? 'Тема'}</span>
                                  {link.is_primary && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                                      <Star className="h-3 w-3" />
                                      Primary
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {link.topic?.external_id ?? '—'} · {link.topic ? getSectionTitle(link.topic.external_id) : 'Физические темы'}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => runAction(`remove-${link.topic_id}`, () => editor.removeTopic(link.topic_id))}
                                disabled={pendingAction !== null}
                                className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {pendingAction === `remove-${link.topic_id}` ? 'Удаляем…' : 'Убрать'}
                              </button>
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                  <div className="mt-3 text-xs text-slate-500">
                    Назначено тем: <span className="font-semibold text-slate-700">{editor.links.length}</span> / 3
                  </div>
                </div>

                {actionError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {actionError}
                  </div>
                )}
                {editor.error && !actionError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {editor.error}
                  </div>
                )}
              </aside>

              <section className="space-y-5">
                <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/80">
                  <label className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      placeholder="Поиск по теме или разделу"
                      className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                    />
                  </label>
                  <p className="mt-2 text-xs text-slate-500">89 тем, сгруппированных по разделам. Поиск не меняет старый каталог, работает только в редакторе.</p>
                </div>

                <div className="rounded-3xl bg-white p-4 ring-1 ring-slate-200/80">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Сменить primary</h3>
                      <p className="mt-1 text-sm text-slate-500">Старая primary остаётся как сопутствующая тема. Если выбрана новая четвёртая тема, сначала нужно освободить слот.</p>
                    </div>
                    {pendingAction && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                  </div>
                  <div className="mt-4 space-y-4">
                    {groupedOptions.map(([sectionTitle, options]) => (
                      <div key={sectionTitle}>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{sectionTitle}</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {options.map(option => {
                            const isCurrentPrimary = option.id === currentPrimaryId
                            const isLinked = linkedTopicIds.has(option.id)
                            const wouldOverflow = !isLinked && !canAddMore
                            return (
                              <button
                                key={`primary-${option.id}`}
                                type="button"
                                onClick={() => runAction(`primary-${option.id}`, () => editor.replacePrimary(option.id))}
                                disabled={isCurrentPrimary || wouldOverflow || pendingAction !== null}
                                className={`rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                  isCurrentPrimary
                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50'
                                }`}
                              >
                                <div className="text-sm font-semibold">{option.title}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {option.external_id} {isLinked ? '· уже назначена' : wouldOverflow ? '· нужен свободный слот' : ''}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl bg-white p-4 ring-1 ring-slate-200/80">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">Добавить сопутствующую тему</h3>
                    <p className="mt-1 text-sm text-slate-500">Добавляется с `is_primary=false`. Максимум 3 темы на задачу.</p>
                  </div>
                  <div className="mt-4 space-y-4">
                    {groupedOptions.map(([sectionTitle, options]) => {
                      const addableOptions = options.filter(option => !linkedTopicIds.has(option.id))
                      if (addableOptions.length === 0) return null
                      return (
                        <div key={`add-${sectionTitle}`}>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{sectionTitle}</div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {addableOptions.map(option => (
                              <button
                                key={`add-topic-${option.id}`}
                                type="button"
                                onClick={() => runAction(`add-${option.id}`, () => editor.addTopic(option.id))}
                                disabled={!canAddMore || pendingAction !== null}
                                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <div className="text-sm font-semibold">{option.title}</div>
                                <div className="mt-1 text-xs text-slate-500">{option.external_id}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    {!canAddMore && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        Лимит достигнут: у задачи уже 3 темы. Уберите одну тему, чтобы добавить новую.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function getSectionTitle(externalId: number) {
  const sectionDigit = Number(String(externalId)[3] ?? '')
  if (sectionDigit === 1) return 'Механика'
  if (sectionDigit === 2) return 'МКТ и термодинамика'
  if (sectionDigit === 3) return 'Электростатика'
  if (sectionDigit === 4) return 'Постоянный ток'
  if (sectionDigit === 5) return 'Магнетизм и ЭМИ'
  if (sectionDigit === 6) return 'Оптика'
  if (sectionDigit === 7) return 'Квантовая и атомная'
  return 'Физические темы'
}
