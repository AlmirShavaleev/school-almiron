import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, AlertCircle, Loader2 } from 'lucide-react'
import {
  type CopyDateMode,
  type CopyProgress,
  shiftDaysBetween,
  copyTopic,
} from '@/lib/courseCopy'
import { CopyModalFrame, CopyDateModeField, CopyProgressBar, CopyScopeNote } from './copyDialogParts'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { type Course, type Module, type Topic } from '@/hooks/useCourseProgram'

export function CopyTopicDialog({
  open,
  onClose,
  topic,
  sourceCourseId,
  courses,
  loadModules,
  onCopied,
}: {
  open: boolean
  onClose: () => void
  topic: Topic | null
  sourceCourseId: string | null
  courses: Course[]
  loadModules: (courseId: string) => Promise<Module[]>
  onCopied: (targetCourseId: string, targetModuleId: string) => void
}) {
  if (!open || !topic) return null

  return (
    <CopyTopicDialogBody
      key={topic.id}
      open={open}
      onClose={onClose}
      topic={topic}
      sourceCourseId={sourceCourseId}
      courses={courses}
      loadModules={loadModules}
      onCopied={onCopied}
    />
  )
}

function CopyTopicDialogBody({
  open,
  onClose,
  topic,
  sourceCourseId,
  courses,
  loadModules,
  onCopied,
}: {
  open: boolean
  onClose: () => void
  topic: Topic
  sourceCourseId: string | null
  courses: Course[]
  loadModules: (courseId: string) => Promise<Module[]>
  onCopied: (targetCourseId: string, targetModuleId: string) => void
}) {
  const [targetCourseId, setTargetCourseId] = useState(sourceCourseId ?? courses[0]?.id ?? '')
  const [modules, setModules] = useState<Module[]>([])
  const [modulesLoading, setModulesLoading] = useState(false)
  const [modulesError, setModulesError] = useState<string | null>(null)
  const [targetModuleId, setTargetModuleId] = useState('')
  const [mode, setMode] = useState<CopyDateMode>('clear')
  const [newDate, setNewDate] = useState(topic.available_from ?? '')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<CopyProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // `loadModules` приходит из хука и пересоздаётся на каждый рендер. В
  // зависимостях эффекта с setState внутри это замкнутый круг: рендер → новая
  // ссылка → эффект → setState → рендер. Ровно на этом стояла поломка
  // «адрес меняется, страница нет». Держим функцию в ref, зависим от id курса.
  const loadModulesRef = useRef(loadModules)
  loadModulesRef.current = loadModules

  // Защита от гонки: при быстром переключении курсов ответ по старому курсу
  // не должен перезаписать список нового.
  useEffect(() => {
    if (!targetCourseId) {
      setModules([])
      setModulesError(null)
      return
    }

    setModulesLoading(true)
    setModulesError(null)
    let cancelled = false

    const load = async () => {
      try {
        const mods = await loadModulesRef.current(targetCourseId)
        if (cancelled) return
        setModules(mods)
        setTargetModuleId(mods[0]?.id ?? '')
      } catch (err) {
        if (cancelled) return
        setModules([])
        setTargetModuleId('')
        setModulesError(err instanceof Error ? err.message : 'Не удалось загрузить модули')
      } finally {
        if (!cancelled) setModulesLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [targetCourseId])

  const shiftDays = mode === 'shift' ? shiftDaysBetween(topic.available_from, newDate) : 0

  const handleCopy = async () => {
    setBusy(true)
    setError(null)
    setProgress({ copied: 0, total: 0 })

    try {
      await copyTopic({
        sourceTopicId: topic.id,
        targetModuleId,
        mode,
        shiftDays,
        onProgress: setProgress,
      })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось скопировать тему')
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }

  const targetCourse = courses.find((c) => c.id === targetCourseId)
  const targetModule = modules.find((m) => m.id === targetModuleId)

  // Активные курсы перед архивными для удобства выбора
  const courseOptions = [
    ...courses
      .filter((c) => c.is_active)
      .map((c) => ({ value: c.id, label: c.title })),
    ...courses
      .filter((c) => !c.is_active)
      .map((c) => ({ value: c.id, label: `${c.title} · архив` })),
  ]

  const moduleOptions = modules.map((m) => ({ value: m.id, label: m.title }))

  return (
    <CopyModalFrame
      open={open}
      onClose={onClose}
      title="Скопировать тему в другой курс"
      subtitle={topic.title}
      busy={busy}
      testId="copy-topic-dialog"
      footer={
        !done ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Отмена
            </Button>
            <Button
              onClick={handleCopy}
              loading={busy}
              disabled={busy || !targetModuleId}
            >
              <Copy size={15} />
              Скопировать тему
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Закрыть
            </Button>
            <Button onClick={() => onCopied(targetCourseId, targetModuleId)}>
              Перейти к копии
            </Button>
          </div>
        )
      }
    >
      {!done ? (
        <div className="space-y-5">
          <Select
            label="Куда копировать"
            value={targetCourseId}
            onChange={(e) => setTargetCourseId(e.target.value)}
            options={courseOptions}
            disabled={busy}
          />

          {modulesLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 size={14} className="animate-spin" />
              Загружаю модули…
            </div>
          ) : modulesError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              Не удалось получить модули курса: {modulesError}
            </div>
          ) : modules.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              В этом курсе нет ни одного модуля. Создайте модуль в программе курса — тему нужно куда-то положить.
            </div>
          ) : (
            <Select
              label="В какой модуль"
              value={targetModuleId}
              onChange={(e) => setTargetModuleId(e.target.value)}
              options={moduleOptions}
              disabled={busy}
            />
          )}

          <CopyDateModeField
            mode={mode}
            onModeChange={setMode}
            anchorDate={topic.available_from}
            anchorLabel="Новая дата открытия темы"
            newDate={newDate}
            onNewDateChange={setNewDate}
            shiftDays={shiftDays}
            disabled={busy}
          />

          <CopyScopeNote kind="topic" />

          {progress && <CopyProgressBar progress={progress} />}

          {error && (
            <div
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
              role="alert"
            >
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
              <h3 className="font-semibold text-emerald-900">Тема скопирована</h3>
              <p className="mt-1 text-sm text-emerald-800">
                Тема «{topic.title}» добавлена в модуль «{targetModule?.title}» курса «{targetCourse?.title}». Оригинал остался на месте.
              </p>
            </div>
          </div>
        </div>
      )}
    </CopyModalFrame>
  )
}
