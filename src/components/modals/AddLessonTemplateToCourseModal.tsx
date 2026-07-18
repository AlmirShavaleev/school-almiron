import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Copy, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLessonTemplates } from '@/hooks/useLessonLibrary'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'
import { EXAM_LABELS, SUBJECT_LABELS } from '@/utils/format'
import type { Module } from '@/hooks/useCourseProgram'

function extractCopyLessonErrorText(error: unknown) {
  if (error instanceof Error) return `${error.message} ${(error as { details?: unknown }).details ?? ''} ${(error as { hint?: unknown }).hint ?? ''}`.trim()
  if (typeof error === 'object' && error) {
    const shape = error as { message?: unknown; details?: unknown; hint?: unknown }
    return `${shape.message ?? ''} ${shape.details ?? ''} ${shape.hint ?? ''}`.trim()
  }
  return String(error ?? '')
}

function mapCopyLessonError(error: unknown) {
  const raw = extractCopyLessonErrorText(error)
  if (raw.includes('TARGET_GROUP_COURSE_FORBIDDEN')) return 'Недостаточно прав для копирования в этот курс'
  if (raw.includes('TEMPLATE_NOT_FOUND_OR_FORBIDDEN')) return 'Урок не найден или недоступен'
  if (raw.includes('TARGET_MODULE_NOT_IN_TARGET_COURSE')) return 'Выбранный модуль не принадлежит курсу'
  if (raw.includes('COPY_JOB_INVALID_STATE')) return 'Копирование уже выполнено или отменено'
  if (raw.includes('NOT_AUTHENTICATED')) return 'Сессия истекла, войдите заново'
  return null
}

