import { useState, useRef, useEffect } from 'react'
import {
  X, FileText, Link, Upload, Loader2, Check, Trash2,
  BookOpen, ClipboardList, Video, Lightbulb, GraduationCap, BookMarked,
  Calendar, Clock, Lock,
} from 'lucide-react'
import { useTopicMaterials, type MaterialType } from '@/hooks/useTopicMaterials'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

// ─── Section config ───────────────────────────────────────────────────────────
const SECTIONS: {
  type:     MaterialType
  label:    string
  icon:     React.ReactNode
  color:    string
  hasText:  boolean
  hasFile:  boolean
  textHint: string
}[] = [
  { type: 'notes',    label: 'Конспект',     icon: <BookMarked size={16} />,    color: 'text-blue-600 bg-blue-50',    hasText: true,  hasFile: true,  textHint: 'Краткий конспект темы, ключевые формулы, определения…' },
  { type: 'theory',   label: 'Теория',       icon: <BookOpen size={16} />,      color: 'text-purple-600 bg-purple-50', hasText: true,  hasFile: true,  textHint: 'Подробное теоретическое объяснение…' },
  { type: 'tasks',    label: 'Список задач', icon: <ClipboardList size={16} />, color: 'text-orange-600 bg-orange-50', hasText: false, hasFile: true,  textHint: '' },
  { type: 'homework', label: 'ДЗ',           icon: <Lightbulb size={16} />,     color: 'text-yellow-600 bg-yellow-50', hasText: true,  hasFile: true,  textHint: 'Условие домашнего задания…' },
  { type: 'solution', label: 'Решение ДЗ',   icon: <Check size={16} />,         color: 'text-green-600 bg-green-50',   hasText: false, hasFile: true,  textHint: '' },
  { type: 'video',    label: 'Видео',        icon: <Video size={16} />,          color: 'text-red-600 bg-red-50',       hasText: false, hasFile: false, textHint: '' },
]

