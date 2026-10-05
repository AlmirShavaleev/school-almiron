import { useState, useRef, useEffect } from 'react'
import {
  X, FileText, Link, Upload, Loader2, Check, Trash2,
  BookOpen, ClipboardList, Video, Lightbulb, GraduationCap, BookMarked,
  Calendar, Clock, Lock, BarChart3, ListChecks,
} from 'lucide-react'
import { useTopicMaterials, type MaterialType } from '@/hooks/useTopicMaterials'
import { useTopicMaterialItems } from '@/hooks/useTopicMaterialItems'
import { useTopicTestAssignment } from '@/hooks/useTopicTest'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { cn } from '@/utils/cn'
import { toast } from '@/store/toastStore'
import { getMaterialFileIcon } from '@/lib/materialIcons'
import { isTopicOpen, isDateAutomation, willOpenByDate } from '@/lib/topicAvailability'
import { formatEgeNumbers, parseEgeNumbersInput, parseEgeNumbersFromTitle } from '@/lib/egeTaskNumbers'
import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'
import { TopicTrainingEditor } from '@/components/courseProgram/TopicTrainingEditor'
import { TopicHomeworkEditor } from '@/components/courseProgram/TopicHomeworkEditor'
import { TopicTestEditor } from '@/components/courseProgram/TopicTestEditor'
import { TopicTemplateBanner } from '@/components/courseProgram/TopicTemplateBanner'
import { TopicAutocheckEditor } from '@/components/courseProgram/TopicAutocheckEditor'
import { LESSON_FORMAT_HINT, LESSON_FORMAT_LABEL, normalizeLessonFormat, type LessonFormat } from '@/lib/autocheck'
import { TOPIC_KINDS, TOPIC_KIND_HINT, TOPIC_KIND_LABEL, isTimedKind, normalizeTopicKind, type TopicKind } from '@/lib/timedWork'
import {
  MATERIAL_FILE_ACCEPT, isMaterialSection,
  TOPIC_SECTION_ORDER, isTopicSectionVisible, sectionLabel,
  type TopicMaterialSection, type TopicSection,
} from '@/lib/topicMaterialItems'
import { SignedImage } from '@/components/ui/SignedImage'
import { usePasteFiles } from '@/hooks/usePasteFiles'

/** Картинка ли это — по расширению имени файла. */
function isImageName(name: string | null): boolean {
  const ext = (name?.includes('.') ? name.split('.').pop() ?? '' : '').toUpperCase()
  return /^(PNG|JPG|JPEG|WEBP|GIF|HEIC|HEIF)$/.test(ext)
}

/**
 * Иконка карточки рубрики. Единственное, что осталось здесь своим: список
 * рубрик, их порядок и подписи живут в `topicMaterialItems.ts` (§100), а
 * картинка базе неинтересна. Тип `Record` не даёт забыть новую рубрику —
 * добавят восьмую секцию, и это место перестанет собираться.
 */
/** §240.1. Рубрики проверочной и контрольной — только эти три. */
const TIMED_TILE_ORDER: readonly TopicSection[] = ['worksheet_homework', 'solution', 'criteria'] as const
const TIMED_TILE_WHEN: Partial<Record<TopicSection, string>> = {
  worksheet_homework: 'с начала работы',
  solution: 'после проверки',
  criteria: 'после проверки',
}

