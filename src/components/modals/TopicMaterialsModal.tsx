import { useState, useRef, useEffect } from 'react'
import {
  X, FileText, Link, Upload, Loader2, Check, Trash2,
  BookOpen, ClipboardList, Video, Lightbulb, GraduationCap, BookMarked,
  Calendar, Clock, Lock,
} from 'lucide-react'
import { useTopicMaterials, type MaterialType } from '@/hooks/useTopicMaterials'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { cn } from '@/utils/cn'
import { getMaterialFileIcon } from '@/lib/materialIcons'
import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'
import { TopicHomeworkEditor } from '@/components/courseProgram/TopicHomeworkEditor'
import { TopicTestEditor } from '@/components/courseProgram/TopicTestEditor'

const SECTIONS: {
  type: MaterialType
  label: string
  icon: React.ReactNode
  color: string
  hasText: boolean
  hasFile: boolean
  textHint: string
}[] = [
  { type: 'notes', label: 'Конспект', icon: <BookMarked size={16} />, color: 'text-blue-600 bg-blue-50', hasText: true, hasFile: true, textHint: 'Краткий конспект темы, ключевые формулы, определения…' },
  { type: 'theory', label: 'Теория', icon: <BookOpen size={16} />, color: 'text-purple-600 bg-purple-50', hasText: true, hasFile: true, textHint: 'Подробное теоретическое объяснение…' },
  { type: 'tasks', label: 'Список задач', icon: <ClipboardList size={16} />, color: 'text-orange-600 bg-orange-50', hasText: false, hasFile: true, textHint: '' },
  { type: 'homework', label: 'ДЗ', icon: <Lightbulb size={16} />, color: 'text-yellow-600 bg-yellow-50', hasText: true, hasFile: true, textHint: 'Условие домашнего задания…' },
  { type: 'solution', label: 'Решение ДЗ', icon: <Check size={16} />, color: 'text-green-600 bg-green-50', hasText: false, hasFile: true, textHint: '' },
  { type: 'video', label: 'Видео', icon: <Video size={16} />, color: 'text-red-600 bg-red-50', hasText: false, hasFile: false, textHint: '' },
  { type: 'link', label: 'Ссылка', icon: <Link size={16} />, color: 'text-cyan-700 bg-cyan-50', hasText: false, hasFile: false, textHint: '' },
]

