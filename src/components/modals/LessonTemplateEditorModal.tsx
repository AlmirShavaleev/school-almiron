import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ClipboardList, Link as LinkIcon, Loader2, Trash2, Upload, Video, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import { useCatalogSections, useCatalogTopics, useCatalogTasks, useCatalogTasksBatch, EXAM_FROM_SLUG, SUBJECT_FROM_SLUG } from '@/hooks/useCatalog'
import { useLessonTemplate } from '@/hooks/useLessonLibrary'
import { supabase } from '@/lib/supabase'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'
import { getMaterialFileIcon } from '@/lib/materialIcons'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import type { LessonTemplate, LessonTemplateExam, LessonTemplateMaterialType, LessonTemplateSubject } from '@/types/lessonLibrary'

const SECTIONS: Array<{
  type: LessonTemplateMaterialType
  label: string
  color: string
  hasText: boolean
  hasFile: boolean
  isSpecial?: 'video' | 'link'
}> = [
  { type: 'notes', label: 'Конспект', color: 'text-blue-600 bg-blue-50', hasText: true, hasFile: true },
  { type: 'theory', label: 'Теория', color: 'text-violet-600 bg-violet-50', hasText: true, hasFile: true },
  { type: 'tasks', label: 'Список задач', color: 'text-orange-600 bg-orange-50', hasText: false, hasFile: true },
  { type: 'homework', label: 'ДЗ', color: 'text-amber-600 bg-amber-50', hasText: true, hasFile: true },
  { type: 'solution', label: 'Решение ДЗ', color: 'text-emerald-600 bg-emerald-50', hasText: false, hasFile: true },
  { type: 'video', label: 'Видео', color: 'text-rose-600 bg-rose-50', hasText: false, hasFile: false, isSpecial: 'video' },
  { type: 'link', label: 'Ссылка', color: 'text-cyan-700 bg-cyan-50', hasText: false, hasFile: false, isSpecial: 'link' },
]

