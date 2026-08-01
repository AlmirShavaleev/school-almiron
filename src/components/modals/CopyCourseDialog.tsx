import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, AlertCircle } from 'lucide-react'
import { type CopyDateMode, type CopyProgress, shiftDaysBetween, defaultCopyTitle, copyCourse } from '@/lib/courseCopy'
import { CopyModalFrame, CopyDateModeField, CopyProgressBar, CopyScopeNote } from './copyDialogParts'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { type Course } from '@/hooks/useCourseProgram'

export function CopyCourseDialog({ open, onClose, course, onCopied }: {
  open: boolean
  onClose: () => void
  course: Course
  onCopied: (newCourseId: string) => void
}) {
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<CopyDateMode>('clear')
  const [newDate, setNewDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CopyProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [doneCourseId, setDoneCourseId] = useState<string | null>(null)

  // Состояние сбрасывается на открытии, а не на закрытии: после неудачной
  // попытки текст ошибки должен остаться на экране, пока преподаватель сам
  // не закроет окно.
  useEffect(() => {
    if (!open) return
    setTitle(defaultCopyTitle(course.title))
    setMode('clear')
    setNewDate(course.start_date ?? '')
    setBusy(false)
    setProgress(null)
    setError(null)
    setDoneCourseId(null)
  }, [open, course.id, course.title, course.start_date])

  const shiftDays = mode === 'shift' ? shiftDaysBetween(course.start_date, newDate) : 0

  const handleCopy = async () => {
    setBusy(true)
    setError(null)
    setProgress({ copied: 0, total: 0 })

    try {
      const plan = await copyCourse({
        sourceCourseId: course.id,
        title,
        mode,
        shiftDays,
        onProgress: setProgress,
      })

      if (plan.courseId) {
        setDoneCourseId(plan.courseId)
      } else {
        setError('Копия создана, но её адрес не вернулся — обновите страницу')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось скопировать курс')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const titleError = title.trim() === '' ? 'Название не может быть пустым' : ''

  return (
    <CopyModalFrame
      open={open}
      onClose={onClose}
      title="Скопировать курс"
      subtitle={course.title}
      busy={busy}
      testId="copy-course-dialog"
      footer={
        doneCourseId === null ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Отмена
            </Button>
            <Button
              onClick={handleCopy}
              loading={busy}
              disabled={busy || !title.trim()}
            >
              <Copy size={15} />
              Скопировать курс
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Закрыть
            </Button>
            <Button onClick={() => onCopied(doneCourseId)}>
              Открыть копию
            </Button>
          </div>
        )
      }
    >
      {doneCourseId === null ? (
        <div className="space-y-5">
          <Input
            label="Название копии"
            value={title}
            onChange={e => setTitle(e.target.value.slice(0, 200))}
            maxLength={200}
            error={titleError || undefined}
          />

          <CopyDateModeField
            mode={mode}
            onModeChange={setMode}
            anchorDate={course.start_date}
            anchorLabel="Новая дата старта"
            newDate={newDate}
            onNewDateChange={setNewDate}
            shiftDays={shiftDays}
            disabled={busy}
          />

          <CopyScopeNote kind="course" />

          {progress && <CopyProgressBar progress={progress} />}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              <div className="flex gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <div className="flex gap-3">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <h3 className="font-semibold text-emerald-900">Копия готова</h3>
              <p className="mt-1 text-sm text-emerald-800">
                Курс «{title}» создан черновиком. Проверьте материалы и опубликуйте его, когда всё будет на месте.
              </p>
            </div>
          </div>
        </div>
      )}
    </CopyModalFrame>
  )
}