function SectionEditor({
  section,
  canEdit,
  material,
  onSave,
  onUpload,
  onDelete,
  onCreateLink,
}: {
  section: typeof SECTIONS[0]
  canEdit: boolean
  material?: { content: string | null; file_url: string | null; link_url: string | null; link_meta?: { title: string; url: string } | null }
  onSave: (type: MaterialType, patch: any) => Promise<void>
  onUpload: (type: MaterialType, file: File) => Promise<string>
  onDelete: (type: MaterialType) => Promise<void>
  onCreateLink: (title: string, url: string) => Promise<void>
}) {
  const [text, setText] = useState(material?.content || '')
  const [link, setLink] = useState(material?.link_url || material?.link_meta?.url || '')
  const [linkTitle, setLinkTitle] = useState(material?.link_meta?.title || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fileErr, setFileErr] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(material?.content || '')
    setLink(material?.link_url || material?.link_meta?.url || '')
    setLinkTitle(material?.link_meta?.title || '')
  }, [material?.content, material?.link_url, material?.link_meta?.title, material?.link_meta?.url])

  async function handleSaveText() {
    if (!canEdit) return
    setSaving(true)
    try {
      await onSave(section.type, {
        content: text.trim() || null,
        link_url: link.trim() || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveLink() {
    if (!canEdit) return
    setSaving(true)
    try {
      await onCreateLink(linkTitle, link)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) {
      setFileErr('Файл слишком большой (макс. 50 МБ)')
      return
    }
    setFileErr('')
    setUploading(true)
    try {
      const url = await onUpload(section.type, file)
      await onSave(section.type, { file_url: url })
    } catch (e: any) {
      setFileErr(e.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const fileName = material?.file_url
    ? decodeURIComponent(material.file_url.split('/').pop() || 'Файл').split('?')[0]
    : null

  const isVideo = section.type === 'video'
  const isLink = section.type === 'link'
  const ytEmbed = getYouTubeEmbed(link)

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="space-y-4">
          {section.hasText && text && (
            <div className="text-sm text-gray-700 bg-gray-50 rounded-xl p-4 whitespace-pre-wrap leading-relaxed">
              {text}
            </div>
          )}

          {section.hasFile && material?.file_url && (
            <SignedFileLink
              bucket="course-materials"
              url={material.file_url}
              className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
            >
              {getMaterialFileIcon(material.file_url)}
              <span className="text-sm text-blue-700 truncate">{fileName || 'Открыть файл'}</span>
            </SignedFileLink>
          )}

          {!isVideo && !isLink && link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:underline">
              <Link size={13} />{link}
            </a>
          )}

          {isLink && material?.link_meta && (
            <a href={material.link_meta.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-cyan-50 border border-cyan-200 rounded-xl hover:bg-cyan-100 transition-colors">
              <Link size={18} className="text-cyan-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-cyan-800 font-medium truncate">{material.link_meta.title}</div>
                <div className="text-xs text-cyan-600 truncate">{material.link_meta.url}</div>
              </div>
            </a>
          )}

          {isVideo && link && (
            ytEmbed ? (
              <div className="rounded-xl overflow-hidden aspect-video bg-black">
                <iframe
                  src={ytEmbed}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:underline">
                <Link size={13} />{link}
              </a>
            )
          )}

          {!text && !material?.file_url && !link && !material?.link_meta && (
            <div className="text-sm text-gray-400 italic text-center py-6">Материал ещё не добавлен</div>
          )}
        </div>
      )}

      {canEdit && (
        <div className="space-y-4">
          {isVideo && (
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <Link size={11} />Ссылка на видео (YouTube / Vimeo / RuTube)
              </label>
              <input
                type="url"
                value={link}
                onChange={e => setLink(e.target.value)}
                placeholder="https://youtu.be/..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {ytEmbed && (
                <div className="mt-3 rounded-xl overflow-hidden aspect-video bg-black">
                  <iframe
                    src={ytEmbed}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}
            </div>
          )}

          {isLink && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Название ссылки</label>
                <input
                  type="text"
                  value={linkTitle}
                  onChange={e => setLinkTitle(e.target.value)}
                  placeholder="Например: Формулы по кинематике"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Link size={11} />URL
                </label>
                <input
                  type="url"
                  value={link}
                  onChange={e => setLink(e.target.value)}
                  placeholder="https://example.com/material"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
              {material?.link_meta && (
                <div className="flex items-center gap-3 p-4 bg-cyan-50 border border-cyan-200 rounded-xl">
                  <Link size={18} className="text-cyan-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-cyan-800 truncate">{material.link_meta.title}</div>
                    <div className="text-xs text-cyan-600 truncate">{material.link_meta.url}</div>
                  </div>
                  <button onClick={() => onDelete(section.type)} className="text-cyan-300 hover:text-red-500 transition-colors shrink-0 p-1">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          )}

          {!isVideo && !isLink && section.hasFile && (
            <div>
              {material?.file_url ? (
                <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-xl">
                  {getMaterialFileIcon(material.file_url)}
                  <SignedFileLink bucket="course-materials" url={material.file_url} className="flex-1 text-sm text-primary-600 hover:underline truncate">
                    {fileName || 'Открыть файл'}
                  </SignedFileLink>
                  <button onClick={() => onDelete(section.type)} className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-1">
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex flex-col items-center justify-center gap-2 py-10 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors"
                >
                  {uploading ? (
                    <><Loader2 size={22} className="animate-spin" /><span className="text-sm">Загрузка…</span></>
                  ) : (
                    <><Upload size={22} /><span className="text-sm font-medium">Прикрепить файл</span><span className="text-xs">PDF, DOCX, PPTX, изображение · до 50 МБ</span></>
                  )}
                </button>
              )}
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg" onChange={handleFileChange} />
              {fileErr && <p className="text-xs text-red-500 mt-1">{fileErr}</p>}
            </div>
          )}
        </div>
      )}

      {canEdit && (isVideo || isLink) && (
        <div className="flex items-center gap-3 pt-1">
          <Button size="sm" onClick={isLink ? handleSaveLink : handleSaveText} loading={saving}>
            Сохранить ссылку
          </Button>
          {saved && (
            <span className="text-xs text-green-600 font-medium flex items-center gap-1">
              <Check size={13} />Сохранено
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function StudentView({
  materials,
  loading,
  lessonDate,
  hwDeadline,
  hwStatus,
  hwScore,
  hwMax,
}: {
  materials: ReturnType<typeof import('@/hooks/useTopicMaterials').useTopicMaterials>['materials']
  loading: boolean
  topicTitle: string
  moduleTitle: string
  lessonDate?: string | null
  hwDeadline?: string | null
  hwStatus?: string | null
  hwScore?: number | null
  hwMax?: number | null
}) {
  const solutionLocked = hwStatus !== 'checked'
  const videoMat = materials.video
  const videoLink = videoMat?.link_url || ''
  const ytEmbed = getYouTubeEmbed(videoLink)
  const fileSections = SECTIONS.filter(s => s.type !== 'video')

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400 gap-2"><Loader2 size={22} className="animate-spin" />Загрузка материалов…</div>
  }

  return (
    <div className="space-y-0">
      {(lessonDate || hwDeadline || hwStatus) && (
        <div className="flex items-center gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs flex-wrap gap-y-1.5">
          {lessonDate && <span className="flex items-center gap-1.5 text-gray-500"><Calendar size={12} className="text-primary-400" />Занятие: <span className="font-medium text-gray-700">{new Date(lessonDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></span>}
          {hwDeadline && <span className="flex items-center gap-1.5 text-gray-500"><Clock size={12} className="text-orange-400" />Сдать до: <span className="font-medium text-gray-700">{new Date(hwDeadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></span>}
          {hwStatus === 'checked' && hwScore != null && <span className="flex items-center gap-1.5 font-medium text-green-600"><Check size={12} />Балл: {hwScore}/{hwMax}</span>}
          {hwStatus === 'submitted' && <span className="flex items-center gap-1.5 text-blue-500"><Clock size={12} />На проверке</span>}
          {hwStatus === 'revision' && <span className="flex items-center gap-1.5 text-orange-500">На доработке</span>}
        </div>
      )}

      {videoLink && (
        <div className="px-0 pt-0">
          {ytEmbed ? (
            <div className="aspect-video bg-black">
              <iframe src={ytEmbed} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          ) : (
            <div className="mx-6 mt-4 mb-0">
              <a href={videoLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center shrink-0"><Video size={20} className="text-white" /></div>
                <div>
                  <div className="text-sm font-medium text-red-700">Смотреть видео</div>
                  <div className="text-xs text-red-400 truncate max-w-xs">{videoLink}</div>
                </div>
              </a>
            </div>
          )}
        </div>
      )}

      <div className="px-6 py-5 space-y-3">
        {!videoLink && <div className="text-xs text-gray-400 text-center py-4 flex flex-col items-center gap-2"><Video size={28} className="text-gray-200" />Видео для этой темы не добавлено</div>}

        <div className="grid grid-cols-1 gap-2">
          {fileSections.map(s => {
            const mat = materials[s.type]
            const hasFile = !!mat?.file_url
            const hasContent = !!mat?.content
            const hasLink = !!mat?.link_url
            const hasLinkMeta = !!mat?.link_meta
            const isLocked = s.type === 'solution' && solutionLocked
            const available = hasFile || hasContent || hasLink || hasLinkMeta
            if (!available && !isLocked) return null

            if (isLocked) {
              return (
                <div key={s.type} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 opacity-60">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', s.color)}><Lock size={14} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-400">{s.label}</div>
                    <div className="text-xs text-gray-400">Станет доступно после проверки ДЗ</div>
                  </div>
                </div>
              )
            }

            if (s.type === 'link' && mat?.link_meta) {
              return (
                <a key={s.type} href={mat.link_meta.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-sm border-cyan-200 hover:border-cyan-300 bg-white hover:bg-cyan-50">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', s.color)}>{s.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800">{mat.link_meta.title}</div>
                    <div className="text-xs text-gray-400 truncate">{mat.link_meta.url}</div>
                  </div>
                  <Link size={15} className="text-cyan-400 shrink-0" />
                </a>
              )
            }

            if (hasFile) {
              return (
                <SignedFileLink key={s.type} bucket="course-materials" url={mat!.file_url!} className="flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-sm border-gray-200 hover:border-primary-300 bg-white hover:bg-gray-50">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', s.color)}>{s.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800">{s.label}</div>
                    <div className="text-xs text-gray-400 truncate">{decodeURIComponent(mat!.file_url!.split('/').pop() || '').split('?')[0]}</div>
                  </div>
                  {getMaterialFileIcon(mat!.file_url!)}
                </SignedFileLink>
              )
            }

            if (hasContent) return <ContentButton key={s.type} section={s} content={mat!.content!} />
            return null
          })}
        </div>

        {!videoLink && fileSections.every(s => {
          const mat = materials[s.type]
          return !mat?.file_url && !mat?.content && !mat?.link_url && !mat?.link_meta
        }) && <div className="text-center py-8 text-gray-400 text-sm">Материалы к этой теме ещё не добавлены</div>}
      </div>
    </div>
  )
}

function ContentButton({ section, content }: { section: typeof SECTIONS[0]; content: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left">
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', section.color)}>{section.icon}</div>
        <span className="flex-1 text-sm font-semibold text-gray-800">{section.label}</span>
        <BookOpen size={14} className={cn('shrink-0 transition-transform', open ? 'rotate-180 text-primary-500' : 'text-gray-300')} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 bg-gray-50 border-t border-gray-100 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{content}</div>}
    </div>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  topicId: string | null
  topicTitle: string
  moduleTitle: string
  availableFrom?: string | null
  onSaveTopicMeta?: (values: { available_from: string | null }) => Promise<void>
  lessonDate?: string | null
  hwDeadline?: string | null
  hwStatus?: string | null
  hwScore?: number | null
  hwMax?: number | null
}

export function TopicMaterialsModal({ open, onClose, topicId, topicTitle, moduleTitle, availableFrom = null, onSaveTopicMeta, lessonDate, hwDeadline, hwStatus, hwScore, hwMax }: Props) {
  const profile = useAuthStore(s => s.profile)
  const canEdit = !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)
  const [activeTab, setActiveTab] = useState<MaterialType>('notes')
  const [dateVal, setDateVal] = useState(availableFrom || '')
  const [savingDate, setSavingDate] = useState(false)
  const { materials, loading, saveMaterial, uploadFile, createLinkMaterial, deleteMaterial } = useTopicMaterials(open ? topicId : null)

  useEffect(() => {
    setDateVal(availableFrom || '')
  }, [availableFrom, open, topicId])

  if (!open || !topicId) return null

  const activeSection = SECTIONS.find(s => s.type === activeTab)!

  async function handleDateBlur() {
    if (!canEdit || !onSaveTopicMeta) return
    if (dateVal === (availableFrom || '')) return
    setSavingDate(true)
    try {
      await onSaveTopicMeta({ available_from: dateVal || null })
    } finally {
      setSavingDate(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-2xl max-h-[92vh] flex flex-col z-10 overflow-hidden">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 leading-tight">{topicTitle}</h2>
            {moduleTitle && <div className="flex items-center gap-1.5 mt-0.5"><GraduationCap size={12} className="text-gray-400" /><span className="text-xs text-gray-400">{moduleTitle}</span></div>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-3 shrink-0 p-1"><X size={20} /></button>
        </div>

        {!canEdit && (
          <div className="flex-1 overflow-y-auto">
            <StudentView materials={materials} loading={loading} topicTitle={topicTitle} moduleTitle={moduleTitle} lessonDate={lessonDate} hwDeadline={hwDeadline} hwStatus={hwStatus} hwScore={hwScore} hwMax={hwMax} />
          </div>
        )}

        {canEdit && (
          <>
            <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-4 shrink-0">
              <div className="mb-3">
                <div className="text-sm font-semibold text-gray-900">Материалы темы</div>
                <div className="text-xs text-gray-500">Текст, видео, ссылки и файлы. Порядок и видимость настраиваются у каждого материала.</div>
              </div>

              <div className="mb-3 rounded-2xl border border-gray-200 bg-white px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Открывается</span>
                  <Calendar size={14} className="text-primary-400 shrink-0" />
                  <div className="relative">
                    <input
                      type="date"
                      value={dateVal}
                      onChange={e => setDateVal(e.target.value)}
                      onBlur={() => { void handleDateBlur() }}
                      className="h-10 w-[180px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                    />
                    {savingDate && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-primary-500" />}
                  </div>
                  <span className="text-xs text-gray-400">Пусто = сразу доступна</span>
                </div>
              </div>

            </div>

            {(lessonDate || hwDeadline) && (
              <div className="flex items-center gap-4 px-6 py-2.5 bg-gray-50 border-b border-gray-100 text-xs shrink-0 flex-wrap">
                {lessonDate && <span className="flex items-center gap-1.5 text-gray-500"><Calendar size={12} className="text-primary-400" />Занятие: <span className="font-medium text-gray-700">{new Date(lessonDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></span>}
                {hwDeadline && <span className="flex items-center gap-1.5 text-gray-500"><Clock size={12} className="text-orange-400" />Сдать до: <span className="font-medium text-gray-700">{new Date(hwDeadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span></span>}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              <TopicMaterialItems topicId={topicId} canManage />

              {/* PDF-ДЗ темы. Интерфейс проверки работ — отдельным этапом. */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Домашнее задание
                </div>
                <TopicHomeworkEditor topicId={topicId} />
              </div>

              {/* Тест по теме. */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Тестирование
                </div>
                <TopicTestEditor topicId={topicId} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function getYouTubeEmbed(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`
    const v = u.searchParams.get('v')
    if (v) return `https://www.youtube.com/embed/${v}`
    if (u.pathname.startsWith('/embed/')) return url
  } catch {
    return null
  }
  return null
}