export function LessonTemplateEditorModal({
  open,
  template,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean
  template: LessonTemplate | null
  onClose: () => void
  onSaved: () => void
  onDeleted: (templateId: string) => Promise<void> | void
}) {
  const { data, loading, error, saveTemplate, materialsByType, saveMaterial, uploadMaterialFile, createLinkMaterial, deleteMaterial, replaceTasks } = useLessonTemplate(open ? template?.id ?? null : null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState<LessonTemplateSubject>('physics')
  const [examType, setExamType] = useState<Exclude<LessonTemplateExam, null> | ''>('ege')
  const [description, setDescription] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [activeSection, setActiveSection] = useState<LessonTemplateMaterialType>('notes')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setTitle(data?.title ?? '')
    setSubject((data?.subject ?? 'physics') as LessonTemplateSubject)
    setExamType((data?.exam_type ?? 'ege') as Exclude<LessonTemplateExam, null> | '')
    setDescription(data?.description ?? '')
  }, [data?.description, data?.exam_type, data?.subject, data?.title])

  if (!open || !template) return null

  async function handleSaveMeta() {
    setSavingMeta(true)
    try {
      await saveTemplate({
        title: title.trim(),
        subject,
        exam_type: examType || null,
        description: description.trim() || null,
      })
      onSaved()
      toast.success('Урок сохранён')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить урок')
    } finally {
      setSavingMeta(false)
    }
  }

  async function handleDeleteTemplate() {
    if (!data) return
    setDeleting(true)
    try {
      const { error: deleteError } = await (supabase as any).from('lesson_templates').delete().eq('id', data.id)
      if (deleteError) throw new Error(deleteError.message)
      await onDeleted(data.id)
      toast.success('Урок удалён')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось удалить урок')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Библиотека уроков</div>
            <h2 className="mt-1 text-xl font-bold text-gray-900">{data?.title ?? template.title}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{SUBJECT_LABELS[data?.subject ?? template.subject]}</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">{EXAM_LABELS[data?.exam_type ?? template.exam_type ?? 'ege'] ?? 'Без экзамена'}</span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{data?.tasks.length ?? 0} задач</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="grid flex-1 min-h-0 grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex min-h-0 flex-col border-b border-gray-100 lg:border-b-0 lg:border-r">
            <div className="border-b border-gray-100 bg-gradient-to-b from-gray-50/70 to-white px-6 py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="text-base font-semibold text-gray-900">Материалы урока</div>
                  <div className="mt-1 text-sm text-gray-500">Сначала выберите тип материала, потом заполните только нужный блок. Интерфейс работает как единый редактор урока, а не как длинная форма.</div>
                </div>
                <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                  {Object.values(materialsByType).filter(Boolean).length} / {SECTIONS.length} заполнено
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                {SECTIONS.map(section => (
                  <button
                    key={section.type}
                    onClick={() => setActiveSection(section.type)}
                    className={cn(
                      'rounded-2xl border px-3 py-3 text-left transition-all',
                      activeSection === section.type
                        ? 'border-primary-300 bg-primary-50 shadow-sm ring-2 ring-primary-100'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                    )}
                  >
                    <div className="text-sm font-semibold text-gray-900">{section.label}</div>
                    <div className="mt-1 text-[11px] text-gray-400">{materialsByType[section.type] ? 'Уже заполнено' : 'Пока пусто'}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {loading ? (
                <div className="flex items-center justify-center py-20 text-gray-400"><Loader2 size={18} className="animate-spin" />Загрузка урока…</div>
              ) : error ? (
                <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-600">{error}</div>
              ) : data ? (
                <TemplateMaterialEditor
                  templateId={data.id}
                  type={activeSection}
                  material={materialsByType[activeSection]}
                  onSave={saveMaterial}
                  onUpload={uploadMaterialFile}
                  onDelete={deleteMaterial}
                  onCreateLink={createLinkMaterial}
                />
              ) : null}
            </div>
          </section>

          <aside className="overflow-y-auto bg-gray-50/70 p-5">
            <div className="space-y-4">
              <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-4">
                  <div className="text-base font-semibold text-gray-900">Параметры урока</div>
                  <div className="mt-1 text-sm text-gray-500">Здесь задаются базовые свойства урока. Эти поля сохраняются вместе с уроком.</div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Название</label>
                    <input value={title} onChange={e => setTitle(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Предмет</label>
                      <select value={subject} onChange={e => setSubject(e.target.value as LessonTemplateSubject)} className="min-h-11 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
                        <option value="physics">Физика</option>
                        <option value="math">Математика</option>
                        <option value="algebra">Алгебра</option>
                        <option value="geometry">Геометрия</option>
                        <option value="probability_statistics">Вероятность и статистика</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Экзамен</label>
                      <select value={examType} onChange={e => setExamType(e.target.value as Exclude<LessonTemplateExam, null> | '')} className="min-h-11 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
                        <option value="ege">ЕГЭ</option>
                        <option value="oge">ОГЭ</option>
                        <option value="grade_7">7 класс</option>
                        <option value="grade_8">8 класс</option>
                        <option value="grade_9">9 класс</option>
                        <option value="grade_10">10 класс</option>
                        <option value="grade_11">11 класс</option>
                        <option value="">Без экзамена</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Описание</label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} placeholder="Коротко опишите, что будет на уроке." className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="text-base font-semibold text-gray-900">Действия</div>
                <div className="mt-1 text-sm text-gray-500">Когда всё готово, сохраните урок. Материалы сохраняются отдельно внутри выбранного блока.</div>
                <Button onClick={handleSaveMeta} loading={savingMeta} className="mt-4 w-full">Сохранить урок</Button>
              </div>

              <div className="rounded-3xl border border-red-200 bg-red-50 p-5">
                <div className="text-sm font-semibold text-red-700">Удалить урок</div>
                <p className="mt-1 text-xs leading-relaxed text-red-500">Удалится только урок из библиотеки. Уже скопированные темы в группах останутся.</p>
                <Button variant="danger" onClick={handleDeleteTemplate} loading={deleting} className="mt-3 w-full">Удалить урок</Button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <TemplateTaskPickerModal
        open={pickerOpen}
        subject={subject}
        examType={examType || null}
        selectedTaskIds={(data?.tasks ?? []).map(item => item.catalog_task_id).filter(Boolean) as string[]}
        onClose={() => setPickerOpen(false)}
        onSave={async (ids) => {
          try {
            await replaceTasks(ids)
            setPickerOpen(false)
            onSaved()
            toast.success('Задачи урока обновлены')
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Не удалось сохранить задачи')
          }
        }}
      />
    </div>
  )
}

function TemplateMaterialEditor({
  templateId,
  type,
  material,
  onSave,
  onUpload,
  onDelete,
  onCreateLink,
}: {
  templateId: string
  type: LessonTemplateMaterialType
  material?: { content: string | null; file_path: string | null; link_url?: string | null; link_meta?: { title: string; url: string } | null }
  onSave: (type: LessonTemplateMaterialType, patch: Record<string, unknown>) => Promise<void>
  onUpload: (type: LessonTemplateMaterialType, file: File, onProgress?: (percent: number) => void) => Promise<string>
  onDelete: (type: LessonTemplateMaterialType) => Promise<void>
  onCreateLink: (title: string, url: string) => Promise<void>
}) {
  const section = SECTIONS.find(item => item.type === type)!
  const [text, setText] = useState(material?.content ?? '')
  const [url, setUrl] = useState(material?.link_url ?? material?.link_meta?.url ?? '')
  const [title, setTitle] = useState(material?.link_meta?.title ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPercent, setUploadPercent] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(material?.content ?? '')
    setUrl(material?.link_url ?? material?.link_meta?.url ?? '')
    setTitle(material?.link_meta?.title ?? '')
  }, [material?.content, material?.link_meta?.title, material?.link_meta?.url, material?.link_url, type])

  const fileName = material?.file_path ? decodeURIComponent(material.file_path.split('/').pop() || 'Файл') : null

  async function saveText() {
    setSaving(true)
    try {
      if (section.isSpecial === 'video') {
        await onSave(type, { link_url: url.trim() || null })
      } else {
        await onSave(type, { content: text.trim() || null })
      }
      toast.success('Материал сохранён')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить материал')
    } finally {
      setSaving(false)
    }
  }

  async function saveLink() {
    setSaving(true)
    try {
      await onCreateLink(title, url)
      toast.success('Ссылка сохранена')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить ссылку')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setUploadPercent(0)
    try {
      const path = await onUpload(type, file, setUploadPercent)
      await onSave(type, { file_path: path })
      toast.success('Файл загружен')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить файл')
    } finally {
      setUploading(false)
      setUploadPercent(0)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex items-start gap-3">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-2xl', section.color)}>
          {section.isSpecial === 'video' ? <Video size={18} /> : section.isSpecial === 'link' ? <LinkIcon size={18} /> : <BookOpen size={18} />}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{section.label}</h3>
          <p className="mt-1 text-sm text-gray-500">
            {section.isSpecial === 'link'
              ? 'Сохраняем metadata в `.link`-маркер lesson-library.'
              : section.isSpecial === 'video'
                ? 'Видео хранится как URL внутри template material.'
                : 'Можно загрузить файл и при необходимости добавить текстовое пояснение.'}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {section.hasText && section.isSpecial !== 'link' && (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={6}
            placeholder="Текст материала..."
            className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
        )}

        {section.isSpecial === 'video' && (
          <div className="space-y-3">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://youtu.be/..."
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            {material?.link_url && (
              <a
                href={material.link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
              >
                <Video size={15} />
                Открыть сохранённое видео
              </a>
            )}
          </div>
        )}

        {section.isSpecial === 'link' && (
          <>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Название ссылки"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://example.com/material"
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            {material?.link_meta && (
              <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
                <div className="text-sm font-semibold text-cyan-800">{material.link_meta.title}</div>
                <div className="mt-1 text-xs text-cyan-600">{material.link_meta.url}</div>
              </div>
            )}
          </>
        )}

        {section.hasFile && (
          material?.file_path ? (
            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              {getMaterialFileIcon(material.file_path)}
              <SignedFileLink bucket="lesson-library" url={material.file_path} className="flex-1 truncate text-sm text-primary-600 hover:underline">
                {fileName || 'Открыть файл'}
              </SignedFileLink>
              <button onClick={() => onDelete(type).catch(e => toast.error(e instanceof Error ? e.message : 'Не удалось удалить файл'))} className="rounded-xl p-2 text-gray-300 transition-colors hover:bg-white hover:text-red-500">
                <Trash2 size={16} />
              </button>
            </div>
          ) : (
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 px-4 py-10 text-gray-400 transition-colors hover:border-primary-300 hover:text-primary-500">
                {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                <span className="text-sm font-medium">{uploading ? 'Загрузка…' : 'Прикрепить файл'}</span>
                {uploading && (
                  <div className="mt-2 w-full max-w-xs">
                    <div className="h-2 overflow-hidden rounded-full bg-primary-100">
                      <div
                        className="h-full rounded-full bg-primary-500 transition-[width] duration-150"
                        style={{ width: `${uploadPercent}%` }}
                      />
                    </div>
                    <div className="mt-2 text-center text-xs text-primary-500">
                      Загружаем PDF в библиотеку уроков… {uploadPercent}%
                    </div>
                  </div>
                )}
              </button>
          )
        )}

        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void handleUpload(file)
          }}
        />

        <div className="flex gap-2">
          <Button onClick={section.isSpecial === 'link' ? saveLink : saveText} loading={saving}>
            Сохранить
          </Button>
          {(material?.content || material?.file_path || material?.link_meta || material?.link_url) && (
            <Button
              variant="secondary"
              onClick={() => onDelete(type).then(() => toast.success('Материал очищен')).catch(e => toast.error(e instanceof Error ? e.message : 'Не удалось очистить материал'))}
            >
              Очистить
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateTaskPickerModal({
  open,
  subject,
  examType,
  selectedTaskIds,
  onClose,
  onSave,
}: {
  open: boolean
  subject: LessonTemplateSubject
  examType: LessonTemplateExam
  selectedTaskIds: string[]
  onClose: () => void
  onSave: (ids: string[]) => Promise<void>
}) {
  const subjectLabel = SUBJECT_FROM_SLUG[subject] ?? 'Физика'
  const examLabel = examType ? (EXAM_FROM_SLUG[examType] ?? 'ЕГЭ') : undefined
  const { sections, loading: loadingSections } = useCatalogSections(subjectLabel, examLabel)
  const [sectionId, setSectionId] = useState<string>('')
  const { topics, loading: loadingTopics } = useCatalogTopics(sectionId || undefined)
  const [topicId, setTopicId] = useState<string>('')
  const { tasks, loading: loadingTasks } = useCatalogTasks(topicId || undefined)
  const [picked, setPicked] = useState<string[]>(selectedTaskIds)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (sections.length && !sectionId) setSectionId(sections[0].id)
  }, [sectionId, sections])

  useEffect(() => {
    setTopicId(topics[0]?.id ?? '')
  }, [sectionId, topics])

  useEffect(() => {
    setPicked(selectedTaskIds)
  }, [selectedTaskIds])

  if (!open) return null

  function toggleTask(id: string) {
    setPicked(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Прикрепить задачи</h3>
            <p className="text-sm text-gray-500">Каталог фильтруется по предмету урока. Выбор сохраняется как `lesson_template_tasks`.</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_1fr_320px]">
          <div className="overflow-y-auto border-r border-gray-100 bg-gray-50/80 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Разделы</div>
            <div className="mt-3 space-y-2">
              {loadingSections ? <div className="text-sm text-gray-400">Загрузка…</div> : sections.map(section => (
                <button key={section.id} onClick={() => setSectionId(section.id)} className={cn('w-full rounded-2xl border px-3 py-3 text-left transition-colors', sectionId === section.id ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300')}>
                  <div className="text-sm font-semibold">{section.title}</div>
                  <div className="mt-1 text-xs text-gray-400">№ {section.external_id}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">Темы</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {loadingTopics ? <span className="text-sm text-gray-400">Загрузка тем…</span> : topics.map(topic => (
                    <button key={topic.id} onClick={() => setTopicId(topic.id)} className={cn('rounded-full border px-3 py-1.5 text-xs font-medium transition-colors', topicId === topic.id ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300')}>
                      {topic.title}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">{picked.length} выбрано</div>
            </div>

            <div className="space-y-3">
              {loadingTasks ? <div className="text-sm text-gray-400">Загрузка задач…</div> : tasks.map((task, index) => (
                <div key={task.id} className="relative">
                  <TaskDisplayCard
                    task={task}
                    number={index + 1}
                    extraActions={(
                      <button onClick={() => toggleTask(task.id)} className={cn('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors', picked.includes(task.id) ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-gray-100 text-gray-700 hover:bg-primary-50 hover:text-primary-700')}>
                        {picked.includes(task.id) ? <Check size={14} /> : <ClipboardList size={14} />}
                        {picked.includes(task.id) ? 'Выбрано' : 'Добавить'}
                      </button>
                    )}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-y-auto border-l border-gray-100 bg-gray-50/70 p-4">
            <div className="text-sm font-semibold text-gray-900">Корзина урока</div>
            <SelectedTasksList taskIds={picked} />
            <Button
              className="mt-4 w-full"
              loading={saving}
              onClick={async () => {
                setSaving(true)
                try { await onSave(picked) } finally { setSaving(false) }
              }}
            >
              Сохранить задачи
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SelectedTasksList({ taskIds }: { taskIds: string[] }) {
  const { tasks, loading } = useCatalogTasksBatch(taskIds)
  const ordered = useMemo(() => {
    const byId = new Map(tasks.map(task => [task.id, task]))
    return taskIds.map(id => byId.get(id)).filter(Boolean)
  }, [taskIds, tasks])

  if (!taskIds.length) {
    return <p className="mt-3 rounded-2xl bg-gray-50 p-3 text-sm text-gray-400">Задач пока нет</p>
  }

  if (loading) {
    return <p className="mt-3 text-sm text-gray-400">Загрузка задач…</p>
  }

  return (
    <div className="mt-3 space-y-2">
      {ordered.map((task, index) => task ? (
        <div key={task.id} className="rounded-2xl border border-gray-200 bg-white p-3">
          <div className="text-xs font-semibold text-gray-400">Задача {index + 1}</div>
          <div className="mt-1 text-sm font-medium text-gray-800">#{task.external_id}</div>
          <div className="mt-1 text-xs text-gray-500">{task.section?.title ?? 'Каталог'}</div>
        </div>
      ) : null)}
    </div>
  )
}
