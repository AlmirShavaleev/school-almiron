import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileText, Send, Loader2, ChevronRight, FolderOpen, FileUp, ArrowLeft } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { supabase } from '@/lib/supabase'
import { useCourseHomeworkTemplates, type CourseHomeworkTemplate } from '@/hooks/useCourseHomeworkTemplates'
import { useCourseHomeworkSummary } from '@/hooks/useCourseHomeworkSummary'
import { AssignHomeworkTemplateModal } from '@/components/modals/AssignHomeworkTemplateModal'
import { HomeworkCatalogTaskPicker } from '@/components/modals/HomeworkCatalogTaskPicker'
import type { GroupStudent } from '@/hooks/useGroupControl'
import type { Module } from '@/hooks/useCourseProgram'
import { useHomeworkTemplateBuilder } from '@/hooks/useHomeworkTemplateBuilder'
import { formatDate } from '@/utils/format'

const STATUS_LABELS: Record<string, string> = { draft: 'Черновик', active: 'Активен', archived: 'Архив' }
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', active: 'bg-green-100 text-green-700', archived: 'bg-gray-100 text-gray-400',
}

/** Homework V2 templates + assignment summary for a course, grouped by topic. Replaces the
 * legacy CreateHomeworkModal/homeworks list on CourseProgramPage entirely — writes only via
 * the existing AssignHomeworkTemplateModal; never inserts into homeworks/assigned_collections. */
