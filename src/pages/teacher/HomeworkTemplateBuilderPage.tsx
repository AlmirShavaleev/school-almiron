import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, FileText, Eye, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useHomeworkTemplateBuilder } from '@/hooks/useHomeworkTemplateBuilder'
import { HomeworkCatalogTaskPicker } from '@/components/modals/HomeworkCatalogTaskPicker'
import { HomeworkTemplateItemEditor } from '@/components/modals/HomeworkTemplateItemEditor'
import { AssignHomeworkTemplateModal } from '@/components/modals/AssignHomeworkTemplateModal'
import { VariantPrintPanel } from '@/components/pdf/VariantPrintPanel'
import type { PrintableItem } from '@/utils/variantPrintUtils'
import type { GroupStudent } from '@/hooks/useGroupControl'

/** Writes only to homework_templates/homework_template_versions/homework_template_items/
 * homework_template_files via create_or_update_template_draft. Never touches task_collections
 * or legacy homeworks — the catalog picker below only ever reads catalog_tasks. */
export function HomeworkTemplateBuilderPage() {
  const navigate = useNavigate()
  const profile = useAuthStore(s => s.profile)
  const [searchParams] = useSearchParams()
  const prefillCourseId = searchParams.get('courseId') || ''
  const prefillTopicId = searchParams.get('topicId') || ''

  const [courses, setCourses] = useState<{ id: string; title: string; subject: string; exam_type: string }[]>([])
  const [courseId, setCourseId] = useState(prefillCourseId)
  const [topicId] = useState(prefillTopicId || null)
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [savedVersion, setSavedVersion] = useState<{ template_id: string; template_version_id: string; version: number } | null>(null)
  const [groups, setGroups] = useState<{ id: string; name: string; course_id: string; students: GroupStudent[] }[]>([])
  const [assignGroup, setAssignGroup] = useState<{ id: string; students: GroupStudent[] } | null>(null)

  const builder = useHomeworkTemplateBuilder()

  useEffect(() => {
    if (!profile) return
    ;(async () => {
      if (profile.role === 'teacher') {
        const { data: tc } = await supabase.from('teachers').select('id').eq('profile_id', profile.id).single()
        const { data: gs } = await supabase.from('groups').select('course_id').eq('teacher_id', tc?.id || '')
        const cids = [...new Set((gs || []).map((g: any) => g.course_id).filter(Boolean))]
        const { data: cs } = await supabase.from('courses').select('id, title, subject, exam_type').in('id', cids.length ? cids : ['00000000-0000-0000-0000-000000000000'])
        setCourses(cs || [])
      } else {
        const { data: cs } = await supabase.from('courses').select('id, title, subject, exam_type').order('title')
        setCourses(cs || [])
      }
    })()
  }, [profile])

  useEffect(() => {
    if (!courseId || !profile) { setGroups([]); return }
    ;(async () => {
      const { data: gs } = await supabase.from('groups').select('id, name, course_id, group_students(student_id, students(id, profile_id, profiles(full_name, avatar_url), profile_id))').eq('course_id', courseId).eq('is_active', true)
      const mapped = (gs || []).map((g: any) => ({
        id: g.id, name: g.name, course_id: g.course_id,
        students: (g.group_students || []).map((row: any) => ({
          id: row.students?.id, profile_id: row.students?.profile_id,
          full_name: row.students?.profiles?.full_name || '—', email: '', avatar_url: row.students?.profiles?.avatar_url ?? null,
        })).filter((s: any) => s.id),
      }))
      setGroups(mapped)
    })()
  }, [courseId, profile, savedVersion])

  const course = courses.find(c => c.id === courseId)

  const printItems: PrintableItem[] = useMemo(
    () => builder.items.map(it => ({ id: it.key, customNumber: it.custom_number || null, task: it.task })),
    [builder.items]
  )

  async function handleSave() {
    if (!courseId) { return }
    if (!title.trim()) { return }
    const result = await builder.save({ templateId: null, courseId, topicId, title: title.trim(), instructions, maxScore: null })
    setSavedVersion(result)
  }

  return (
    <div className="space-y-6">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-graphite-950">
        <ArrowLeft size={15} />Назад
      </button>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Конструктор шаблона ДЗ</h1>
        <p className="text-gray-500 mt-1">Соберите задания из каталога, настройте проверку, назначьте группе</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Основное</CardTitle></CardHeader>
        <div className="space-y-3">
          <Select label="Курс *" value={courseId} onChange={e => setCourseId(e.target.value)} disabled={!!prefillCourseId}
            options={[{ value: '', label: '— выберите курс —' }, ...courses.map(c => ({ value: c.id, label: c.title }))]} />
          {topicId && <p className="text-xs text-primary-600 -mt-2">Шаблон будет привязан к теме курса</p>}
          <Input label="Название *" value={title} onChange={e => setTitle(e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Инструкции</label>
            <textarea rows={3} value={instructions} onChange={e => setInstructions(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
          </div>
        </div>
      </Card>

      {courseId && (
        <>
          <Card>
            <CardHeader><CardTitle>Задачи из каталога</CardTitle></CardHeader>
            <HomeworkCatalogTaskPicker onAdd={builder.addTask} isSelected={builder.isSelected} />
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Выбранные задания</CardTitle>
              <span className="text-sm text-gray-400">{builder.items.length}</span>
            </CardHeader>
            {builder.items.length === 0 ? (
              <p className="text-center text-gray-400 py-6 text-sm">Добавьте задачи выше</p>
            ) : (
              <div className="space-y-2">
                {builder.items.map((it, idx) => (
                  <HomeworkTemplateItemEditor
                    key={it.key} item={it} index={idx} count={builder.items.length}
                    onMove={dir => builder.moveItem(idx, dir)}
                    onRemove={() => builder.removeTask(it.catalog_task_id)}
                    onUpdate={patch => builder.updateItem(it.catalog_task_id, patch)}
                  />
                ))}
              </div>
            )}
          </Card>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowPreview(true)} disabled={builder.items.length === 0}>
              <Eye size={15} className="mr-1.5" />Просмотр PDF
            </Button>
            <Button loading={builder.saving} onClick={handleSave} disabled={!title.trim()}>
              <FileText size={15} className="mr-1.5" />Сохранить {savedVersion ? `(v${savedVersion.version} сохранена)` : 'черновик'}
            </Button>
          </div>
          {builder.error && <p className="text-sm text-red-500 bg-red-50 p-3 rounded-lg">{builder.error}</p>}
        </>
      )}

      {savedVersion && (
        <Card>
          <CardHeader><CardTitle>Назначить группе</CardTitle></CardHeader>
          {groups.length === 0 ? (
            <p className="text-sm text-gray-400">У курса нет активных групп</p>
          ) : (
            <div className="space-y-2">
              {groups.map(g => (
                <div key={g.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-xl">
                  <span className="text-sm font-medium">{g.name} ({g.students.length} уч.)</span>
                  <Button size="sm" onClick={() => setAssignGroup({ id: g.id, students: g.students })}>Назначить</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {showPreview && course && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowPreview(false)} />
          <div className="relative z-10 flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,.08)]">
              <h2 className="font-semibold text-gray-900">Просмотр PDF</h2>
              <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:bg-gray-100 rounded-lg p-2"><X size={18} /></button>
            </div>
            <div className="overflow-auto p-2 sm:p-4">
              <VariantPrintPanel items={printItems} subject={course.subject} examType={course.exam_type} initialTitle={title || 'Домашнее задание'} />
            </div>
          </div>
        </div>
      )}

      {assignGroup && savedVersion && (
        <AssignHomeworkTemplateModal
          open onClose={() => setAssignGroup(null)}
          onAssigned={() => setAssignGroup(null)}
          courseId={courseId}
          groupId={assignGroup.id}
          students={assignGroup.students}
          preselectedTemplateVersionId={savedVersion.template_version_id}
        />
      )}

    </div>
  )
}
