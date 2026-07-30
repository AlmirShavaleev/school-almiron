import { useEffect, useRef, useState } from 'react'
import { Bell, Eye, EyeOff, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { TOPIC_HOMEWORK_BUCKET, formatBytes } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'
import { TopicHomeworkReview } from '@/components/courseProgram/TopicHomeworkReview'

const MAX_FILE_SIZE = 50 * 1024 * 1024

/**
 * Преподавательский блок ДЗ темы: прикрепить файлы, задать дедлайн и баллы,
 * опубликовать, оповестить в Telegram — и тут же проверить работы.
 *
 * Названия и инструкции в интерфейсе нет: ДЗ — это прикреплённые файлы.
 * Сама строка ДЗ создаётся лениво, при первом действии преподавателя.
 */
export function TopicHomeworkEditor({ topicId, className }: { topicId: string; className?: string }) {
  const {
    homework, files, attempts, attemptFiles, reviews, studentNames, loading, error,
    createHomework, updateHomework, uploadHomeworkFile, deleteHomeworkFile,
    reviewAttempt, notifyStudents,
  } = useTopicHomework(topicId)

  const [dueAt, setDueAt] = useState('')
  const [gradeScale, setGradeScale] = useState<'five' | 'hundred' | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const [notifyBusy, setNotifyBusy] = useState(false)
  const [notifiedCount, setNotifiedCount] = useState<number | null>(null)
  const [notifyError, setNotifyError] = useState<string | null>(null)

  // Загрузка файлов: последовательная, с прогрессом по текущему файлу.
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadIndex, setUploadIndex] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [current, setCurrent] = useState<{ name: string; percent: number } | null>(null)

  // Не даём создать два ДЗ на тему, если преподаватель успел кликнуть дважды:
  // одно и то же обещание переиспользуется, пока оно не упало с ошибкой.
  const ensuringRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    setDueAt(homework?.due_at ? homework.due_at.slice(0, 10) : '')
    setGradeScale(homework?.grade_scale ?? null)
  }, [homework?.id, homework?.due_at, homework?.grade_scale])

  /**
   * Создаёт ДЗ, если его ещё нет. Хук после создания синхронно запоминает
   * строку у себя, поэтому следующий шаг обработчика (загрузка файла или
   * сохранение поля) уже работает с готовым ДЗ — ждать ре-рендера не нужно.
   */
  async function ensureHomework(): Promise<void> {
    if (homework) return
    if (!ensuringRef.current) {
      ensuringRef.current = createHomework('', '', { due_at: dueAt || null, grade_scale: gradeScale })
        .then(() => undefined)
        .catch((e: unknown) => {
          ensuringRef.current = null // дать возможность повторить
          throw e
        })
    }
    await ensuringRef.current
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setLocalError(null)
    try {
      await fn()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  async function handleNotify() {
    setNotifyBusy(true)
    setNotifyError(null)
    try {
      setNotifiedCount(await notifyStudents())
    } catch (e: any) {
      setNotifyError(e?.message ?? 'Не удалось отправить оповещение')
    } finally {
      setNotifyBusy(false)
    }
  }

  async function handleFilesSelected(list: FileList) {
    const selected = Array.from(list)
    setUploadTotal(selected.length)
    setUploadError(null)
    setLocalError(null)
    setCurrent(null)
    setUploading(true)

    try {
      await ensureHomework()
    } catch (e: any) {
      setLocalError(e?.message ?? 'Не удалось создать ДЗ')
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    // Ошибка одного файла не отменяет остальные — просто копим список.
    const failed: string[] = []
    let firstError: string | null = null

    for (let i = 0; i < selected.length; i++) {
      setUploadIndex(i + 1)
      const file = selected[i]

      if (file.size > MAX_FILE_SIZE) {
        failed.push(file.name)
        if (!firstError) firstError = 'Файл слишком большой'
        continue
      }

      try {
        setCurrent({ name: file.name, percent: 0 })
        await uploadHomeworkFile(file, p =>
          setCurrent(c => (c ? { ...c, percent: p } : { name: file.name, percent: p })),
        )
      } catch (e: any) {
        failed.push(file.name)
        if (!firstError) firstError = e?.message ?? 'Ошибка загрузки'
      }
    }

    if (failed.length > 0) {
      setUploadError(`Не загружено: ${failed.join(', ')} (${firstError})`)
    }

    setUploading(false)
    setCurrent(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-gray-400', className)}>
        <Loader2 size={16} className="animate-spin" />
        Загрузка ДЗ…
      </div>
    )
  }

  const published = homework?.is_published ?? false
  const canPublish = files.length > 0

  return (
    <div className={cn('space-y-3', className)}>
      {(error || localError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FileText size={15} className="text-primary-600" />
          <span className="text-sm font-semibold text-gray-900">Домашнее задание</span>
          {published && (
            <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
              Опубликовано
            </span>
          )}
          {homework && !published && (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
              Скрыто
            </span>
          )}
          {saved && <span className="text-xs text-emerald-600">Сохранено</span>}
        </div>

        {/* 1. Зона загрузки: несколько файлов подряд, с прогрессом */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          onChange={e => {
            if (e.target.files) handleFilesSelected(e.target.files)
          }}
          aria-label="Прикрепить PDF или картинки"
          className="hidden"
          disabled={uploading}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 py-8 text-gray-400 transition-colors hover:border-primary-300 hover:text-primary-500',
            uploading && 'cursor-not-allowed opacity-50',
          )}
        >
          {uploading && current ? (
            <div className="w-full max-w-xs">
              <div className="mb-1 flex justify-between text-xs text-gray-500">
                <span className="truncate">{current.name}</span>
                <span>{current.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${current.percent}%` }} />
              </div>
              <div className="mt-1 text-center text-[11px] text-gray-400">Файл {uploadIndex} из {uploadTotal}</div>
            </div>
          ) : uploading ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm font-medium">Загрузка {uploadIndex} из {uploadTotal}…</span>
            </>
          ) : (
            <>
              <Upload size={20} />
              <div className="flex flex-col items-center gap-1">
                <span className="text-sm font-medium">Прикрепить PDF или картинки</span>
                <span className="text-xs">Можно выбрать несколько файлов · до 50 МБ каждый</span>
              </div>
            </>
          )}
        </button>

        {uploadError && (
          <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{uploadError}</div>
        )}

        {/* 2. Что уже прикреплено */}
        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map(f => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2"
              >
                <SignedFileLink
                  bucket={TOPIC_HOMEWORK_BUCKET}
                  url={f.storage_path}
                  className="inline-flex min-w-0 flex-1 items-center gap-2 text-sm text-primary-600 hover:underline"
                >
                  <FileText size={14} className="shrink-0" />
                  <span className="truncate">{f.original_filename}</span>
                  {formatBytes(f.size_bytes) && (
                    <span className="shrink-0 text-xs text-gray-400">({formatBytes(f.size_bytes)})</span>
                  )}
                </SignedFileLink>
                <button
                  type="button"
                  onClick={() => run(() => deleteHomeworkFile(f.id))}
                  disabled={busy}
                  aria-label={`Удалить файл ${f.original_filename}`}
                  title="Удалить файл"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* 3. Дедлайн и баллы — сохраняются сразу */}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Дедлайн</label>
            <input
              type="date"
              value={dueAt}
              onChange={e => {
                const next = e.target.value
                setDueAt(next)
                run(async () => {
                  await ensureHomework()
                  await updateHomework({ due_at: next || null })
                })
              }}
              aria-label="Дедлайн"
              className="h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <p className="mt-1 text-xs text-gray-400">Не блокирует сдачу — просто напоминание</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Баллы</label>
            <select
              value={gradeScale ?? ''}
              onChange={e => {
                const next = (e.target.value as 'five' | 'hundred' | '') || null
                setGradeScale(next)
                run(async () => {
                  await ensureHomework()
                  await updateHomework({ grade_scale: next })
                })
              }}
              aria-label="Шкала баллов"
              className="h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="">Без баллов</option>
              <option value="five">5-балльная</option>
              <option value="hundred">100-балльная</option>
            </select>
          </div>
        </div>

        {/* 4-5. Публикация и оповещение */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant={published ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => run(() => updateHomework({ is_published: !published }))}
            disabled={busy || (!published && !canPublish)}
            title={!published && !canPublish ? 'Сначала прикрепите файл задания' : undefined}
          >
            {published ? <EyeOff size={14} /> : <Eye size={14} />}
            {published ? 'Скрыть от учеников' : 'Опубликовать'}
          </Button>

          {published && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleNotify}
                disabled={notifyBusy}
                loading={notifyBusy}
              >
                <Bell size={14} />
                {notifiedCount === null
                  ? 'Оповестить в Telegram'
                  : `Оповестить в Telegram (${notifiedCount})`}
              </Button>
              {notifiedCount === 0 && (
                <span className="text-xs text-gray-400">Все уже оповещены</span>
              )}
            </>
          )}
        </div>

        {notifyError && (
          <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{notifyError}</div>
        )}

        {/* Локальная проверка работ этой темы. Общей очереди нет. */}
        {homework && (
          <TopicHomeworkReview
            className="mt-4"
            attempts={attempts}
            attemptFiles={attemptFiles}
            reviews={reviews}
            studentNames={studentNames}
            gradeScale={homework.grade_scale}
            onReview={reviewAttempt}
          />
        )}
      </div>
    </div>
  )
}
