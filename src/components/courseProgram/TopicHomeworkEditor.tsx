import { useEffect, useState } from 'react'
import { Bell, Eye, EyeOff, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { TOPIC_HOMEWORK_BUCKET, formatBytes } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'
import { TopicHomeworkReview } from '@/components/courseProgram/TopicHomeworkReview'

/** Что принимаем как файл задания: PDF и картинки. */
const HOMEWORK_ACCEPT = 'application/pdf,image/*'

/**
 * Преподавательский блок ДЗ темы.
 *
 * Сознательно упрощён: у темы одно ДЗ, поэтому ни названия, ни инструкции
 * здесь нет — заголовок «Домашнее задание» ничего не сообщал, а инструкция
 * жила в самом PDF. Осталось то, что действительно решает преподаватель:
 * файлы, дедлайн, шкала баллов, публикация и оповещение.
 *
 * Строка ДЗ в базе заводится лениво (`ensureHomework`) — при первом файле
 * или первой настройке. Пустых черновиков от случайного открытия плитки
 * больше не остаётся.
 */
export function TopicHomeworkEditor({ topicId, className }: { topicId: string; className?: string }) {
  const {
    homework, files, attempts, attemptFiles, reviews, studentNames, loading, error,
    updateHomework, uploadHomeworkFiles, removeHomeworkFile,
    reviewAttempt, notifyStudents, notifyRecipientCount,
  } = useTopicHomework(topicId)

  const [dueAt, setDueAt] = useState('')
  const [gradeScale, setGradeScale] = useState<'five' | 'hundred' | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<{ name: string; percent: number }[]>([])
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [notifyMessage, setNotifyMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setDueAt(homework?.due_at ? homework.due_at.slice(0, 10) : '')
    setGradeScale(homework?.grade_scale ?? null)
  }, [homework?.id, homework?.due_at, homework?.grade_scale])

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

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length === 0) return

    setUploads(picked.map(f => ({ name: f.name, percent: 0 })))
    setLocalError(null)
    try {
      await uploadHomeworkFiles(picked, (index, percent) => {
        setUploads(prev => prev.map((u, i) => (i === index ? { ...u, percent } : u)))
      })
    } catch (err: any) {
      setLocalError(err?.message ?? 'Не удалось загрузить файлы')
    } finally {
      setUploads([])
    }
  }

  async function handleNotify() {
    setNotifyBusy(true)
    setNotifyMessage(null)
    try {
      const n = await notifyStudents()
      if (n > 0) {
        setNotifyMessage({ type: 'success', text: `Оповещение отправлено: ${n} ученика(ов) в очереди` })
      } else {
        setNotifyMessage({ type: 'warning', text: 'Все уже оповещены (или ни у кого не привязан Telegram)' })
      }
      setTimeout(() => setNotifyMessage(null), 3000)
    } catch (e: any) {
      setNotifyMessage({ type: 'error', text: e?.message ?? 'Не удалось отправить оповещение' })
    } finally {
      setNotifyBusy(false)
    }
  }

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-gray-400', className)}>
        <Loader2 size={16} className="animate-spin" />
        Загрузка ДЗ…
      </div>
    )
  }

  const uploading = uploads.length > 0
  // Публиковать нечего, пока нет ни одного файла задания.
  const canPublish = files.length > 0
  const isPublished = !!homework?.is_published

  return (
    <div className={cn('space-y-3', className)}>
      {(error || localError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-primary-600" />
            <span className="text-sm font-semibold text-gray-900">Домашнее задание</span>
            {homework && !isPublished && (
              <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                Скрыто
              </span>
            )}
          </div>
          <Button
            variant={isPublished ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => run(() => updateHomework({ is_published: !isPublished }))}
            disabled={busy || uploading || (!isPublished && !canPublish)}
            title={!isPublished && !canPublish ? 'Сначала загрузите файл задания' : undefined}
          >
            {isPublished ? <EyeOff size={14} /> : <Eye size={14} />}
            {isPublished ? 'Скрыть от учеников' : 'Опубликовать'}
          </Button>
        </div>

        {/* ── Файлы задания ── */}
        <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Файлы задания
          </div>

          {files.length === 0 && !uploading && (
            <p className="mb-2 text-sm text-gray-400">Файлы ещё не загружены</p>
          )}

          {files.length > 0 && (
            <ul className="mb-2 space-y-1">
              {files.map(f => (
                <li key={f.id} className="flex items-center justify-between gap-2">
                  <SignedFileLink
                    bucket={TOPIC_HOMEWORK_BUCKET}
                    url={f.storage_path}
                    className="inline-flex min-w-0 items-center gap-2 text-sm text-primary-600 hover:underline"
                  >
                    <FileText size={14} className="shrink-0" />
                    <span className="truncate">{f.original_filename}</span>
                    {formatBytes(f.size_bytes) && (
                      <span className="shrink-0 text-xs text-gray-400">({formatBytes(f.size_bytes)})</span>
                    )}
                  </SignedFileLink>
                  <button
                    type="button"
                    onClick={() => run(() => removeHomeworkFile(f.id, f.storage_path))}
                    disabled={busy || uploading}
                    aria-label={`Удалить файл ${f.original_filename}`}
                    title="Удалить файл"
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {uploading && (
            <ul className="mb-2 space-y-1.5">
              {uploads.map((u, i) => (
                <li key={`${u.name}-${i}`}>
                  <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span className="truncate">{u.name}</span>
                    <span className="shrink-0 tabular-nums">{u.percent}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all"
                      style={{ width: `${u.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <label
            className={cn(
              'inline-flex items-center gap-2 text-sm text-primary-600',
              uploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:underline',
            )}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Загрузка…' : 'Загрузить файлы'}
            <input
              type="file"
              accept={HOMEWORK_ACCEPT}
              multiple
              disabled={uploading}
              onChange={handleFiles}
              aria-label="Загрузить файлы задания"
              className="hidden"
            />
          </label>
          <p className="mt-1 text-xs text-gray-400">PDF и картинки, можно несколько сразу</p>
        </div>

        {/* ── Дедлайн и баллы ── */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Дедлайн</label>
            <input
              type="date"
              value={dueAt}
              min="2020-01-01"
              onChange={e => {
                setDueAt(e.target.value)
                run(() => updateHomework({ due_at: e.target.value || null }))
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
                const newScale = (e.target.value as 'five' | 'hundred' | '') || null
                setGradeScale(newScale)
                run(() => updateHomework({ grade_scale: newScale }))
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

        {saved && <div className="mb-3 text-xs text-emerald-600">Сохранено</div>}

        {notifyMessage && (
          <div
            className={cn(
              'mb-4 rounded-xl px-3 py-2 text-sm',
              notifyMessage.type === 'success' && 'bg-emerald-50 text-emerald-700',
              notifyMessage.type === 'warning' && 'bg-gray-50 text-gray-600',
              notifyMessage.type === 'error' && 'bg-red-50 text-red-700',
            )}
          >
            {notifyMessage.text}
          </div>
        )}

        {/* Оповещение появляется только после публикации: до неё ученик ДЗ не видит. */}
        {isPublished && (
          <div className="mb-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleNotify}
              disabled={notifyBusy}
              loading={notifyBusy}
            >
              <Bell size={14} />
              {notifyRecipientCount === null
                ? 'Оповестить в Telegram'
                : `Оповестить в Telegram (${notifyRecipientCount})`}
            </Button>
            {notifyRecipientCount === 0 && (
              <p className="mt-1 text-xs text-gray-400">Ни у кого из учеников курса не привязан Telegram</p>
            )}
          </div>
        )}

        {/* Локальная проверка работ этой темы. Общая очередь — на /homework-queue. */}
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
