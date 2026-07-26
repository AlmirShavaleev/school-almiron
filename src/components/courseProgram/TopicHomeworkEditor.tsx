import { useEffect, useState } from 'react'
import { Eye, EyeOff, FileText, Loader2, Plus, Save, Upload } from 'lucide-react'
import { useTopicHomework } from '@/hooks/useTopicHomework'
import { Button } from '@/components/ui/Button'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { TOPIC_HOMEWORK_BUCKET, formatBytes } from '@/lib/topicHomework'
import { cn } from '@/utils/cn'
import { TopicHomeworkReview } from '@/components/courseProgram/TopicHomeworkReview'

/**
 * Преподавательский блок PDF-ДЗ темы: одно ДЗ, инструкция, PDF, публикация
 * и локальная проверка работ учеников этой темы.
 *
 * Общей очереди проверки здесь нет — она отдельным этапом.
 */
export function TopicHomeworkEditor({ topicId, className }: { topicId: string; className?: string }) {
  const {
    homework, files, attempts, attemptFiles, reviews, studentNames, loading, error,
    createHomework, updateHomework, uploadHomeworkFile, reviewAttempt,
  } = useTopicHomework(topicId)

  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    setTitle(homework?.title ?? '')
    setInstructions(homework?.instructions ?? '')
  }, [homework?.id, homework?.title, homework?.instructions])

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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await run(() => uploadHomeworkFile(file))
    e.target.value = ''
  }

  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-6 text-sm text-gray-400', className)}>
        <Loader2 size={16} className="animate-spin" />
        Загрузка ДЗ…
      </div>
    )
  }

  const currentFile = files[0] ?? null

  return (
    <div className={cn('space-y-3', className)}>
      {(error || localError) && (
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{localError || error}</div>
      )}

      {!homework && (
        <div className="rounded-2xl border border-dashed border-gray-200 p-4">
          <div className="mb-2 text-sm font-semibold text-gray-900">Домашнее задание</div>
          <p className="mb-3 text-xs text-gray-500">Одно PDF-ДЗ на тему. Дедлайнов и баллов нет.</p>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Название ДЗ"
            aria-label="Название ДЗ"
            className="mb-2 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="Инструкция для ученика"
            aria-label="Инструкция"
            rows={3}
            className="mb-3 w-full rounded-xl border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <Button onClick={() => run(() => createHomework(title, instructions))} loading={busy}>
            <Plus size={15} />
            Создать ДЗ
          </Button>
        </div>
      )}

      {homework && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-primary-600" />
              <span className="text-sm font-semibold text-gray-900">Домашнее задание</span>
              {!homework.is_published && (
                <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                  Скрыто
                </span>
              )}
            </div>
            <Button
              variant={homework.is_published ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => run(() => updateHomework({ is_published: !homework.is_published }))}
              disabled={busy}
            >
              {homework.is_published ? <EyeOff size={14} /> : <Eye size={14} />}
              {homework.is_published ? 'Скрыть от учеников' : 'Опубликовать'}
            </Button>
          </div>

          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            aria-label="Название ДЗ"
            className="mb-2 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="Инструкция для ученика"
            aria-label="Инструкция"
            rows={3}
            className="mb-2 w-full rounded-xl border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />

          <div className="mb-3 flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => run(() => updateHomework({ title: title.trim(), instructions: instructions.trim() || null }))}
              loading={busy}
            >
              <Save size={14} />
              Сохранить
            </Button>
            {saved && <span className="text-xs text-emerald-600">Сохранено</span>}
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Файл задания
            </div>

            {currentFile ? (
              <SignedFileLink
                bucket={TOPIC_HOMEWORK_BUCKET}
                url={currentFile.storage_path}
                className="mb-2 inline-flex items-center gap-2 text-sm text-primary-600 hover:underline"
              >
                <FileText size={14} />
                {currentFile.original_filename}
                {formatBytes(currentFile.size_bytes) && (
                  <span className="text-xs text-gray-400">({formatBytes(currentFile.size_bytes)})</span>
                )}
              </SignedFileLink>
            ) : (
              <p className="mb-2 text-sm text-gray-400">Файл ещё не загружен</p>
            )}

            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary-600 hover:underline">
              <Upload size={14} />
              {currentFile ? 'Заменить PDF' : 'Загрузить PDF'}
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFile}
                aria-label={currentFile ? 'Заменить PDF' : 'Загрузить PDF'}
                className="hidden"
              />
            </label>
          </div>

          {/* Локальная проверка работ этой темы. Общей очереди нет. */}
          <TopicHomeworkReview
            className="mt-4"
            attempts={attempts}
            attemptFiles={attemptFiles}
            reviews={reviews}
            studentNames={studentNames}
            onReview={reviewAttempt}
          />
        </div>
      )}
    </div>
  )
}
