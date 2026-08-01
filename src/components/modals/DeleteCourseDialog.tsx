import { useEffect, useState } from 'react'
import { Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import {
  type CourseDeletePreview,
  type CourseDeleteResult,
  previewCourseDeletion,
  deleteCourse,
  describeDeletion,
  describeBlocker,
  plural,
} from '@/lib/courseDelete'
import { CopyModalFrame } from './copyDialogParts'
import { Button } from '@/components/ui/Button'

export function DeleteCourseDialog({ open, onClose, courseId, courseTitle, onDeleted }: {
  open: boolean
  onClose: () => void
  courseId: string
  courseTitle: string
  onDeleted: () => void
}) {
  if (!open) return null
  return <DeleteCourseDialogBody courseId={courseId} courseTitle={courseTitle} onClose={onClose} onDeleted={onDeleted} key={courseId} />
}

function DeleteCourseDialogBody({ courseId, courseTitle, onClose, onDeleted }: {
  courseId: string
  courseTitle: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [preview, setPreview] = useState<CourseDeletePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CourseDeleteResult | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadPreview = async () => {
      try {
        const p = await previewCourseDeletion(courseId)
        if (!cancelled) setPreview(p)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось посчитать содержимое курса')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadPreview()
    return () => { cancelled = true }
  }, [courseId])

  const handleDelete = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await deleteCourse(courseId)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить курс')
    } finally {
      setBusy(false)
    }
  }

  const canDelete = !loading && preview && preview.blockers.length === 0

  return (
    <CopyModalFrame
      open
      onClose={onClose}
      title="Удалить курс"
      subtitle={courseTitle}
      busy={busy}
      testId="delete-course-dialog"
      footer={
        result === null ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              loading={busy}
              disabled={busy || loading || !preview || preview.blockers.length > 0}
            >
              <Trash2 size={15} />
              Удалить навсегда
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                onClose()
                onDeleted()
              }}
            >
              Закрыть
            </Button>
          </div>
        )
      }
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm text-graphite-600">Считаю, что войдёт в удаление…</span>
        </div>
      ) : result === null ? (
        <div className="space-y-5">
          {preview && preview.blockers.length > 0 ? (
            // Блокеры удаления
            <div className="space-y-3">
              {preview.blockers.map((blocker, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
                >
                  {describeBlocker(blocker)}
                </div>
              ))}
            </div>
          ) : (
            // Список того, что удалится
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <h3 className="font-semibold text-red-900">Это нельзя отменить</h3>
              {preview ? (
                <>
                  {describeDeletion(preview.counts).length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-red-800">
                      {describeDeletion(preview.counts).map((item, idx) => (
                        <li key={idx}>• {item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-red-800">Курс пустой — терять нечего.</p>
                  )}
                </>
              ) : null}
            </div>
          )}

          {preview && (
            <div className="rounded-xl bg-gray-100 px-3 py-2.5 text-xs text-gray-600">
              Оригиналы заданий в банке и сами тесты останутся — удаляются только их привязки к темам этого курса.
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        // Результат удаления
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
          <div className="flex gap-3">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <h3 className="font-semibold text-emerald-900">Курс удалён</h3>
              <p className="mt-1 text-sm text-emerald-800">
                Курс «{courseTitle}» и всё его содержимое удалены.
              </p>
              {result.failedFiles > 0 && (
                <p className="mt-2 text-sm text-emerald-800">
                  {result.failedFiles} {plural(result.failedFiles, 'файл', 'файла', 'файлов')} не удалось убрать из хранилища. На работу школы это не влияет, но место они занимают — скажите об этом при следующей уборке.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </CopyModalFrame>
  )
}
