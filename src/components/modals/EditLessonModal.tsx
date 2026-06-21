import { useState, useEffect } from 'react'
import { X, Loader2, AlertTriangle, Calendar, Clock, Video, User, Save } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

interface Teacher {
  id:        string
  full_name: string
}

interface EditLessonProps {
  open: boolean
  lesson: {
    id:               string
    title:            string
    scheduled_at:     string
    duration_minutes: number | null
    zoom_link:        string | null
    notes:            string | null
    teacher_id:       string | null   // teachers.id
    group_id:         string | null
  }
  onClose:  () => void
  onSaved:  (patch: {
    title:            string
    scheduled_at:     string
    duration_minutes: number
    zoom_link:        string | null
    notes:            string | null
    teacher_id:       string
  }) => void
}

// Convert UTC ISO string → datetime-local value (local time)
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function EditLessonModal({ open, lesson, onClose, onSaved }: EditLessonProps) {
  const [title,       setTitle]       = useState('')
  const [dateTime,    setDateTime]    = useState('')
  const [duration,    setDuration]    = useState(90)
  const [teacherId,   setTeacherId]   = useState('')
  const [zoomLink,    setZoomLink]    = useState('')
  const [notes,       setNotes]       = useState('')
  const [teachers,    setTeachers]    = useState<Teacher[]>([])
  const [saving,      setSaving]      = useState(false)
  const [conflict,    setConflict]    = useState<string | null>(null)
  const [fieldError,  setFieldError]  = useState<string | null>(null)

  // Sync form when lesson prop changes or modal opens
  useEffect(() => {
    if (!open) return
    setTitle(lesson.title)
    setDateTime(toDateTimeLocal(lesson.scheduled_at))
    setDuration(lesson.duration_minutes ?? 90)
    setTeacherId(lesson.teacher_id ?? '')
    setZoomLink(lesson.zoom_link ?? '')
    setNotes(lesson.notes ?? '')
    setConflict(null)
    setFieldError(null)
  }, [open, lesson])

  // Load active teachers on open
  useEffect(() => {
    if (!open) return
    supabase
      .from('teachers')
      .select('id, profiles(full_name)')
      .eq('is_active', true)
      .order('id')
      .then(({ data }) => {
        setTeachers(
          (data || []).map((t: any) => ({
            id:        t.id,
            full_name: t.profiles?.full_name ?? '—',
          }))
        )
      })
  }, [open])

  async function checkConflicts(
    scheduledISO: string,
    durationMins: number,
    selectedTeacherId: string,
  ): Promise<string | null> {
    const start = new Date(scheduledISO)
    const end   = new Date(start.getTime() + durationMins * 60_000)

    // Helper: do two intervals [s1,e1) and [s2,e2) overlap?
    function overlaps(s2: Date, e2: Date) {
      return start < e2 && end > s2
    }

    // Group conflict
    if (lesson.group_id) {
      const { data } = await supabase
        .from('lessons')
        .select('id, title, scheduled_at, duration_minutes')
        .eq('group_id', lesson.group_id)
        .neq('id', lesson.id)
        .neq('status', 'cancelled')

      const hit = (data ?? []).find(l => {
        const s = new Date(l.scheduled_at)
        const e = new Date(s.getTime() + (l.duration_minutes ?? 60) * 60_000)
        return overlaps(s, e)
      })
      if (hit) return `Конфликт группы: занятие «${hit.title}» уже занимает это время`
    }

    // Teacher conflict
    if (selectedTeacherId) {
      const { data } = await supabase
        .from('lessons')
        .select('id, title, scheduled_at, duration_minutes')
        .eq('teacher_id', selectedTeacherId)
        .neq('id', lesson.id)
        .neq('status', 'cancelled')

      const hit = (data ?? []).find(l => {
        const s = new Date(l.scheduled_at)
        const e = new Date(s.getTime() + (l.duration_minutes ?? 60) * 60_000)
        return overlaps(s, e)
      })
      if (hit) return `Конфликт преподавателя: он уже ведёт «${hit.title}» в это время`
    }

    return null
  }

  async function handleSave() {
    setFieldError(null)
    setConflict(null)

    // Basic validation
    if (!title.trim()) { setFieldError('Введите название занятия'); return }
    if (!dateTime)      { setFieldError('Укажите дату и время');    return }
    if (!teacherId)     { setFieldError('Выберите преподавателя');   return }
    if (duration < 15 || duration > 480) {
      setFieldError('Длительность: от 15 до 480 минут')
      return
    }

    const scheduledISO = new Date(dateTime).toISOString()
    if (new Date(scheduledISO) <= new Date()) {
      setFieldError('Дата занятия должна быть в будущем')
      return
    }

    setSaving(true)

    // Conflict check before saving
    const conflictMsg = await checkConflicts(scheduledISO, duration, teacherId)
    if (conflictMsg) {
      setConflict(conflictMsg)
      setSaving(false)
      return
    }

    const patch = {
      title:            title.trim(),
      scheduled_at:     scheduledISO,
      duration_minutes: duration,
      teacher_id:       teacherId,
      zoom_link:        zoomLink.trim() || null,
      notes:            notes.trim() || null,
    }

    const { error } = await supabase
      .from('lessons')
      .update(patch)
      .eq('id', lesson.id)

    setSaving(false)

    if (error) {
      setFieldError('Ошибка сохранения: ' + error.message)
      return
    }

    onSaved(patch)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-900 text-base">Редактировать занятие</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Title */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Название</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Название занятия"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Date/time + duration */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Calendar size={13} />Дата и время
              </label>
              <input
                type="datetime-local"
                value={dateTime}
                onChange={e => setDateTime(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Clock size={13} />Длительность (мин)
              </label>
              <input
                type="number"
                value={duration}
                onChange={e => setDuration(Number(e.target.value))}
                min={15}
                max={480}
                step={5}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Teacher */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <User size={13} />Преподаватель
            </label>
            <select
              value={teacherId}
              onChange={e => setTeacherId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="">— выберите —</option>
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.full_name}</option>
              ))}
            </select>
          </div>

          {/* Zoom link */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Video size={13} />Ссылка на Zoom
            </label>
            <input
              type="url"
              value={zoomLink}
              onChange={e => setZoomLink(e.target.value)}
              placeholder="https://zoom.us/j/..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Описание</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Описание занятия…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>

          {/* Field error */}
          {fieldError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              {fieldError}
            </div>
          )}

          {/* Conflict warning */}
          {conflict && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-0.5">Конфликт расписания</div>
                {conflict}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving}>
            <Save size={13} className="mr-1.5" />Сохранить
          </Button>
        </div>
      </div>
    </div>
  )
}