export function AddLessonTemplateToCourseModal({
  open,
  courseId,
  groupId,
  groupName,
  modules,
  defaultModuleId,
  onCreateModule,
  onClose,
  onCopied,
}: {
  open: boolean
  courseId: string
  groupId: string | null
  groupName: string | null
  modules: Module[]
  defaultModuleId: string | null
  onCreateModule: () => Promise<string>
  onClose: () => void
  onCopied: () => void
}) {
  const { templates, loading, error } = useLessonTemplates()
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [selectedModuleId, setSelectedModuleId] = useState<string>(defaultModuleId ?? '')
  const [availableFrom, setAvailableFrom] = useState('')
  const [copying, setCopying] = useState(false)
  const [creatingModule, setCreatingModule] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [copiedTopicId, setCopiedTopicId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedTemplateId('')
    setSelectedModuleId(defaultModuleId ?? modules[0]?.id ?? '')
    setAvailableFrom('')
    setStatusText(null)
    setCopiedTopicId(null)
  }, [defaultModuleId, modules, open])

  const selectedTemplate = useMemo(
    () => templates.find(item => item.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  )

  const hasModules = modules.length > 0

  if (!open) return null

  const cannotCopy = copying || creatingModule || !selectedTemplateId || !selectedModuleId || !hasModules

  async function handleCreateModule() {
    setCreatingModule(true)
    try {
      const moduleId = await onCreateModule()
      setSelectedModuleId(moduleId)
      toast.success('Первый модуль создан. Теперь можно добавить урок.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать модуль')
    } finally {
      setCreatingModule(false)
    }
  }

  async function handleCopy() {
    if (!selectedTemplateId || !selectedModuleId) return
    setCopying(true)
    setStatusText('Создаю staging job и запускаю серверное копирование…')
    setCopiedTopicId(null)
    try {
      const data = await invokeCopyLesson({
        template_id: selectedTemplateId,
        target_course_id: courseId,
        target_group_id: groupId ?? null,
        target_module_id: selectedModuleId,
        available_from: availableFrom || null,
      })

      if (!data?.ok) throw new Error(data?.error || 'Не удалось скопировать урок')

      setStatusText('Копирование завершено. Тема уже в программе группы.')
      setCopiedTopicId(data.topic_id ?? null)
      toast.success('Урок добавлен в программу')
      onCopied()
    } catch (e) {
      console.error('Failed to copy lesson into course', e)
      setStatusText(null)
      const mappedMessage = mapCopyLessonError(e)
      if (mappedMessage) {
        toast.error(mappedMessage)
      } else {
        toast.error('Не удалось скопировать урок')
      }
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Copy-on-add</div>
            <h3 className="mt-1 text-xl font-bold text-gray-900">Добавить урок в программу</h3>
            <p className="mt-2 text-sm text-gray-500">Урок копируется серверно через `stage_lesson_copy → edge copy_lesson → finalize`. Исходный урок в библиотеке не меняется.</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-y-auto border-r border-gray-100 p-6">
            {!hasModules ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
                <div className="font-semibold text-amber-900">В программе ещё нет модулей.</div>
                <p className="mt-2">Для copy-on-add нужен `target_module_id`. Можно создать первый модуль прямо сейчас, без выхода из окна.</p>
                <Button className="mt-4" onClick={handleCreateModule} loading={creatingModule}>
                  Создать первый модуль
                </Button>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Sparkles size={16} className="text-primary-500" />
                  Мои уроки
                </div>

                {loading ? (
                  <div className="flex items-center gap-2 py-10 text-gray-400"><Loader2 size={16} className="animate-spin" />Загрузка библиотеки…</div>
                ) : error ? (
                  <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-600">{error}</div>
                ) : templates.length === 0 ? (
                  <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">В библиотеке пока нет уроков.</div>
                ) : (
                  <div className="space-y-3">
                    {templates.map(template => (
                      <button
                        key={template.id}
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={cn(
                          'w-full rounded-3xl border p-4 text-left transition-all',
                          selectedTemplateId === template.id ? 'border-primary-300 bg-primary-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold text-gray-900">{template.title}</div>
                            {template.description && <div className="mt-1 text-sm text-gray-500">{template.description}</div>}
                          </div>
                          <Copy size={16} className={selectedTemplateId === template.id ? 'text-primary-600' : 'text-gray-300'} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{SUBJECT_LABELS[template.subject]}</span>
                          {template.exam_type && <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">{EXAM_LABELS[template.exam_type]}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="overflow-y-auto bg-gray-50/70 p-6">
            <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-semibold text-gray-900">Куда копируем</div>
              <div className="mt-1 text-sm text-gray-500">{groupName ?? 'В программу курса'} <ArrowRight className="mx-1 inline h-3.5 w-3.5" /> текущая программа курса</div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Модуль программы</label>
                  <select value={selectedModuleId} onChange={e => setSelectedModuleId(e.target.value)} disabled={!hasModules} className="min-h-11 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:bg-gray-100 disabled:text-gray-400">
                    {modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Дата открытия копии</label>
                  <input type="date" value={availableFrom} onChange={e => setAvailableFrom(e.target.value)} className="min-h-11 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
                </div>
              </div>
            </div>

            {selectedTemplate && (
              <div className="mt-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-gray-900">Что будет скопировано</div>
                <ul className="mt-3 space-y-2 text-sm text-gray-600">
                  <li>Тема: {selectedTemplate.title}</li>
                  <li>Материалы из `lesson-library` → в `course-materials/topics/&#123;new_topic_id&#125;/...`</li>
                  <li>Задачи урока → новая `task_collection` без `assigned_collections`</li>
                </ul>
              </div>
            )}

            {statusText && (
              <div className={cn('mt-4 rounded-3xl border p-4 text-sm', copiedTopicId ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-800')}>
                <div className="flex items-start gap-2">
                  {copying ? <Loader2 size={16} className="mt-0.5 animate-spin" /> : <CheckCircle2 size={16} className="mt-0.5" />}
                  <div>
                    <div>{statusText}</div>
                    {copiedTopicId && <div className="mt-1 text-xs opacity-80">topic_id: {copiedTopicId}</div>}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Закрыть</Button>
              <Button className="flex-1" onClick={handleCopy} loading={copying} disabled={cannotCopy}>
                Добавить в программу
              </Button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-gray-400">
              После копии заготовка задач будет видна учителю в существующей collection-системе. Отдельный entry-point для быстрого перехода к этой заготовке пока не делаем.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

async function invokeCopyLesson(body: {
  template_id: string
  target_course_id: string
  target_group_id: string | null
  target_module_id: string
  available_from: string | null
}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Не задан VITE_SUPABASE_URL или VITE_SUPABASE_ANON_KEY')
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw new Error(sessionError.message)

  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('Сессия истекла. Войдите снова.')

  const response = await fetch(`${supabaseUrl}/functions/v1/copy_lesson`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(body),
  })

  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `copy_lesson failed with ${response.status}`)
  }

  return payload as { ok?: boolean; topic_id?: string | null; error?: string }
}
