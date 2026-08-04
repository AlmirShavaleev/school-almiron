import { useRef, useState } from 'react'
import { usePasteFiles } from '@/hooks/usePasteFiles'
import {
  ArrowDown, ArrowUp, Eye, EyeOff, FileText, Link2, Lock, Loader2,
  Paperclip, Plus, Trash2, Upload, Video, X,
} from 'lucide-react'
import { useTopicMaterialItems } from '@/hooks/useTopicMaterialItems'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { SignedImage } from '@/components/ui/SignedImage'
import {
  MATERIAL_FILE_ACCEPT,
  TOPIC_MATERIAL_LABELS,
  TOPIC_MATERIAL_SECTION_LABELS,
  bucketForMaterialPath,
  getVideoEmbedUrl,
  type MaterialDraft,
  type TopicMaterial,
  type TopicMaterialKind,
  type TopicMaterialSection,
} from '@/lib/topicMaterialItems'
import { cn } from '@/utils/cn'

const KIND_ICON: Record<TopicMaterialKind, typeof FileText> = {
  text: FileText,
  video: Video,
  link: Link2,
  file: Paperclip,
}

function formatBytes(bytes: number | null): string | null {
  if (bytes == null) return null
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

// ─── Одна карточка материала ──────────────────────────────────────────────────

function MaterialCard({
  material, topicId, canManage, isFirst, isLast,
  onDelete, onToggleVisibility, onMove,
}: {
  material: TopicMaterial
  topicId: string
  canManage: boolean
  isFirst: boolean
  isLast: boolean
  onDelete: (id: string) => void
  onToggleVisibility: (id: string, next: boolean) => void
  onMove: (id: string, direction: 'up' | 'down') => void
}) {
  const Icon = KIND_ICON[material.kind]
  const embed = material.kind === 'video' ? getVideoEmbedUrl(material.url) : null

  // У файла без своего названия шапка «Файл» дублирует плитку с именем файла —
  // ученику её не показываем. Преподавателю показываем всегда: в ней живут
  // кнопки порядка, скрытия и удаления.
  const showHeader = canManage || material.kind !== 'file' || !!material.title

  return (
    <div
      className={cn(
        'rounded-2xl border border-gray-200 bg-white p-4',
        canManage && !material.isVisible && 'border-dashed opacity-70',
      )}
    >
      {showHeader && (
      <div className="mb-2 flex items-center gap-2">
        <Icon size={15} className="shrink-0 text-primary-600" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
          {material.title || TOPIC_MATERIAL_LABELS[material.kind]}
        </span>

        {canManage && (
          <>
            {!material.isVisible && (
              <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-gray-500">
                Скрыт
              </span>
            )}
            <button
              type="button"
              onClick={() => onMove(material.id, 'up')}
              disabled={isFirst}
              aria-label="Поднять выше"
              title="Поднять выше"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-primary-600 disabled:opacity-30"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => onMove(material.id, 'down')}
              disabled={isLast}
              aria-label="Опустить ниже"
              title="Опустить ниже"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-primary-600 disabled:opacity-30"
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => onToggleVisibility(material.id, !material.isVisible)}
              aria-label={material.isVisible ? 'Скрыть материал' : 'Показать материал'}
              title={material.isVisible ? 'Скрыть от учеников' : 'Показать ученикам'}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-primary-600"
            >
              {material.isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              type="button"
              onClick={() => onDelete(material.id)}
              aria-label="Удалить материал"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
      )}

      {material.kind === 'text' && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{material.content}</p>
      )}

      {material.kind === 'video' &&
        (embed ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe src={embed} title={material.title || 'Видео темы'} allowFullScreen className="h-full w-full" />
          </div>
        ) : (
          <a href={material.url} target="_blank" rel="noopener noreferrer"
            className="break-all text-sm text-primary-600 hover:underline">
            {material.url}
          </a>
        ))}

      {material.kind === 'link' && (
        <a href={material.url} target="_blank" rel="noopener noreferrer"
          className="break-all text-sm text-primary-600 hover:underline">
          {material.url}
        </a>
      )}

      {material.kind === 'file' && (
        <FileTile
          storagePath={material.storagePath}
          fileName={material.fileName}
          sizeBytes={material.sizeBytes}
          topicId={topicId}
        />
      )}
    </div>
  )
}

/**
 * Файл — плиткой с крупной иконкой, а не строчкой со скрепкой (образец —
 * скриншот владельца, 2026-08-02). Строка терялась среди текста, плитку видно
 * и на телефоне; кликается вся плитка, а не только слово.
 */
function FileTile({
  storagePath, fileName, sizeBytes, topicId,
}: {
  storagePath: string
  fileName: string | null
  sizeBytes: number | null
  topicId: string
}) {
  const name = fileName || 'Скачать файл'
  const ext = (name.includes('.') ? name.split('.').pop() ?? '' : '').toUpperCase()
  const isPdf = ext === 'PDF'
  const isImage = /^(PNG|JPG|JPEG|WEBP|GIF|HEIC|HEIF)$/.test(ext)
  const bucket = bucketForMaterialPath(storagePath, topicId)

  // Картинку показываем прямо в теме, а не предлагаем скачать «как документ»:
  // раньше она приезжала такой же серой плиткой, что и PDF, и ученику надо
  // было открыть файл, чтобы понять, что там (решение владельца 2026-08-04).
  // Клик по превью по-прежнему открывает оригинал в новой вкладке.
  if (isImage) {
    return (
      <figure className="space-y-1.5">
        <SignedFileLink
          bucket={bucket}
          url={storagePath}
          title="Открыть изображение в полном размере"
          className="block overflow-hidden rounded-xl border border-gray-200 transition-colors hover:border-primary-300"
        >
          <SignedImage
            bucket={bucket}
            path={storagePath}
            alt={fileName || 'Материал темы'}
            className="max-h-[420px] w-full bg-gray-50 object-contain"
          />
        </SignedFileLink>
        <figcaption className="truncate text-xs text-gray-400">
          {name}{ext && ` · ${ext}`}{formatBytes(sizeBytes) ? ` · ${formatBytes(sizeBytes)}` : ''}
        </figcaption>
      </figure>
    )
  }

  return (
    <SignedFileLink
      bucket={bucket}
      url={storagePath}
      className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
    >
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white',
          isPdf ? 'bg-red-500' : isImage ? 'bg-blue-500' : 'bg-gray-400',
        )}
      >
        <FileText size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900 group-hover:text-primary-700">{name}</span>
        <span className="mt-0.5 block text-xs text-gray-400">
          {ext && `${ext} · `}{formatBytes(sizeBytes) ?? 'файл'}
        </span>
      </span>
    </SignedFileLink>
  )
}

