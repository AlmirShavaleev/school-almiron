import { useEffect, useState } from 'react'
import { X, ClipboardList, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { useHomeworkTemplates } from '@/hooks/useHomeworkTemplates'
import { useAssignHomeworkV2 } from '@/hooks/useAssignHomeworkV2'
import type { GroupStudent } from '@/hooks/useGroupControl'

interface Props {
  open: boolean
  onClose: () => void
  onAssigned: () => void
  courseId: string | null
  groupId: string
  students: GroupStudent[]
  /** Pre-selects a template version (e.g. just saved by the Template Builder) so the
   * teacher doesn't have to find it again in the "existing template" dropdown. */
  preselectedTemplateVersionId?: string
}

export function AssignHomeworkTemplateModal({ open, onClose, onAssigned, courseId, groupId, students, preselectedTemplateVersionId }: Props) {
  const { templates, loading: loadingTemplates, createTemplate } = useHomeworkTemplates(open ? courseId : null)
  const { assign, submitting, error: assignError } = useAssignHomeworkV2()

  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [templateVersionId, setTemplateVersionId] = useState(preselectedTemplateVersionId || '')
  const [newTitle, setNewTitle] = useState('')
  const [newInstructions, setNewInstructions] = useState('')
  const [newMaxScore, setNewMaxScore] = useState('100')

  const [targetMode, setTargetMode] = useState<'group' | 'students'>('group')
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([])

  const [publishNow, setPublishNow] = useState(true)
  const [publishAt, setPublishAt] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [maxAttempts, setMaxAttempts] = useState('')
  const [allowLate, setAllowLate] = useState(true)
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)
  const [formError, setFormError] = useState('')
  const hasStudents = students.length > 0

  useEffect(() => {
    if (open && preselectedTemplateVersionId) { setMode('existing'); setTemplateVersionId(preselectedTemplateVersionId) }
  }, [open, preselectedTemplateVersionId])

  function toggleStudent(id: string) {
    setSelectedStudentIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleSubmit() {
    setFormError('')
    let versionId = templateVersionId
    if (mode === 'new') {
      if (!newTitle.trim()) { setFormError('Введите название шаблона'); return }
      try {
        const created = await createTemplate({
          title: newTitle.trim(),
          instructions: newInstructions.trim() || undefined,
          maxScore: newMaxScore ? Number(newMaxScore) : undefined,
        })
        versionId = created.template_version_id
      } catch (e: any) {
        setFormError(e?.message || 'Не удалось создать шаблон')
        return
      }
    }
    if (!versionId) { setFormError('Выберите шаблон ДЗ'); return }
    if (!hasStudents) { setFormError('В этой группе пока нет учеников'); return }
    if (!dueAt) { setFormError('Укажите дедлайн'); return }
    if (!publishNow && !publishAt) { setFormError('Укажите дату публикации или выберите «сейчас»'); return }
    if (targetMode === 'students' && selectedStudentIds.length === 0) { setFormError('Выберите хотя бы одного ученика'); return }

    try {
      await assign({
        templateVersionId: versionId,
        groupId,
        studentIds: targetMode === 'group' ? null : selectedStudentIds,
        publishNow,
        publishAt: publishNow ? null : new Date(publishAt).toISOString(),
        dueAt: new Date(dueAt).toISOString(),
        maxAttempts: maxAttempts ? Number(maxAttempts) : null,
        allowLate,
      })
      onAssigned()
      onClose()
    } catch {
      // assignError already set by the hook
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-xl flex items-center justify-center">
              <ClipboardList size={20} className="text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Назначить ДЗ</h2>
              <p className="text-xs text-gray-500">Шаблон + группа/ученики + сроки</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          {!preselectedTemplateVersionId && (
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode('existing')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border ${mode === 'existing' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                Существующий шаблон
              </button>
              <button type="button" onClick={() => setMode('new')}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border ${mode === 'new' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                Новый шаблон
              </button>
            </div>
          )}

          {mode === 'existing' ? (
            loadingTemplates ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" />Загрузка шаблонов…</div>
            ) : (
              <Select
                label="Шаблон ДЗ *"
                value={templateVersionId}
                onChange={e => setTemplateVersionId(e.target.value)}
                options={[{ value: '', label: templates.length ? '— выберите шаблон —' : 'Нет шаблонов в этом курсе' },
                  ...templates.map(t => ({ value: t.latest_version_id, label: `${t.title} (v${t.latest_version})` }))]}
              />
            )
          ) : (
            <>
              <Input label="Название шаблона *" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Инструкции</label>
                <textarea rows={2} value={newInstructions} onChange={e => setNewInstructions(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
              </div>
              <Input label="Максимальный балл" type="number" min={1} value={newMaxScore} onChange={e => setNewMaxScore(e.target.value)} />
            </>
          )}

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-gray-900">Кому назначить</h3>
              <p className="mt-1 text-xs text-gray-500">Выберите всю группу или только конкретных учеников.</p>
            </div>
            {hasStudents ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setTargetMode('group')}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border ${targetMode === 'group' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                    Вся группа ({students.length})
                  </button>
                  <button type="button" onClick={() => setTargetMode('students')}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border ${targetMode === 'students' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                    Отдельные ученики
                  </button>
                </div>

                {targetMode === 'students' && (
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white divide-y">
                    {students.map(s => (
                      <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={selectedStudentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} />
                        {s.full_name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-4 text-sm text-gray-500">
                В этой группе пока нет учеников
              </p>
            )}
          </div>

          <Input label="Дедлайн *" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />

          <div className="rounded-2xl border border-gray-200">
            <button
              type="button"
              onClick={() => setShowAdvancedSettings(value => !value)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700"
            >
              <span>Дополнительные настройки</span>
              {showAdvancedSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showAdvancedSettings && (
              <div className="space-y-4 border-t border-gray-100 px-4 py-4">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" checked={publishNow} onChange={() => setPublishNow(true)} />Опубликовать сейчас
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="radio" checked={!publishNow} onChange={() => setPublishNow(false)} />Запланировать
                  </label>
                </div>
                {!publishNow && (
                  <Input label="Дата публикации *" type="datetime-local" value={publishAt} onChange={e => setPublishAt(e.target.value)} />
                )}
                <Input label="Максимум попыток (пусто = без ограничения)" type="number" min={1} value={maxAttempts} onChange={e => setMaxAttempts(e.target.value)} />
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={allowLate} onChange={e => setAllowLate(e.target.checked)} />
                  Разрешить сдачу после дедлайна
                </label>
              </div>
            )}
          </div>

          {(formError || (hasStudents ? assignError : null)) && (
            <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{formError || assignError}</p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1">Отмена</Button>
            <Button type="button" loading={submitting} onClick={handleSubmit} className="flex-1" disabled={!hasStudents}>
              Назначить {targetMode === 'group' ? students.length : selectedStudentIds.length} ученикам
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