export function CourseHomeworkV2Section({ courseId, modules }: { courseId: string; modules: Module[] }) {
  const { templates, loading, reload } = useCourseHomeworkTemplates(courseId)
  const { summary, loading: summaryLoading, reload: reloadSummary } = useCourseHomeworkSummary(courseId)
  const [groups, setGroups] = useState<{ id: string; name: string; students: GroupStudent[] }[]>([])
  const [assignTarget, setAssignTarget] = useState<{ templateVersionId: string; groupId: string; students: GroupStudent[] } | null>(null)
  const [pickingGroupFor, setPickingGroupFor] = useState<CourseHomeworkTemplate | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [catalogFlowOpen, setCatalogFlowOpen] = useState(false)
  const [catalogTitle, setCatalogTitle] = useState('')
  const [catalogTitleManuallyEdited, setCatalogTitleManuallyEdited] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selectedCatalogTopicTitle, setSelectedCatalogTopicTitle] = useState<string | null>(null)
  const builder = useHomeworkTemplateBuilder()
  const defaultCatalogTitle = useMemo(() => {
    return selectedCatalogTopicTitle ? `Домашняя работа: ${selectedCatalogTopicTitle}` : 'Домашняя работа'
  }, [selectedCatalogTopicTitle])

  const defaultTemplate = useMemo(() => templates.find(template => template.status !== 'archived') ?? templates[0] ?? null, [templates])

  useEffect(() => {
    if (!courseId) return
    ;(async () => {
      const { data: gs } = await supabase
        .from('groups')
        .select('id, name')
        .eq('course_id', courseId)
        .eq('is_active', true)

      const groupIds = (gs || []).map((group: any) => group.id)
      let membersByGroupId = new Map<string, GroupStudent[]>()

      if (groupIds.length > 0) {
        const { data: memberRows } = await supabase
          .from('group_students')
          .select('group_id, student_id, students(id, profile_id, profiles(full_name, avatar_url, email))')
          .in('group_id', groupIds)

        membersByGroupId = (memberRows || []).reduce((acc, row: any) => {
          const groupStudents = acc.get(row.group_id) ?? []
          if (row.student_id) {
            groupStudents.push({
              id: row.student_id,
              profile_id: row.students?.profile_id || '',
              full_name: row.students?.profiles?.full_name || '—',
              email: row.students?.profiles?.email || '',
              avatar_url: row.students?.profiles?.avatar_url ?? null,
            })
          }
          acc.set(row.group_id, groupStudents)
          return acc
        }, new Map<string, GroupStudent[]>())
      }

      const mapped = (gs || []).map((g: any) => ({
        id: g.id,
        name: g.name,
        students: (membersByGroupId.get(g.id) ?? []).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')),
      }))
      setGroups(mapped)
    })()
  }, [courseId])

  const topicTitle = (topicId: string | null) => {
    if (!topicId) return null
    for (const m of modules) {
      const t = m.topics.find(x => x.id === topicId)
      if (t) return `${m.title} · ${t.title}`
    }
    return null
  }

  const byTopic = new Map<string, CourseHomeworkTemplate[]>()
  const general: CourseHomeworkTemplate[] = []
  for (const t of templates) {
    if (t.topic_id) {
      const key = t.topic_id
      if (!byTopic.has(key)) byTopic.set(key, [])
      byTopic.get(key)!.push(t)
    } else {
      general.push(t)
    }
  }

  useEffect(() => {
    if (!catalogFlowOpen) return
    if (catalogTitleManuallyEdited) return
    setCatalogTitle(defaultCatalogTitle)
  }, [catalogFlowOpen, defaultCatalogTitle, catalogTitleManuallyEdited])

  const catalogDisabledReason = !catalogTitle.trim()
    ? 'Укажите название домашней работы'
    : builder.items.length === 0
      ? 'Выберите хотя бы одну задачу из каталога'
      : null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Домашние задания</h2>
          <p className="text-sm text-gray-500">Шаблоны Homework V2 этого курса</p>
        </div>
      </div>

      {!summaryLoading && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <SummaryTile label="Шаблонов" value={summary.templates_count} />
          <SummaryTile label="Активных назначений" value={summary.active_assignments_count} />
          <SummaryTile label="Запланировано" value={summary.scheduled_assignments_count} />
          <SummaryTile label="Назначено ученикам" value={summary.recipients_count} />
          <SummaryTile label="Сдано" value={summary.submitted_count} />
          <SummaryTile label="На проверке" value={summary.awaiting_review_count} />
          <SummaryTile label="На доработке" value={summary.returned_count} />
          <SummaryTile label="Принято" value={summary.accepted_count} />
          <SummaryTile label="Просрочено" value={summary.overdue_count} warn={summary.overdue_count > 0} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-6"><Loader2 size={16} className="animate-spin" />Загрузка шаблонов…</div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Шаблонов ДЗ в этом курсе пока нет</p>
      ) : (
        <div className="space-y-4">
          {[...byTopic.entries()].map(([topicId, list]) => (
            <div key={topicId}>
              <div className="text-xs font-semibold text-gray-500 mb-1.5">{topicTitle(topicId) || 'Тема'}</div>
              <div className="space-y-2">
                {list.map(t => (
                  <TemplateCard key={t.id} template={t} onAssign={() => setPickingGroupFor(t)} />
                ))}
              </div>
            </div>
          ))}
          {general.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1.5">Общие ДЗ курса</div>
              <div className="space-y-2">
                {general.map(t => (
                  <TemplateCard key={t.id} template={t} onAssign={() => setPickingGroupFor(t)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {chooserOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setChooserOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-900">Назначить ДЗ</h3>
              <p className="mt-1 text-sm text-gray-500">Выберите источник задания для этой группы.</p>
            </div>

            <div className="space-y-3">
              <ChooserOption
                icon={<FolderOpen size={18} className="text-gray-400" />}
                title="Выбрать задания из каталога"
                description="Собрать ДЗ из существующих задач каталога"
                onClick={() => {
                  setChooserOpen(false)
                  setCatalogFlowOpen(true)
                  setCatalogError(null)
                  setCatalogTitle('')
                  setCatalogTitleManuallyEdited(false)
                  setSelectedCatalogTopicTitle(null)
                }}
              />
              <ChooserOption
                icon={<FileUp size={18} className="text-gray-400" />}
                title="Загрузить PDF"
                description="Скоро"
                disabled
              />
              <ChooserOption
                icon={<FileText size={18} className="text-primary-500" />}
                title="Использовать готовый шаблон"
                description={defaultTemplate ? `Откроется выбор группы для шаблона «${defaultTemplate.title}»` : 'Доступно, когда в курсе есть шаблоны'}
                disabled={!defaultTemplate}
                onClick={() => {
                  if (!defaultTemplate) return
                  setChooserOpen(false)
                  setPickingGroupFor(defaultTemplate)
                }}
              />
            </div>

            <Button variant="secondary" className="mt-4 w-full" onClick={() => setChooserOpen(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      {catalogFlowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setCatalogFlowOpen(false)} />
          <div className="relative z-10 flex h-[min(94vh,980px)] w-full max-w-[min(96vw,1440px)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setCatalogFlowOpen(false)
                    setChooserOpen(true)
                  }}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                  title="Назад"
                >
                  <ArrowLeft size={16} />
                </button>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Выбрать задания из каталога</h3>
                  <p className="mt-1 text-sm text-gray-500">Соберите Homework V2 шаблон и сразу перейдите к назначению группе.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCatalogFlowOpen(false)}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <ChevronRight size={16} className="rotate-45" />
              </button>
            </div>

            <div className="grid min-h-0 gap-6 p-6 lg:grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]">
              <div className="min-w-0 overflow-y-auto pr-1">
                <HomeworkCatalogTaskPicker
                  onAdd={builder.addTask}
                  isSelected={builder.isSelected}
                  embedded
                  onTopicChange={topic => setSelectedCatalogTopicTitle(topic?.title ?? null)}
                />
              </div>

              <div className="min-h-0">
                <div className="sticky top-0 space-y-4 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-900">Новое ДЗ</h4>
                    <span className="text-xs text-gray-400">{builder.items.length} задач</span>
                  </div>
                  <Input
                    label="Название ДЗ *"
                    value={catalogTitle}
                    onChange={e => {
                      setCatalogTitleManuallyEdited(true)
                      setCatalogTitle(e.target.value)
                      if (catalogError) setCatalogError(null)
                    }}
                    placeholder={defaultCatalogTitle}
                  />
                  <p className="mt-2 text-xs text-gray-500">Название подставляется автоматически по теме курса, но его можно изменить.</p>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Выбранные задачи</h5>
                      {catalogDisabledReason && <span className="text-xs text-amber-600">{catalogDisabledReason}</span>}
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
                            <button
                              type="button"
                              onClick={() => builder.removeTask(item.catalog_task_id)}
                              className="text-xs text-red-500 hover:text-red-600"
                            >
                              Убрать
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  {catalogError && (
                    <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{catalogError}</p>
                  )}
                  <Button
                    className="w-full"
                    loading={builder.saving}
                    disabled={!!catalogDisabledReason}
                    onClick={async () => {
                      if (!catalogTitle.trim()) {
                        setCatalogError('Введите название ДЗ')
                        return
                      }
                      if (builder.items.length === 0) {
                        setCatalogError('Добавьте хотя бы одну задачу из каталога')
                        return
                      }
                      try {
                        const created = await builder.save({
                          templateId: null,
                          courseId,
                          topicId: null,
                          title: catalogTitle.trim(),
                          instructions: '',
                          maxScore: null,
                        })
                        setCatalogFlowOpen(false)
                        setCatalogTitle('')
                        setCatalogError(null)
                        setPickingGroupFor({
                          id: created.template_id,
                          title: catalogTitle.trim(),
                          topic_id: null,
                          status: 'draft',
                          latest_version_id: created.template_version_id,
                          latest_version: created.version,
                          items_count: builder.items.length,
                          assignments_count: 0,
                          last_assigned_at: null,
                        })
                      } catch (e: any) {
                        setCatalogError(e?.message || 'Не удалось создать шаблон ДЗ')
                      }
                    }}
                  >
                    <Send size={15} className="mr-1.5" />
                    Далее к назначению
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {pickingGroupFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPickingGroupFor(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm z-10 p-6 space-y-3">
            <h3 className="font-bold text-gray-900">Выберите группу</h3>
            {groups.length === 0 ? (
              <p className="text-sm text-gray-400">У курса нет активных групп</p>
            ) : groups.map(g => (
              <button key={g.id} onClick={() => { setAssignTarget({ templateVersionId: pickingGroupFor.latest_version_id, groupId: g.id, students: g.students }); setPickingGroupFor(null) }}
                className="w-full text-left px-3 py-2 rounded-xl border border-gray-200 hover:border-primary-300 hover:bg-primary-50/40 transition-colors text-sm">
                {g.name} <span className="text-gray-400">({g.students.length} уч.)</span>
              </button>
            ))}
            <Button variant="secondary" className="w-full" onClick={() => setPickingGroupFor(null)}>Отмена</Button>
          </div>
        </div>
      )}

      {assignTarget && (
        <AssignHomeworkTemplateModal
          open
          onClose={() => setAssignTarget(null)}
          onAssigned={() => { setAssignTarget(null); reload(); reloadSummary() }}
          courseId={courseId}
          groupId={assignTarget.groupId}
          students={assignTarget.students}
          preselectedTemplateVersionId={assignTarget.templateVersionId}
        />
      )}
    </div>
  )
}

function SummaryTile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={warn ? 'bg-red-50 rounded-lg p-2.5' : 'bg-gray-50 rounded-lg p-2.5'}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={warn ? 'text-lg font-bold text-red-600' : 'text-lg font-bold text-gray-900'}>{value}</div>
    </div>
  )
}

function ChooserOption({
  icon,
  title,
  description,
  disabled = false,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
        disabled
          ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400'
          : 'border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50/40',
      ].join(' ')}
    >
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
        <div className="mt-0.5 text-xs text-gray-500">{description}</div>
      </div>
      <div className="shrink-0">
        {disabled ? (
          <span className="rounded-full bg-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500">Скоро</span>
        ) : (
          <ChevronRight size={16} className="text-gray-400" />
        )}
      </div>
    </button>
  )
}

function TemplateCard({ template, onAssign }: { template: CourseHomeworkTemplate; onAssign: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 bg-white">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-primary-500 shrink-0" />
          <span className="text-sm font-medium text-gray-900 truncate">{template.title}</span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[template.status]}`}>{STATUS_LABELS[template.status]}</span>
        </div>
        <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
          <span>v{template.latest_version}</span>
          <span>{template.items_count} задач</span>
          <span>{template.assignments_count} назначений</span>
          {template.last_assigned_at && <span>последнее: {formatDate(template.last_assigned_at)}</span>}
        </div>
      </div>
      <Button size="sm" onClick={onAssign}><Send size={13} className="mr-1" />Назначить группе</Button>
    </div>
  )
}