// ─── Быстрая загрузка файлов ─────────────────────────────────────────────────

function QuickAttach({
  onAdd, onUploadFile, section,
}: {
  onAdd: (draft: MaterialDraft) => Promise<void>
  onUploadFile: (file: File, onProgress?: (percent: number) => void) => Promise<{ storagePath: string; fileName: string; mimeType: string; sizeBytes: number }>
  section?: TopicMaterialSection | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [loadingIndex, setLoadingIndex] = useState(0)
  const [totalFiles, setTotalFiles] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [current, setCurrent] = useState<{ name: string; percent: number } | null>(null)

  // Скриншот из буфера (Ctrl+V) идёт тем же путём, что и выбранный файл:
  // проверка размера, прогресс, те же сообщения об ошибках.
  usePasteFiles(files => { void handleFilesSelected(files) }, !loading)

  async function handleFilesSelected(files: FileList | File[]) {
    const fileArray = Array.from(files)
    setTotalFiles(fileArray.length)
    setErrors([])
    setLoading(true)
    setCurrent(null)

    const failedFiles: string[] = []
    let firstError: string | null = null

    for (let i = 0; i < fileArray.length; i++) {
      setLoadingIndex(i + 1)
      const file = fileArray[i]

      // Проверка размера файла
      if (file.size > 50 * 1024 * 1024) {
        failedFiles.push(file.name)
        if (!firstError) firstError = 'Файл слишком большой'
        continue
      }

      try {
        setCurrent({ name: file.name, percent: 0 })
        const up = await onUploadFile(file, (p) => setCurrent(c => c ? { ...c, percent: p } : { name: file.name, percent: p }))
        await onAdd({ kind: 'file', title: '', section, ...up })
      } catch (e: any) {
        failedFiles.push(file.name)
        if (!firstError) firstError = e?.message ?? 'Ошибка загрузки'
      }
    }

    if (failedFiles.length > 0) {
      const errorMsg = `Не загружено: ${failedFiles.join(', ')} (${firstError})`
      setErrors([errorMsg])
    }

    setLoading(false)
    setCurrent(null)
    // Сброс значения инпута
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MATERIAL_FILE_ACCEPT}
        onChange={(e) => {
          if (e.target.files) {
            handleFilesSelected(e.target.files)
          }
        }}
        className="hidden"
        disabled={loading}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className={cn(
          'w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors',
          loading && 'opacity-50 cursor-not-allowed'
        )}
      >
        {loading && current ? (
          <div className="w-full max-w-xs">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span className="truncate">{current.name}</span>
              <span>{current.percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
              <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${current.percent}%` }} />
            </div>
            <div className="mt-1 text-center text-[11px] text-gray-400">Файл {loadingIndex} из {totalFiles}</div>
          </div>
        ) : loading ? (
          <>
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm font-medium">Загрузка {loadingIndex} из {totalFiles}…</span>
          </>
        ) : (
          <>
            <Upload size={20} />
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm font-medium">Прикрепить PDF или картинки</span>
                <span className="text-xs text-gray-400">или вставьте скриншот через Ctrl+V</span>
              <span className="text-xs">Можно выбрать несколько файлов · до 50 МБ каждый</span>
            </div>
          </>
        )}
      </button>

      {errors.length > 0 && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {errors[0]}
        </div>
      )}
    </div>
  )
}

// ─── Форма добавления ─────────────────────────────────────────────────────────

function AddMaterialForm({
  onAdd, onUploadFile,
}: {
  onAdd: (draft: MaterialDraft) => Promise<void>
  onUploadFile: (file: File, onProgress?: (percent: number) => void) => Promise<{ storagePath: string; fileName: string; mimeType: string; sizeBytes: number }>
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<TopicMaterialKind>('text')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setKind('text'); setTitle(''); setContent(''); setUrl(''); setFile(null); setError(null)
  }

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'file') {
        if (!file) throw new Error('Выберите файл')
        const uploaded = await onUploadFile(file)
        await onAdd({ kind, title, ...uploaded })
      } else if (kind === 'text') {
        await onAdd({ kind, title, content })
      } else {
        await onAdd({ kind, title, url })
      }
      reset()
      setOpen(false)
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось добавить материал')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus size={15} />
        Добавить материал
      </Button>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">Новый материал</span>
        <button type="button" onClick={() => { setOpen(false); reset() }} aria-label="Закрыть форму"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Тип материала">
        {(Object.keys(TOPIC_MATERIAL_LABELS) as TopicMaterialKind[]).map(k => {
          const Icon = KIND_ICON[k]
          return (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition-colors',
                kind === k
                  ? 'border-primary-400 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-primary-200',
              )}
            >
              <Icon size={14} />
              {TOPIC_MATERIAL_LABELS[k]}
            </button>
          )
        })}
      </div>

      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Заголовок (необязательно)"
        aria-label="Заголовок материала"
        className="mb-2 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
      />

      {kind === 'text' && (
        <textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder="Текст материала" aria-label="Текст материала" rows={5}
          className="w-full rounded-xl border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
      )}

      {(kind === 'video' || kind === 'link') && (
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder={kind === 'video' ? 'Ссылка на YouTube или Vimeo' : 'https://…'}
          aria-label={kind === 'video' ? 'Ссылка на видео' : 'Ссылка'}
          className="h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400" />
      )}

      {kind === 'file' && (
        <input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} aria-label="Файл материала"
          className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:text-primary-700" />
      )}

      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-3 flex justify-end">
        <Button onClick={handleSubmit} loading={busy}>Добавить</Button>
      </div>
    </div>
  )
}

// ─── Компактная форма для видео ───────────────────────────────────────────────

function VideoAddForm({
  onAdd, loading,
}: {
  onAdd: (draft: MaterialDraft) => Promise<void>
  loading: boolean
}) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      await onAdd({ kind: 'video', title: '', url: url.trim() })
      setUrl('')
    } catch (e: any) {
      setError(e?.message ?? 'Не удалось добавить видео')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex gap-2">
      <input
        type="url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') void handleSubmit() }}
        placeholder="Ссылка на YouTube / Vimeo"
        disabled={loading || busy}
        className="flex-1 h-10 rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-50"
      />
      <Button
        onClick={handleSubmit}
        loading={busy}
        disabled={loading || !url.trim()}
      >
        Добавить видео
      </Button>
      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
    </div>
  )
}

// ─── Список материалов темы ───────────────────────────────────────────────────

/**
 * canManage=true  — преподаватель: добавление, порядок, скрытие, удаление.
 * canManage=false — ученик: только чтение.
 *
 * Ученику скрытые материалы и закрытые темы не приходят из БД (RLS +
 * `topics.available_from`), поэтому здесь нет клиентской фильтрации:
 * полагаться на неё было бы ложной защитой.
 *
 * section — фильтр по рубрике или 'video'. Если задана, показываются только материалы
 * из этой рубрики/вида, и форма добавления подменяется.
 */
export function TopicMaterialItems({
  topicId,
  canManage,
  className,
  section,
  hideAddForm,
}: {
  topicId: string
  canManage: boolean
  className?: string
  section?: TopicMaterialSection | 'video'
  hideAddForm?: boolean
}) {
  const {
    materials, loading, error,
    uploadMaterialFile, addMaterial, deleteMaterial, toggleVisibility, moveMaterial,
  } = useTopicMaterialItems(topicId)
  const [actionError, setActionError] = useState<string | null>(null)

  function guard<T extends unknown[]>(fn: (...args: T) => Promise<unknown>) {
    return (...args: T) => {
      setActionError(null)
      fn(...args).catch((e: any) => setActionError(e?.message ?? 'Не удалось выполнить действие'))
    }
  }

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-gray-400', className)}>
        <Loader2 size={16} className="animate-spin" />
        Загрузка материалов…
      </div>
    )
  }

  // Фильтруем материалы по section
  let filtered = materials
  if (section && section !== 'video') {
    filtered = materials.filter(m => m.section === section)
  } else if (section === 'video') {
    filtered = materials.filter(m => m.kind === 'video')
  }

  const emptyMessage = section
    ? 'В этой рубрике пока пусто'
    : canManage ? 'Материалов пока нет' : 'Преподаватель ещё не добавил материалы'

  return (
    <div className={cn('space-y-3', className)}>
      {(error || actionError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{actionError || error}</div>
      )}

      {canManage && section === 'video' && (
        <VideoAddForm onAdd={addMaterial} loading={loading} />
      )}

      {canManage && section && section !== 'video' && (
        <QuickAttach onAdd={addMaterial} onUploadFile={uploadMaterialFile} section={section} />
      )}

      {canManage && !section && (
        <QuickAttach onAdd={addMaterial} onUploadFile={uploadMaterialFile} />
      )}

      {filtered.map((m, i) => (
        <MaterialCard
          key={m.id}
          material={m}
          topicId={topicId}
          canManage={canManage}
          isFirst={i === 0}
          isLast={i === filtered.length - 1}
          onDelete={guard(deleteMaterial)}
          onToggleVisibility={guard(toggleVisibility)}
          onMove={guard(moveMaterial)}
        />
      ))}

      {filtered.length === 0 && (
        <p className="rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
          {emptyMessage}
        </p>
      )}

      {canManage && !hideAddForm && !section && <AddMaterialForm onAdd={addMaterial} onUploadFile={uploadMaterialFile} />}
    </div>
  )
}