const TILE_ICON: Record<TopicSection, typeof BookMarked> = {
  theory: BookOpen,
  notes: BookMarked,
  tasks: ClipboardList,
  task_solution: Check,
  worksheet_tasks: FileText,
  homework: Lightbulb,
  solution: Check,
  worksheet_homework: FileText,
  criteria: ListChecks,
  video: Video,
  test: BarChart3,
}

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

  // Скриншот из буфера (Ctrl+V). Материал здесь один на рубрику, поэтому из
  // вставки берём первую картинку — как и при выборе файла через диалог.
  //
  // Сквозная нумерация (§99) тут не нужна и не заводится: список из одного
  // места, новая вставка ЗАМЕНЯЕТ прежний файл, а не встаёт рядом — двух
  // «скриншот-1» в одном списке не бывает. Путь в Storage всё равно с меткой
  // времени, так что и файлы не перетираются.
  usePasteFiles(files => { if (files[0]) void uploadOne(files[0]) }, canEdit && !uploading)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadOne(file)
  }

  async function uploadOne(file: File) {
    if (!canEdit) return
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
            isImageName(fileName) ? (
              // Картинку показываем, а не предлагаем открыть файлом — то же
              // решение, что и в новых материалах темы (TopicMaterialItems).
              <SignedFileLink
                bucket="course-materials"
                url={material.file_url}
                title="Открыть изображение в полном размере"
                className="block overflow-hidden rounded-xl border border-gray-200 transition-colors hover:border-primary-300"
              >
                <SignedImage
                  bucket="course-materials"
                  path={material.file_url}
                  alt={fileName || 'Материал темы'}
                  className="max-h-[420px] w-full bg-gray-50 object-contain"
                />
              </SignedFileLink>
            ) : (
              <SignedFileLink
                bucket="course-materials"
                url={material.file_url}
                className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
              >
                {getMaterialFileIcon(material.file_url)}
                <span className="text-sm text-blue-700 truncate">{fileName || 'Открыть файл'}</span>
              </SignedFileLink>
            )
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
              <input ref={fileRef} type="file" className="hidden" accept={MATERIAL_FILE_ACCEPT} onChange={handleFileChange} />
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
  /** Тумблер открытости: null — решает дата. См. src/lib/topicAvailability.ts */
  isOpen?: boolean | null
  /** §216. Номера заданий ЕГЭ темы. Пусто — не проставлено. */
  egeTaskNumbers?: number[] | null
  onSaveTopicMeta?: (values: {
    /** §258. Название темы — правка прямо в окне темы. */
    title?: string
    available_from?: string | null
    is_open?: boolean | null
    ege_task_numbers?: number[]
    kind?: TopicKind
    /** §266. Пометка урока: «Тренировочный» / «Формат ЕГЭ» / без пометки. */
    lesson_format?: LessonFormat | null
  }) => Promise<void>
  /** §240. Тип темы: урок / проверочная / контрольная. */
  kind?: string | null
  /** §266. Пометка урока (topics.lesson_format). */
  lessonFormat?: string | null
  /** §240. Тема в курсе-шаблоне: время работы там не ставится. */
  isTemplate?: boolean
  /** Открыть все темы курса до этой включительно. Возвращает, сколько открылось. */
  onOpenUntilHere?: () => Promise<number>
  lessonDate?: string | null
  hwDeadline?: string | null
  hwStatus?: string | null
  hwScore?: number | null
  hwMax?: number | null
  /** Рубрика, на которой открыть окно, — возврат из каталога с задачами (§164). */
  initialTile?: string | null
}