// ─── Single section editor ────────────────────────────────────────────────────
function SectionEditor({
  topicId, section, canEdit,
  material, onSave, onUpload,
}: {
  topicId: string
  section: typeof SECTIONS[0]
  canEdit: boolean
  material?: { content: string | null; file_url: string | null; link_url: string | null }
  onSave: (type: MaterialType, patch: any) => Promise<void>
  onUpload: (type: MaterialType, file: File) => Promise<string>
}) {
  const [text,    setText]    = useState(material?.content  || '')
  const [link,    setLink]    = useState(material?.link_url || '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [fileErr, setFileErr] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Sync when material loaded
  useEffect(() => {
    setText(material?.content  || '')
    setLink(material?.link_url || '')
  }, [material?.content, material?.link_url])

  async function handleSaveText() {
    if (!canEdit) return
    setSaving(true)
    try {
      await onSave(section.type, {
        content:  text.trim() || null,
        link_url: link.trim() || null,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 50 * 1024 * 1024) { setFileErr('Файл слишком большой (макс. 50 МБ)'); return }
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

  async function removeFile() {
    await onSave(section.type, { file_url: null })
  }

  const fileName = material?.file_url
    ? decodeURIComponent(material.file_url.split('/').pop() || 'Файл').split('?')[0]
    : null

  const isVideo = section.type === 'video'
  const ytEmbed = getYouTubeEmbed(link)

  return (
    <div className="space-y-4">

      {/* ── READ MODE: clean view, show only what exists ── */}
      {!canEdit && (
        <div className="space-y-4">
          {/* Text */}
          {section.hasText && text && (
            <div className="text-sm text-gray-700 bg-gray-50 rounded-xl p-4 whitespace-pre-wrap leading-relaxed">
              {text}
            </div>
          )}

          {/* File */}
          {section.hasFile && material?.file_url && (
            <a
              href={material.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
            >
              <FileText size={18} className="text-blue-500 shrink-0" />
              <span className="text-sm text-blue-700 truncate">{fileName || 'Открыть файл'}</span>
            </a>
          )}

          {/* Link (non-video) */}
          {!isVideo && link && (
            <a href={link} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:underline">
              <Link size={13} />{link}
            </a>
          )}

          {/* Video embed or link */}
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
              <a href={link} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:underline">
                <Link size={13} />{link}
              </a>
            )
          )}

          {/* Empty state */}
          {!text && !material?.file_url && !link && (
            <div className="text-sm text-gray-400 italic text-center py-6">Материал ещё не добавлен</div>
          )}
        </div>
      )}

      {/* ── EDIT MODE: только файл (+ ссылка для Видео) ── */}
      {canEdit && (
        <div className="space-y-4">

          {/* Видео — только ссылка */}
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

          {/* Все остальные — только файл */}
          {!isVideo && section.hasFile && (
            <div>
              {material?.file_url ? (
                <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-xl">
                  <FileText size={20} className="text-gray-400 shrink-0" />
                  <a href={material.file_url} target="_blank" rel="noopener noreferrer"
                    className="flex-1 text-sm text-primary-600 hover:underline truncate">
                    {fileName || 'Открыть файл'}
                  </a>
                  <button onClick={removeFile} className="text-gray-300 hover:text-red-500 transition-colors shrink-0 p-1">
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
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
                onChange={handleFileChange}
              />
              {fileErr && <p className="text-xs text-red-500 mt-1">{fileErr}</p>}
            </div>
          )}
        </div>
      )}

      {/* Save button — только для видео (файл сохраняется автоматически при загрузке) */}
      {canEdit && isVideo && (
        <div className="flex items-center gap-3 pt-1">
          <Button size="sm" onClick={handleSaveText} loading={saving}>
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

// ─── Student read view ────────────────────────────────────────────────────────

function StudentView({
  materials, loading, topicTitle, moduleTitle,
  lessonDate, hwDeadline, hwStatus, hwScore, hwMax,
}: {
  materials: ReturnType<typeof import('@/hooks/useTopicMaterials').useTopicMaterials>['materials']
  loading: boolean
  topicTitle: string
  moduleTitle: string
  lessonDate?: string | null
  hwDeadline?: string | null
  hwStatus?:   string | null
  hwScore?:    number | null
  hwMax?:      number | null
}) {
  const solutionLocked = hwStatus !== 'checked'

  const videoMat = materials['video']
  const videoLink = videoMat?.link_url || ''
  const ytEmbed = getYouTubeEmbed(videoLink)

  // File/content sections (excluding video which is shown separately)
  const FILE_SECTIONS = SECTIONS.filter(s => s.type !== 'video')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
        <Loader2 size={22} className="animate-spin" />Загрузка материалов…
      </div>
    )
  }

  return (
    <div className="space-y-0">

      {/* ── Meta bar ── */}
      {(lessonDate || hwDeadline || hwStatus) && (
        <div className="flex items-center gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs flex-wrap gap-y-1.5">
          {lessonDate && (
            <span className="flex items-center gap-1.5 text-gray-500">
              <Calendar size={12} className="text-primary-400" />
              Занятие: <span className="font-medium text-gray-700">
                {new Date(lessonDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
              </span>
            </span>
          )}
          {hwDeadline && (
            <span className="flex items-center gap-1.5 text-gray-500">
              <Clock size={12} className="text-orange-400" />
              Сдать до: <span className="font-medium text-gray-700">
                {new Date(hwDeadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
              </span>
            </span>
          )}
          {hwStatus === 'checked' && hwScore != null && (
            <span className="flex items-center gap-1.5 font-medium text-green-600">
              <Check size={12} />Балл: {hwScore}/{hwMax}
            </span>
          )}
          {hwStatus === 'submitted' && (
            <span className="flex items-center gap-1.5 text-blue-500">
              <Clock size={12} />На проверке
            </span>
          )}
          {hwStatus === 'revision' && (
            <span className="flex items-center gap-1.5 text-orange-500">На доработке</span>
          )}
        </div>
      )}

      {/* ── Video player ── */}
      {videoLink && (
        <div className="px-0 pt-0">
          {ytEmbed ? (
            <div className="aspect-video bg-black">
              <iframe
                src={ytEmbed}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="mx-6 mt-4 mb-0">
              <a href={videoLink} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-colors">
                <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center shrink-0">
                  <Video size={20} className="text-white" />
                </div>
                <div>
                  <div className="text-sm font-medium text-red-700">Смотреть видео</div>
                  <div className="text-xs text-red-400 truncate max-w-xs">{videoLink}</div>
                </div>
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Material buttons grid ── */}
      <div className="px-6 py-5 space-y-3">
        {!videoLink && (
          <div className="text-xs text-gray-400 text-center py-4 flex flex-col items-center gap-2">
            <Video size={28} className="text-gray-200" />
            Видео для этой темы не добавлено
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {FILE_SECTIONS.map(s => {
            const mat = materials[s.type]
            const hasFile    = !!mat?.file_url
            const hasContent = !!mat?.content
            const hasLink    = !!mat?.link_url
            const isLocked   = s.type === 'solution' && solutionLocked
            const available  = hasFile || hasContent || hasLink

            if (!available && !isLocked) return null   // скрываем пустые

            return (
              <div key={s.type}>
                {isLocked ? (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-gray-50 opacity-60">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', s.color)}>
                      <Lock size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-400">{s.label}</div>
                      <div className="text-xs text-gray-400">Станет доступно после проверки ДЗ</div>
                    </div>
                  </div>
                ) : hasFile ? (
                  <a
                    href={mat!.file_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all hover:shadow-sm',
                      'border-gray-200 hover:border-primary-300 bg-white hover:bg-gray-50'
                    )}
                  >
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', s.color)}>
                      {s.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-800">{s.label}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {decodeURIComponent(mat!.file_url!.split('/').pop() || '').split('?')[0]}
                      </div>
                    </div>
                    <FileText size={15} className="text-gray-300 shrink-0" />
                  </a>
                ) : hasContent ? (
                  <ContentButton section={s} content={mat!.content!} />
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Empty state if no materials at all */}
        {!videoLink && FILE_SECTIONS.every(s => {
          const mat = materials[s.type]
          return !mat?.file_url && !mat?.content && !mat?.link_url
        }) && (
          <div className="text-center py-8 text-gray-400 text-sm">
            Материалы к этой теме ещё не добавлены
          </div>
        )}
      </div>
    </div>
  )
}

// Inline expandable content block
function ContentButton({ section, content }: { section: typeof SECTIONS[0]; content: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', section.color)}>
          {section.icon}
        </div>
        <span className="flex-1 text-sm font-semibold text-gray-800">{section.label}</span>
        <BookOpen size={14} className={cn('shrink-0 transition-transform', open ? 'rotate-180 text-primary-500' : 'text-gray-300')} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 bg-gray-50 border-t border-gray-100 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────
interface Props {
  open:        boolean
  onClose:     () => void
  topicId:     string | null
  topicTitle:  string
  moduleTitle: string
  lessonDate?: string | null
  hwDeadline?: string | null
  hwStatus?:   string | null
  hwScore?:    number | null
  hwMax?:      number | null
}

export function TopicMaterialsModal({ open, onClose, topicId, topicTitle, moduleTitle, lessonDate, hwDeadline, hwStatus, hwScore, hwMax }: Props) {
  const profile = useAuthStore(s => s.profile)
  const canEdit = !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)
  const solutionLocked = !canEdit && hwStatus !== 'checked'

  const [activeTab, setActiveTab] = useState<MaterialType>('notes')
  const { materials, loading, saveMaterial, uploadFile } = useTopicMaterials(open ? topicId : null)

  if (!open || !topicId) return null

  const activeSection = SECTIONS.find(s => s.type === activeTab)!
  const videoLink = materials['video']?.link_url || ''
  const ytEmbed   = getYouTubeEmbed(videoLink)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-2xl max-h-[92vh] flex flex-col z-10 overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 leading-tight">{topicTitle}</h2>
            {moduleTitle && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <GraduationCap size={12} className="text-gray-400" />
                <span className="text-xs text-gray-400">{moduleTitle}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors ml-3 shrink-0 p-1">
            <X size={20} />
          </button>
        </div>

        {/* ── STUDENT: video + file buttons ── */}
        {!canEdit && (
          <div className="flex-1 overflow-y-auto">
            <StudentView
              materials={materials}
              loading={loading}
              topicTitle={topicTitle}
              moduleTitle={moduleTitle}
              lessonDate={lessonDate}
              hwDeadline={hwDeadline}
              hwStatus={hwStatus}
              hwScore={hwScore}
              hwMax={hwMax}
            />
          </div>
        )}

        {/* ── TEACHER/ADMIN: tab editor ── */}
        {canEdit && (
          <>
            {/* Tabs */}
            <div className="flex border-b border-gray-100 overflow-x-auto shrink-0 px-2">
              {SECTIONS.map(s => {
                const mat = materials[s.type]
                const hasContent = !!(mat?.content || mat?.file_url || mat?.link_url)
                return (
                  <button
                    key={s.type}
                    onClick={() => setActiveTab(s.type)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-3 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
                      activeTab === s.type
                        ? 'border-primary-600 text-primary-700'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    )}
                  >
                    {s.icon}{s.label}
                    {hasContent && <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />}
                  </button>
                )
              })}
            </div>

            {/* Meta bar */}
            {(lessonDate || hwDeadline) && (
              <div className="flex items-center gap-4 px-6 py-2.5 bg-gray-50 border-b border-gray-100 text-xs shrink-0 flex-wrap">
                {lessonDate && (
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <Calendar size={12} className="text-primary-400" />
                    Занятие: <span className="font-medium text-gray-700">
                      {new Date(lessonDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                    </span>
                  </span>
                )}
                {hwDeadline && (
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <Clock size={12} className="text-orange-400" />
                    Сдать до: <span className="font-medium text-gray-700">
                      {new Date(hwDeadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                    </span>
                  </span>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                  <Loader2 size={20} className="animate-spin" />Загрузка материалов…
                </div>
              ) : (
                <SectionEditor
                  key={activeTab}
                  topicId={topicId}
                  section={activeSection}
                  canEdit={canEdit}
                  material={materials[activeTab]}
                  onSave={saveMaterial}
                  onUpload={uploadFile}
                />
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-gray-100 shrink-0 flex items-center justify-between">
              <div className="flex gap-1">
                {SECTIONS.map(s => {
                  const mat = materials[s.type]
                  const has = !!(mat?.content || mat?.file_url || mat?.link_url)
                  return (
                    <div key={s.type} title={s.label}
                      className={cn('w-2 h-2 rounded-full transition-colors', has ? 'bg-green-400' : 'bg-gray-200')} />
                  )
                })}
              </div>
              <span className="text-xs text-gray-400">
                {Object.values(materials).filter(m => m?.content || m?.file_url || m?.link_url).length} / {SECTIONS.length} заполнено
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── YouTube embed helper ─────────────────────────────────────────────────────
function getYouTubeEmbed(url: string): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    // youtu.be/ID
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`
    // youtube.com/watch?v=ID
    const v = u.searchParams.get('v')
    if (v) return `https://www.youtube.com/embed/${v}`
    // youtube.com/embed/ID
    if (u.pathname.startsWith('/embed/')) return url
  } catch { return null }
  return null
}
