import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, ChevronRight, FolderOpen, FileUp, FileText, Pencil, Send, X, ArrowLeft, Loader2 } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { HomeworkCatalogTaskPicker } from '@/components/modals/HomeworkCatalogTaskPicker'
import { useHomeworkTemplateBuilder, type BuilderItem } from '@/hooks/useHomeworkTemplateBuilder'
import { supabase } from '@/lib/supabase'

interface Props {
  lessonId: string
  courseId: string | null
  topicId: string | null
  topicTitle?: string | null
  canEdit: boolean
}

interface LessonHomeworkTemplateSummary {
  id: string
  title: string
  lesson_id: string | null
  latest_version_id: string
  latest_version: number
  items_count: number
}

interface TemplateItemRow {
  catalog_task_id: string
  custom_number: string | null
  max_score: number | null
  grading_mode: BuilderItem['grading_mode']
  grading_spec: Record<string, unknown> | null
  ai_check_enabled: boolean | null
  catalog_tasks: BuilderItem['task'] | null
}

export function LessonHomeworkV2Card({ lessonId, courseId, topicId, topicTitle, canEdit }: Props) {
  const [template, setTemplate] = useState<LessonHomeworkTemplateSummary | null>(null)
  const [items, setItems] = useState<BuilderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const builder = useHomeworkTemplateBuilder()

  const defaultTitle = useMemo(
    () => topicTitle?.trim() ? `Домашняя работа: ${topicTitle}` : 'Домашняя работа',
    [topicTitle],
  )

  useEffect(() => {
    if (!editorOpen) return
    builder.replaceItems(items)
    setTitle(template?.title || defaultTitle)
    setFormError(null)
  }, [defaultTitle, editorOpen, template?.id, template?.title])

  useEffect(() => {
    if (!lessonId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const { data: templateRows, error: templateError } = await supabase
          .from('homework_templates')
          .select('id, title, lesson_id, created_at')
          .eq('lesson_id', lessonId)
          .order('created_at', { ascending: false })
          .limit(1)
        if (templateError) throw templateError
        const currentTemplate = templateRows?.[0] ?? null
        if (!currentTemplate) {
          if (!cancelled) {
            setTemplate(null)
            setItems([])
          }
          return
        }

        const { data: versions, error: versionsError } = await supabase
          .from('homework_template_versions')
          .select('id, version')
          .eq('template_id', currentTemplate.id)
          .order('version', { ascending: false })
          .limit(1)
        if (versionsError) throw versionsError
        const latestVersion = versions?.[0]
        if (!latestVersion) {
          if (!cancelled) {
            setTemplate(null)
            setItems([])
          }
          return
        }

        const { data: itemRows, error: itemError } = await supabase
          .from('homework_template_items')
          .select(`
            catalog_task_id,
            custom_number,
            max_score,
            grading_mode,
            grading_spec,
            ai_check_enabled,
            catalog_tasks(
              id,
              external_id,
              section_id,
              subject,
              exam_type,
              difficulty,
              statement_html,
              answer_html,
              solution_html,
              solution_plan_html,
              grade_criteria_html,
              has_answer,
              has_solution,
              position,
              exam_part
            )
          `)
          .eq('template_version_id', latestVersion.id)
          .order('position', { ascending: true })
        if (itemError) throw itemError

        const normalizedItems = ((itemRows || []) as unknown as TemplateItemRow[])
          .filter(row => row.catalog_tasks?.id)
          .map(row => ({
            key: row.catalog_task_id,
            catalog_task_id: row.catalog_task_id,
            task: row.catalog_tasks!,
            custom_number: row.custom_number || '',
            max_score: row.max_score,
            grading_mode: row.grading_mode ?? 'manual',
            grading_spec: row.grading_spec ?? {},
            ai_check_enabled: row.ai_check_enabled ?? false,
          }))

        if (!cancelled) {
          setTemplate({
            id: currentTemplate.id,
            title: currentTemplate.title,
            lesson_id: currentTemplate.lesson_id,
            latest_version_id: latestVersion.id,
            latest_version: latestVersion.version,
            items_count: normalizedItems.length,
          })
          setItems(normalizedItems)
        }
      } catch {
        if (!cancelled) {
          setTemplate(null)
          setItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [lessonId])

  async function reload() {
    setLoading(true)
    const { data: templateRows } = await supabase
      .from('homework_templates')
      .select('id, title, lesson_id, created_at')
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: false })
      .limit(1)
    const currentTemplate = templateRows?.[0] ?? null
    if (!currentTemplate) {
      setTemplate(null)
      setItems([])
      setLoading(false)
      return
    }
    const { data: versions } = await supabase
      .from('homework_template_versions')
      .select('id, version')
      .eq('template_id', currentTemplate.id)
      .order('version', { ascending: false })
      .limit(1)
    const latestVersion = versions?.[0]
    const { data: itemRows } = latestVersion
      ? await supabase
          .from('homework_template_items')
          .select(`
            catalog_task_id,
            custom_number,
            max_score,
            grading_mode,
            grading_spec,
            ai_check_enabled,
            catalog_tasks(
              id,
              external_id,
              section_id,
              subject,
              exam_type,
              difficulty,
              statement_html,
              answer_html,
              solution_html,
              solution_plan_html,
              grade_criteria_html,
              has_answer,
              has_solution,
              position,
              exam_part
            )
          `)
          .eq('template_version_id', latestVersion.id)
          .order('position', { ascending: true })
      : { data: [] }

    const normalizedItems = ((itemRows || []) as unknown as TemplateItemRow[])
      .filter(row => row.catalog_tasks?.id)
      .map(row => ({
        key: row.catalog_task_id,
        catalog_task_id: row.catalog_task_id,
        task: row.catalog_tasks!,
        custom_number: row.custom_number || '',
        max_score: row.max_score,
        grading_mode: row.grading_mode ?? 'manual',
        grading_spec: row.grading_spec ?? {},
        ai_check_enabled: row.ai_check_enabled ?? false,
      }))

    setTemplate(latestVersion ? {
      id: currentTemplate.id,
      title: currentTemplate.title,
      lesson_id: currentTemplate.lesson_id,
      latest_version_id: latestVersion.id,
      latest_version: latestVersion.version,
      items_count: normalizedItems.length,
    } : null)
    setItems(normalizedItems)
    setLoading(false)
  }

  async function saveTemplate() {
    setFormError(null)
    if (!courseId) {
      setFormError('Урок не привязан к курсу')
      return
    }
    if (!title.trim()) {
      setFormError('Введите название ДЗ')
      return
    }
    if (builder.items.length === 0) {
      setFormError('Добавьте хотя бы одну задачу из каталога')
      return
    }

    const result = await builder.save({
      templateId: template?.id ?? null,
      courseId,
      topicId,
      title: title.trim(),
      instructions: '',
      maxScore: null,
    })

    await supabase
      .from('homework_templates')
      .update({ lesson_id: lessonId } as never)
      .eq('id', result.template_id)

    setChooserOpen(false)
    setEditorOpen(false)
    builder.clear()
    await reload()
  }

  if (loading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" />Загрузка ДЗ…</div>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ClipboardList size={17} />Домашнее задание</CardTitle>
          {canEdit && !template && (
            <button onClick={() => setChooserOpen(true)} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1">
              <FileText size={12} />Создать ДЗ
            </button>
          )}
        </CardHeader>

        {!template ? (
          <p className="text-sm text-gray-400 py-3 text-center">Домашнее задание пока не добавлено</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{template.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{template.items_count} задач</p>
              </div>
              <span className="text-xs text-gray-400">v{template.latest_version}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setViewerOpen(true)}>
                <ChevronRight size={14} className="mr-1" />Открыть
              </Button>
              {canEdit && (
                <Button size="sm" onClick={() => setEditorOpen(true)}>
                  <Pencil size={14} className="mr-1" />Редактировать
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {chooserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setChooserOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-900">Создать ДЗ</h3>
              <p className="mt-1 text-sm text-gray-500">Выберите источник домашнего задания для этого урока.</p>
            </div>
            <div className="space-y-3">
              <ChooserOption
                icon={<FolderOpen size={18} className="text-gray-400" />}
                title="Из каталога"
                description="Собрать Homework V2 из существующих задач"
                onClick={() => {
                  setChooserOpen(false)
                  setEditorOpen(true)
                }}
              />
              <ChooserOption
                icon={<FileUp size={18} className="text-gray-400" />}
                title="Загрузить PDF"
                description="Скоро"
                disabled
              />
            </div>
            <Button variant="secondary" className="mt-4 w-full" onClick={() => setChooserOpen(false)}>Отмена</Button>
          </div>
        </div>
      )}

      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setEditorOpen(false)} />
          <div className="relative z-10 flex h-[min(94vh,980px)] w-full max-w-[min(96vw,1440px)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setEditorOpen(false)
                    if (!template) setChooserOpen(true)
                  }}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title="Назад"
                >
                  <ArrowLeft size={16} />
                </button>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{template ? 'Редактировать ДЗ' : 'Создать ДЗ из каталога'}</h3>
                  <p className="mt-1 text-sm text-gray-500">Сохранение создаёт или обновляет Homework V2 шаблон для этого урока.</p>
                </div>
              </div>
              <button type="button" onClick={() => setEditorOpen(false)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="grid min-h-0 gap-6 p-6 lg:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
              <div className="min-w-0 overflow-y-auto pr-1">
                <HomeworkCatalogTaskPicker onAdd={builder.addTask} isSelected={builder.isSelected} embedded />
              </div>
              <div className="min-h-0">
                <div className="sticky top-0 space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                  <Input label="Название ДЗ *" value={title} onChange={event => setTitle(event.target.value)} placeholder={defaultTitle} />
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Выбранные задачи</h4>
                      <span className="text-xs text-gray-400">{builder.items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {builder.items.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-sm text-gray-400">
                          Добавьте задачи из каталога слева
                        </p>
                      ) : (
                        builder.items.map((item, index) => (
                          <div key={item.key} className="flex items-start justify-between gap-2 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-gray-500">Задача {index + 1}</div>
                              <div className="truncate text-sm text-gray-800">№{item.task.external_id}</div>
                            </div>
                            <button type="button" onClick={() => builder.removeTask(item.catalog_task_id)} className="text-xs text-red-500 hover:text-red-600">
                              Убрать
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}
                  <Button className="w-full" loading={builder.saving} onClick={() => void saveTemplate()}>
                    <Send size={15} className="mr-1.5" />Сохранить ДЗ
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewerOpen && template && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewerOpen(false)} />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{template.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{template.items_count} задач</p>
              </div>
              <button type="button" onClick={() => setViewerOpen(false)} className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={item.key} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-800">
                  {index + 1}. Задача №{item.task.external_id}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              {canEdit && (
                <Button onClick={() => { setViewerOpen(false); setEditorOpen(true) }}>
                  <Pencil size={14} className="mr-1" />Редактировать
                </Button>
              )}
              <Button variant="secondary" onClick={() => setViewerOpen(false)}>Закрыть</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ChooserOption({
  icon,
  title,
  description,
  onClick,
  disabled = false,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition-all ${disabled ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50/40'}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div>
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="mt-1 text-sm text-gray-500">{description}</div>
        </div>
      </div>
    </button>
  )
}