export function TopicMaterialsModal({ open, onClose, topicId, topicTitle, moduleTitle, availableFrom = null, isOpen = null, egeTaskNumbers = null, onSaveTopicMeta, onOpenUntilHere, lessonDate, hwDeadline, hwStatus, hwScore, hwMax, initialTile = null, kind = null, lessonFormat = null, isTemplate = false }: Props) {
  const profile = useAuthStore(s => s.profile)
  const canEdit = !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)
  const [activeTab, setActiveTab] = useState<MaterialType>('notes')
  const [dateVal, setDateVal] = useState(availableFrom || '')
  const [savingDate, setSavingDate] = useState(false)
  // §216. Номера заданий ЕГЭ. Держим строкой, а не массивом: человек печатает
  // «13, 14, 15», и запятая с пробелом — часть его ввода, а не результат.
  const [numbersVal, setNumbersVal] = useState(formatEgeNumbers(egeTaskNumbers))
  const [numbersError, setNumbersError] = useState<string | null>(null)
  const [savingNumbers, setSavingNumbers] = useState(false)
  const [savingOpen, setSavingOpen] = useState(false)
  const [bulkNote, setBulkNote] = useState<string | null>(null)
  // §240. Тип темы держим у себя: кнопки переключаются сразу, запись — фоном.
  const [kindVal, setKindVal] = useState<TopicKind>(normalizeTopicKind(kind))
  const [savingKind, setSavingKind] = useState(false)
  // §266. Пометка урока — так же: переключается сразу, запись фоном, откат при отказе.
  const [formatVal, setFormatVal] = useState<LessonFormat | null>(normalizeLessonFormat(lessonFormat))
  const [savingFormat, setSavingFormat] = useState(false)
  const [activeTile, setActiveTile] = useState<TopicSection | null>(null)
  // §258. Название темы. Держим строкой у себя: сохраняем по Enter и уходу из
  // поля, как дату и номера ЕГЭ рядом — кнопки «Сохранить» в окне нет.
  const [titleVal, setTitleVal] = useState(topicTitle)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [savingTitle, setSavingTitle] = useState(false)
  const { materials, loading, saveMaterial, uploadFile, createLinkMaterial, deleteMaterial } = useTopicMaterials(open ? topicId : null)

  // Новые хуки для новой системы материалов
  const { materials: newMaterials } = useTopicMaterialItems(open && canEdit && topicId ? topicId : null)
  const { assignment } = useTopicTestAssignment(open && canEdit && topicId ? topicId : null)
  const { homework } = useTopicHomework(open && canEdit && topicId ? topicId : null)

  useEffect(() => {
    setDateVal(availableFrom || '')
  }, [availableFrom, open, topicId])

  useEffect(() => {
    setKindVal(normalizeTopicKind(kind))
  }, [kind, open, topicId])

  useEffect(() => {
    setFormatVal(normalizeLessonFormat(lessonFormat))
  }, [lessonFormat, open, topicId])

  useEffect(() => {
    setTitleVal(topicTitle)
    setTitleError(null)
  }, [topicTitle, open, topicId])

  useEffect(() => {
    setNumbersVal(formatEgeNumbers(egeTaskNumbers))
    setNumbersError(null)
    // Строка зависит от массива — сравниваем по его печатному виду, иначе
    // новая ссылка на тот же массив затирала бы набранное на каждом рендере.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatEgeNumbers(egeTaskNumbers), open, topicId])

  // Возврат из каталога открывает окно сразу на своей рубрике (§164).
  useEffect(() => {
    if (!open || !initialTile) return
    // Ключ приходит из адреса — сверяем с перечнем рубрик, а не верим строке.
    if ((TOPIC_SECTION_ORDER as readonly string[]).includes(initialTile)) {
      setActiveTile(initialTile as TopicSection)
      setScrollToPanel(true)
    }
  }, [open, topicId, initialTile])
  // §259. Открыли «на рубрике» (срок ДЗ из таблицы «По темам», возврат из
  // каталога) — панель рубрики под сеткой плиток прокручивается в вид, иначе
  // она остаётся ниже края окна и человек её не видит.
  const panelRef = useRef<HTMLDivElement>(null)
  const [scrollToPanel, setScrollToPanel] = useState(false)
  useEffect(() => {
    if (!scrollToPanel || !panelRef.current) return
    panelRef.current.scrollIntoView?.({ block: 'start' })
    setScrollToPanel(false)
  }, [scrollToPanel, activeTile])

  if (!open || !topicId) return null

  // Состояние считаем тем же правилом, что и база (topic_open_now).
  const openState     = { is_open: isOpen, available_from: availableFrom }
  const topicOpen     = isTopicOpen(openState)
  const dateAutomation = isDateAutomation(openState)
  const willOpen      = willOpenByDate(openState)
  const scheduleNote  = willOpen
    ? `Откроется сама ${new Date(willOpen + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
    : dateAutomation
      ? 'Открытием управляет дата'
      : 'Решает тумблер. Поставьте дату — тема откроется по ней'

  const activeSection = SECTIONS.find(s => s.type === activeTab)!

  /**
   * Ошибку сохранения показываем тостом, а не роняем обещание: у всех трёх
   * обработчиков ниже вызов идёт через `void`, и до §98 упавший запрос давал
   * unhandled rejection — на экране не менялось ничего, преподаватель считал,
   * что сохранилось.
   */
  function saveFailed(e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
  }

  async function handleDateBlur() {
    if (!canEdit || !onSaveTopicMeta) return
    if (dateVal === (availableFrom || '')) return
    setSavingDate(true)
    try {
      // §245. Дата — это просьба «открой тогда-то», поэтому она переводит тему
      // на автоматику (is_open = null). Раньше писалась только дата, а у 80 %
      // тем тумблер стоит вручную на «Закрыта» — дата молча не действовала, и
      // у темы не появлялось «откроется …» (владелец 30.09).
      // Дату стёрли — фиксируем то, что человек видит сейчас: null + пустая
      // дата по правилу topic_open_now означает «открыта», и стирание даты у
      // закрытой темы открыло бы её ученикам.
      await onSaveTopicMeta(dateVal
        ? { available_from: dateVal, is_open: null }
        : { available_from: null, is_open: topicOpen })
      toast.saved()
    } catch (e) {
      saveFailed(e)
    } finally {
      setSavingDate(false)
    }
  }

  /**
   * Тумблер пишет true/false явно, а не «переворачивает» вычисленное значение:
   * тема на автоматике по дате не имеет своего true/false, и без явной записи
   * первое нажатие могло бы ничего не изменить.
   */
  async function handleToggleOpen(next: boolean) {
    if (!canEdit || !onSaveTopicMeta) return
    setSavingOpen(true)
    setBulkNote(null)
    try {
      await onSaveTopicMeta({ is_open: next })
      toast.saved()
    } catch (e) {
      saveFailed(e)
    } finally {
      setSavingOpen(false)
    }
  }

  /**
   * §216. Номера заданий ЕГЭ. Сохраняем по уходу из поля — тем же способом,
   * что и дату рядом: в окне нет кнопки «Сохранить», она бы здесь врала.
   * Ошибку разбора показываем ПОД полем и в базу не идём: тост исчезает, а
   * «оптика» в поле остаётся, и человек не понимает, почему не сохранилось.
   */
  async function handleNumbersBlur() {
    if (!canEdit || !onSaveTopicMeta) return
    const parsed = parseEgeNumbersInput(numbersVal)
    if (parsed.error) { setNumbersError(parsed.error); return }
    setNumbersError(null)
    const next = formatEgeNumbers(parsed.numbers)
    setNumbersVal(next)
    if (next === formatEgeNumbers(egeTaskNumbers)) return
    setSavingNumbers(true)
    try {
      await onSaveTopicMeta({ ege_task_numbers: parsed.numbers })
      toast.saved()
    } catch (e) {
      saveFailed(e)
    } finally {
      setSavingNumbers(false)
    }
  }

  /**
   * §240. Тип темы. Проверочная и контрольная — одно правило (окно, одна
   * попытка, автосдача), различаются только подписью; урок — как раньше.
   */
  async function handleKind(next: TopicKind) {
    if (!canEdit || !onSaveTopicMeta || next === kindVal) return
    const prev = kindVal
    setKindVal(next)
    setSavingKind(true)
    try {
      await onSaveTopicMeta({ kind: next })
      toast.saved()
    } catch (e) {
      setKindVal(prev)
      saveFailed(e)
    } finally {
      setSavingKind(false)
    }
  }

  /** §266. Пометка урока. В каркасе уезжает во все классы (триггер базы). */
  async function handleLessonFormat(next: LessonFormat | null) {
    if (!canEdit || !onSaveTopicMeta || next === formatVal) return
    const prev = formatVal
    setFormatVal(next)
    setSavingFormat(true)
    try {
      await onSaveTopicMeta({ lesson_format: next })
      toast.saved()
    } catch (e) {
      setFormatVal(prev)
      saveFailed(e)
    } finally {
      setSavingFormat(false)
    }
  }

  /**
   * §258. Название темы. Владелец не нашёл, где переименовать тему: правка
   * жила только в «Редактировать программу». Правило то же, что у строки
   * программы (`InlineEdit`): пробелы по краям срезаем, пустое не сохраняем.
   * Ошибку показываем ПОД полем и набранное не стираем — тост исчезает, а
   * человек должен понять, что название осталось прежним.
   */
  async function handleTitleCommit() {
    if (!canEdit || !onSaveTopicMeta) return
    const next = titleVal.trim()
    if (!next) { setTitleError('Название не может быть пустым'); return }
    if (next !== titleVal) setTitleVal(next)
    if (next === topicTitle) { setTitleError(null); return }
    setSavingTitle(true)
    setTitleError(null)
    try {
      await onSaveTopicMeta({ title: next })
      toast.saved()
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code?: unknown }).code ?? '') : ''
      setTitleError(code === '42501'
        ? 'Недостаточно прав, чтобы переименовать тему'
        : `Не удалось сохранить название${e instanceof Error && e.message ? `: ${e.message}` : ''}`)
    } finally {
      setSavingTitle(false)
    }
  }

  /** Вернуть теме автоматику по дате: is_open снова null. */
  async function handleBackToSchedule() {
    if (!canEdit || !onSaveTopicMeta) return
    setSavingOpen(true)
    setBulkNote(null)
    try {
      await onSaveTopicMeta({ is_open: null })
      toast.saved()
    } catch (e) {
      saveFailed(e)
    } finally {
      setSavingOpen(false)
    }
  }

  async function handleOpenUntilHere() {
    if (!canEdit || !onOpenUntilHere) return
    setSavingOpen(true)
    try {
      const n = await onOpenUntilHere()
      setBulkNote(n === 0 ? 'Всё до этой темы уже открыто' : `Открыто тем: ${n}`)
    } catch (e) {
      saveFailed(e)
    } finally {
      setSavingOpen(false)
    }
  }

  // Подсказка из названия: почти у половины тем номер уже написан в
  // заголовке, и заново набирать его руками — лишняя работа. Предлагаем
  // только когда поле пустое: перебивать проставленное подсказкой нельзя.
  const numbersFromTitle = parseEgeNumbersFromTitle(topicTitle)
  const suggestFromTitle =
    numbersVal.trim() === '' && numbersFromTitle.length > 0
      ? formatEgeNumbers(numbersFromTitle)
      : null

  /*
    Карточки рубрик собираются из общего списка (§100). Своим перечнем они
    жили до сих пор — и после §95 в нём не хватало трёх новых рубрик: вкладка
    «Материалы» показывала десять, окно темы семь. Здесь остаётся только то,
    что база знать не обязана: иконка.
  */
  // Скрытые рубрики не показываем и персоналу: вход в механизм, которым не
  // пользуются, копит недоумение при каждом просмотре темы.
  const timed = isTimedKind(kindVal)
  // §240.1. У проверочной и контрольной только три рубрики — условие, решение,
  // ответы и критерии (решение владельца 28.09): остальное на работе по времени
  // лишнее. Время, публикация и оценка — блоком «Время и сдача» под плитками,
  // а не отдельной плиткой.
  // §266. Тренировочный урок: вместо ДЗ на проверку — задачи с автопроверкой,
  // блоком под плитками; плитки «Домашнее задание» у него нет.
  const training = !timed && formatVal === 'training'
  const TILES = (timed ? TIMED_TILE_ORDER : TOPIC_SECTION_ORDER).filter(isTopicSectionVisible)
    .filter(key => !(training && key === 'homework')).map(key => ({
    key,
    label: sectionLabel(key, timed),
    icon: TILE_ICON[key],
  }))

  // Определяем, есть ли что-то в каждой рубрике
  function hasTileContent(tileKey: TopicSection): boolean {
    if (isMaterialSection(tileKey)) {
      return newMaterials.some(m => m.section === tileKey)
    }
    if (tileKey === 'video') {
      return newMaterials.some(m => m.kind === 'video')
    }
    if (tileKey === 'homework') {
      return homework !== null
    }
    if (tileKey === 'test') {
      return assignment !== null
    }
    return false
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div data-testid="topic-materials-modal" role="dialog" aria-modal="true" aria-label={topicTitle} className="relative bg-white w-full sm:rounded-2xl shadow-2xl sm:max-w-2xl max-h-[92vh] flex flex-col z-10 overflow-hidden">
        {/*
          Шапка переносится, а не сжимается (§183). Управление темой (тумблер с
          подписью и поле даты) занимает около 340px — на 390 ему и названию
          одновременно места нет, и до правки колонка названия сжималась до
          слова в строку, а тумблер с датой наезжали на неё сверху. `flex-wrap`
          с порядком «название → крестик → управление» кладёт управление целой
          строкой ниже, а `order-*` возвращает прежний порядок с `sm:`. На
          ширине от 640px ряд как был: название растяжимое (`flex-1 min-w-0`),
          два блока справа нерастяжимые — переноситься нечему.
        */}
        <div className="flex flex-wrap items-start justify-between gap-y-3 px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="order-1 min-w-0 flex-1">
            <h2 className="font-bold text-gray-900 leading-tight">{topicTitle}</h2>
            {moduleTitle && <div className="flex items-center gap-1.5 mt-0.5"><GraduationCap size={12} className="shrink-0 text-gray-400" /><span className="text-xs text-gray-400">{moduleTitle}</span></div>}
          </div>
          {canEdit && (
            <div className="order-3 flex w-full items-start justify-between gap-2 shrink-0 sm:order-2 sm:ml-3 sm:w-auto sm:justify-start sm:gap-4">
              {/* Тумблер — главный способ управления; дата ниже осталась автоматикой. */}
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Тема</label>
                <button
                  type="button"
                  data-testid="topic-open-toggle"
                  role="switch"
                  aria-checked={topicOpen}
                  aria-label={topicOpen ? 'Тема открыта' : 'Тема закрыта'}
                  disabled={savingOpen}
                  onClick={() => { void handleToggleOpen(!topicOpen) }}
                  className={cn(
                    'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:opacity-60',
                    topicOpen
                      ? 'border-primary-200 bg-primary-50 text-primary-700'
                      : 'border-gray-200 bg-gray-100 text-gray-500',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', topicOpen ? 'bg-primary-500' : 'bg-gray-400')} />
                  {topicOpen ? 'Открыта' : 'Закрыта'}
                  {savingOpen && <Loader2 size={12} className="animate-spin" />}
                </button>
                <div className="max-w-[150px] text-left text-[10px] leading-tight text-gray-400 sm:max-w-[190px] sm:text-right">
                  {scheduleNote}
                  {!dateAutomation && (
                    <>
                      {' '}
                      <button
                        type="button"
                        data-testid="topic-back-to-schedule"
                        onClick={() => { void handleBackToSchedule() }}
                        className="underline underline-offset-2 hover:text-primary-600"
                      >
                        вернуть автоматику
                      </button>
                    </>
                  )}
                </div>
                {onOpenUntilHere && (
                  <button
                    type="button"
                    data-testid="topic-open-until-here"
                    disabled={savingOpen}
                    onClick={() => { void handleOpenUntilHere() }}
                    className="text-[10px] text-gray-500 underline underline-offset-2 hover:text-primary-600 disabled:opacity-60"
                  >
                    Открыть всё до этой темы
                  </button>
                )}
                {bulkNote && <div className="text-[10px] text-primary-600">{bulkNote}</div>}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-gray-500">Открывается</label>
                <div className="relative">
                  <input
                    type="date"
                    value={dateVal}
                    onChange={e => setDateVal(e.target.value)}
                    onBlur={() => { void handleDateBlur() }}
                    className="h-9 w-[140px] rounded-lg border border-gray-200 bg-white px-2 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-400"
                  />
                  {savingDate && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-primary-500" />}
                </div>
              </div>
            </div>
          )}
          <button data-testid="topic-modal-close" aria-label="Закрыть" onClick={onClose} className="order-2 text-gray-400 hover:text-gray-600 transition-colors ml-3 shrink-0 p-1 sm:order-3"><X size={20} /></button>
        </div>

        {!canEdit && (
          <div className="flex-1 overflow-y-auto">
            <StudentView materials={materials} loading={loading} topicTitle={topicTitle} moduleTitle={moduleTitle} lessonDate={lessonDate} hwDeadline={hwDeadline} hwStatus={hwStatus} hwScore={hwScore} hwMax={hwMax} />
          </div>
        )}

        {canEdit && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* §258. Название темы — первым: его ищут в окне темы, а не в программе. */}
            <div data-testid="topic-title-field" className="rounded-2xl border border-gray-200 bg-white p-4">
              <label htmlFor="topic-title-input" className="block text-sm font-semibold text-gray-900">Название темы</label>
              <div className="relative mt-2">
                <input
                  id="topic-title-input"
                  data-testid="topic-title-input"
                  type="text"
                  value={titleVal}
                  disabled={!onSaveTopicMeta}
                  aria-invalid={titleError ? true : undefined}
                  aria-describedby="topic-title-hint"
                  onChange={e => { setTitleVal(e.target.value); setTitleError(null) }}
                  onBlur={() => { void handleTitleCommit() }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
                    if (e.key === 'Escape') { setTitleVal(topicTitle); setTitleError(null) }
                  }}
                  className={cn(
                    'h-10 w-full rounded-xl border bg-white px-3 pr-9 text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 disabled:bg-gray-50',
                    titleError ? 'border-red-300 focus:ring-red-300' : 'border-gray-200 focus:ring-primary-400',
                  )}
                />
                {savingTitle && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-primary-500" />}
              </div>
              {titleError
                ? <div id="topic-title-hint" data-testid="topic-title-error" role="alert" className="mt-1.5 text-xs text-red-600">{titleError}</div>
                : (
                  <div id="topic-title-hint" className="mt-1.5 text-xs text-gray-400">
                    Enter или клик мимо поля — сохранить.{isTemplate ? ' Курс-шаблон: название обновится и в классах-копиях.' : ''}
                  </div>
                )}
            </div>

            {/*
              §216. Номера заданий ЕГЭ — первым блоком, до плиток рубрик.
              Владельцу предстоит проставить их у сотни тем по ходу работы, и
              поле, спрятанное внутрь рубрики, он открывал бы по два клика на
              каждую тему.
            */}
            {/*
              §255. Поле стало заметнее (логика та же): по этим номерам у
              учеников считается «Примерный балл на ЕГЭ» на главной, и пустое
              поле теперь помечено — тема без номера в прогноз не идёт.
            */}
            <div
              data-testid="topic-ege-numbers"
              data-empty={(egeTaskNumbers ?? []).length === 0 || undefined}
              className={cn('rounded-2xl border p-4', (egeTaskNumbers ?? []).length === 0 ? 'border-gold-300 bg-gold-50/60' : 'border-gray-200 bg-white')}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <label htmlFor="topic-ege-numbers-input" className="block text-sm font-semibold text-gray-900">
                  Номера заданий ЕГЭ
                </label>
                {(egeTaskNumbers ?? []).length === 0 && (
                  <span data-testid="topic-ege-numbers-empty" className="rounded-full bg-gold-100 px-2 py-0.5 text-xs font-semibold text-gold-800">не проставлены</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                По ним у учеников считается «Примерный балл на ЕГЭ»: ДЗ и тест темы засчитываются этим номерам.
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    id="topic-ege-numbers-input"
                    data-testid="topic-ege-numbers-input"
                    type="text"
                    inputMode="numeric"
                    value={numbersVal}
                    placeholder="например 13, 14, 15"
                    onChange={e => { setNumbersVal(e.target.value); setNumbersError(null) }}
                    onBlur={() => { void handleNumbersBlur() }}
                    className={cn(
                      'h-10 w-full rounded-xl border bg-white px-3 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2',
                      numbersError
                        ? 'border-red-300 focus:ring-red-300'
                        : 'border-gray-200 focus:ring-primary-400',
                    )}
                  />
                  {savingNumbers && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-primary-500" />}
                </div>
                {suggestFromTitle && (
                  <button
                    type="button"
                    data-testid="topic-ege-numbers-from-title"
                    onClick={() => { setNumbersVal(suggestFromTitle); setNumbersError(null) }}
                    className="h-10 shrink-0 rounded-xl border border-primary-200 bg-primary-50 px-3 text-sm font-medium text-primary-700 hover:bg-primary-100"
                  >
                    Из названия: {suggestFromTitle}
                  </button>
                )}
              </div>
              {numbersError
                ? <div data-testid="topic-ege-numbers-error" className="mt-1.5 text-xs text-red-600">{numbersError}</div>
                : <div className="mt-1.5 text-xs text-gray-400">Через запятую — номеров может быть несколько: «13, 14, 15» или «22-23». Пусто — номера не проставлены.</div>}
            </div>

            {/* §240. Тип темы — как в макете: урок, проверочная, контрольная. */}
            <div data-testid="topic-kind" className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">Тип темы</span>
                {savingKind && <Loader2 size={14} className="animate-spin text-primary-500" />}
              </div>
              <div role="group" aria-label="Тип темы" className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {TOPIC_KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    data-testid={`topic-kind-${k}`}
                    aria-pressed={kindVal === k}
                    disabled={savingKind || !onSaveTopicMeta}
                    onClick={() => { void handleKind(k) }}
                    className={cn(
                      'rounded-xl border-[1.5px] px-3 py-2 text-left text-sm font-semibold transition-colors disabled:opacity-70',
                      kindVal === k
                        ? 'border-primary-600 bg-primary-50 text-primary-900'
                        : 'border-gray-200 bg-white text-gray-800 hover:border-primary-300',
                    )}
                  >
                    {TOPIC_KIND_LABEL[k]}
                    <small className="block text-[11.5px] font-normal text-gray-500">{TOPIC_KIND_HINT[k]}</small>
                  </button>
                ))}
              </div>
              {timed && (
                <p data-testid="topic-kind-materials" className="mt-3 text-xs text-gray-500">
                  Условие ученик видит с начала работы, решение и критерии — после проверки. Время, одна попытка
                  и автосдача — в блоке «Время и сдача» ниже. ИИ-проверка берёт условие, решение и критерии.
                </p>
              )}
            </div>

            {/* §266. Пометка урока — только у урока: у работы по времени своя метка. */}
            {!timed && (
              <div data-testid="lesson-format" className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">Пометка урока</span>
                  {savingFormat && <Loader2 size={14} className="animate-spin text-primary-500" />}
                </div>
                <div role="group" aria-label="Пометка урока" className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {([null, 'training', 'ege'] as const).map(f => (
                    <button
                      key={f ?? 'none'}
                      type="button"
                      data-testid={`lesson-format-${f ?? 'none'}`}
                      aria-pressed={formatVal === f}
                      disabled={savingFormat || !onSaveTopicMeta || !canEdit}
                      onClick={() => { void handleLessonFormat(f) }}
                      className={cn(
                        'rounded-xl border-[1.5px] px-3 py-2 text-left text-sm font-semibold transition-colors disabled:opacity-70',
                        formatVal === f
                          ? 'border-primary-600 bg-primary-50 text-primary-900'
                          : 'border-gray-200 bg-white text-gray-800 hover:border-primary-300',
                      )}
                    >
                      {f ? LESSON_FORMAT_LABEL[f] : 'Без пометки'}
                      <small className="block text-[11.5px] font-normal text-gray-500">
                        {f ? LESSON_FORMAT_HINT[f] : 'Как сейчас: обычный урок с ДЗ на проверку'}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Каркас и его отражения (§172): куда уедет правка — или откуда
                приехало то, что здесь показано. */}
            <TopicTemplateBanner topicId={topicId} />

            {/* Сетка плиток */}
            <div className={cn('grid gap-2', timed ? 'grid-cols-3' : 'grid-cols-3 sm:grid-cols-4')}>
              {TILES.map((tile) => {
                const Icon = tile.icon
                const isActive = activeTile === tile.key
                const hasContent = hasTileContent(tile.key)

                return (
                  <button
                    key={tile.key}
                    data-testid={`topic-tile-${tile.key}`}
                    onClick={() => setActiveTile(isActive ? null : tile.key)}
                    className={cn(
                      'h-[92px] rounded-2xl border flex flex-col items-center justify-center gap-1.5 text-sm font-semibold transition-colors',
                      isActive
                        ? 'border-2 border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'
                    )}
                  >
                    <Icon size={20} />
                    <span className="text-xs text-center leading-tight px-1">{tile.label}</span>
                    {timed && TIMED_TILE_WHEN[tile.key] && (
                      <span className="text-[10.5px] font-medium text-gray-400">{TIMED_TILE_WHEN[tile.key]}</span>
                    )}
                    {hasContent && (
                      <div data-testid="topic-tile-filled" className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Панель под сеткой. Плитки нет в сетке (у работы по времени —
                всё, кроме трёх рубрик) — нет и панели. */}
            {activeTile && TILES.some(t => t.key === activeTile) && (
              <div ref={panelRef} data-testid="topic-tile-panel" className="scroll-mt-4 rounded-2xl border border-primary-100 bg-primary-50/30 p-4 space-y-3">
                <div className="text-sm font-semibold text-primary-700">
                  {TILES.find(t => t.key === activeTile)?.label}
                </div>

                {/*
                  Условие по общему списку, а не перечислением: тремя строками
                  выше рубрик стало десять, и «нет в перечне» здесь означало бы
                  открытую карточку с пустотой внутри (§100).
                */}
                {isMaterialSection(activeTile) && (
                  <TopicMaterialItems
                    topicId={topicId}
                    canManage
                    section={activeTile}
                    hideAddForm
                  />
                )}

                {activeTile === 'video' && (
                  <TopicMaterialItems
                    topicId={topicId}
                    canManage
                    section="video"
                    hideAddForm
                  />
                )}

                {activeTile === 'homework' && (
                  <TopicHomeworkEditor topicId={topicId} kind={kindVal} isTemplate={isTemplate} isOpen={isOpen} availableFrom={availableFrom} focusDue={initialTile === 'homework'} />
                )}

                {activeTile === 'test' && (
                  <TopicTestEditor topicId={topicId} />
                )}
              </div>
            )}

            {/* §240.1. Работа по времени: окно, публикация и оценка — всегда
                на виду, без отдельной плитки. */}
            {timed && (
              <div data-testid="topic-timed-settings" className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
                <div className="text-sm font-semibold text-gray-900">Время и сдача</div>
                <TopicHomeworkEditor topicId={topicId} kind={kindVal} isTemplate={isTemplate} isOpen={isOpen} availableFrom={availableFrom} />
              </div>
            )}

            {/* §266. Тренировочный урок: задачи с автопроверкой и результаты класса. */}
            {training && topicId && <TopicAutocheckEditor topicId={topicId} canEdit={canEdit} />}

            {/* §234. Тренировка — подтемы задачника и переключатель «видят /
                скрыта» для этого класса. Файлы кладёт загрузчик в шаблон,
                здесь их не загружают и не удаляют. Нет тренировки — блока нет.
                У работы по времени тренировки нет (§240.1). */}
            {!timed && <TopicTrainingEditor topicId={topicId} />}

          </div>
        )}

        {/*
          Кнопка «Готово», а не «Сохранить»: файлы и поля сохраняются сразу,
          в момент действия, и кнопка «Сохранить» врала бы — она бы ничего не
          сохраняла. Её работа — закрыть окно, а подтверждение сохранения даёт
          тост toast.saved() (§98).
        */}
        {canEdit && (
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-3 shrink-0">
            <span className="text-xs text-gray-400">Изменения сохраняются сразу</span>
            <Button data-testid="topic-modal-done" onClick={onClose}>Готово</Button>
          </div>
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
