import { useState, useEffect, useRef } from 'react'
import {
  X, AlertTriangle, Calendar, Clock, Video, User, Save,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
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

const DURATION_PRESETS = [45, 60, 90] as const

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
const WEEK_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toLocalDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatSelectedDate(value: string): string {
  if (!value) return 'Выберите дату'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

export function EditLessonModal({
  open, lesson, onClose, onSaved, canChangeTeacher = true,
}: EditLessonProps & { canChangeTeacher?: boolean }) {
  const [title,        setTitle]        = useState('')
  const [date,         setDate]         = useState('')
  const [time,         setTime]         = useState('')
  const [duration,     setDuration]     = useState<number>(90)
  const [teacherId,    setTeacherId]    = useState('')
  const [zoomLink,     setZoomLink]     = useState('')
  const [notes,        setNotes]        = useState('')
  const [teachers,     setTeachers]     = useState<Teacher[]>([])
  const [saving,       setSaving]       = useState(false)
  const [conflict,     setConflict]     = useState<string | null>(null)
  const [fieldError,   setFieldError]   = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [viewMonth,    setViewMonth]    = useState(() => new Date())
  const calendarRef = useRef<HTMLDivElement>(null)

  // Sync form when lesson prop changes or modal opens
  useEffect(() => {
    if (!open) return
    const local = toLocalDateParts(lesson.scheduled_at)
    setTitle(lesson.title)
    setDate(local.date)
    setTime(local.time)
    setDuration(lesson.duration_minutes ?? 90)
    setTeacherId(lesson.teacher_id ?? '')
    setZoomLink(lesson.zoom_link ?? '')
    setNotes(lesson.notes ?? '')
    setConflict(null)
    setFieldError(null)
    setCalendarOpen(false)
    const [year, month] = local.date.split('-').map(Number)
    setViewMonth(new Date(year, month - 1, 1))
  }, [open, lesson])

  useEffect(() => {
    if (!calendarOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!calendarRef.current?.contains(event.target as Node)) {
        setCalendarOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [calendarOpen])

  // Load active teachers on open
  useEffect(() => {
    if (!open) return
    supabase
      .from('teachers')
      .select('id, profiles(full_name)')
      .eq('is_active', true)
      .order('id')
      .then(({ data }) => {
        const rows = (data || []) as Array<{
          id: string
          profiles: { full_name: string | null } | null
        }>
        setTeachers(
          rows.map(t => ({
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
    if (!date)         { setFieldError('Укажите дату занятия'); return }
    if (!time)         { setFieldError('Укажите время занятия'); return }
    if (!teacherId)    { setFieldError('Выберите преподавателя'); return }
    if (!duration || duration < 15 || duration > 480) {
      setFieldError('Длительность: от 15 до 480 минут')
      return
    }

    const scheduledDate = new Date(`${date}T${time}`)
    if (Number.isNaN(scheduledDate.getTime())) {
      setFieldError('Укажите корректные дату и время')
      return
    }
    const scheduledISO = scheduledDate.toISOString()
    if (scheduledDate <= new Date()) {
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

  const selectedDate = date ? new Date(`${date}T00:00:00`) : null
  const todayValue = toDateValue(new Date())
  const firstWeekday = (new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay() + 6) % 7
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
  const calendarCells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]

  function changeMonth(offset: number) {
    setViewMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  function selectDay(day: number) {
    const nextDate = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day)
    setDate(toDateValue(nextDate))
    setCalendarOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="font-bold text-gray-900 text-base">Редактировать занятие</h2>
          <button
            onClick={onClose}
            className="w-11 h-11 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">

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

          {/* Date + time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div ref={calendarRef} className="relative space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Calendar size={13} />Дата
              </label>
              <button
                type="button"
                onClick={() => setCalendarOpen(current => !current)}
                className={cn(
                  'w-full min-h-11 border rounded-xl px-3 py-2 text-sm text-left',
                  'flex items-center justify-between gap-2 bg-white transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-primary-500',
                  date ? 'border-gray-200 text-gray-900' : 'border-gray-200 text-gray-400',
                  calendarOpen && 'ring-2 ring-primary-500 border-transparent'
                )}
                aria-haspopup="dialog"
                aria-expanded={calendarOpen}
              >
                <span>{formatSelectedDate(date)}</span>
                <Calendar size={15} className="text-gray-400 shrink-0" />
              </button>

              {calendarOpen && (
                <div
                  role="dialog"
                  aria-label="Выбор даты"
                  className="fixed z-30 left-3 right-3 top-1/2 -translate-y-1/2 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:translate-y-0 sm:mt-2 sm:w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
                >
                  <div className="flex items-center justify-between mb-3">
                    <button
                      type="button"
                      onClick={() => changeMonth(-1)}
                      className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                      aria-label="Предыдущий месяц"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="text-sm font-semibold text-gray-800">
                      {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
                    </div>
                    <button
                      type="button"
                      onClick={() => changeMonth(1)}
                      className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                      aria-label="Следующий месяц"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {WEEK_DAYS.map(day => (
                      <div key={day} className="h-7 flex items-center justify-center text-[11px] font-medium text-gray-400">
                        {day}
                      </div>
                    ))}
                    {calendarCells.map((day, index) => {
                      if (day === null) return <div key={`empty-${index}`} className="h-11" />

                      const value = toDateValue(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day))
                      const isSelected = selectedDate !== null && value === date
                      const isToday = value === todayValue

                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => selectDay(day)}
                          className={cn(
                            'h-11 rounded-lg text-xs font-medium transition-colors',
                            'focus:outline-none focus:ring-2 focus:ring-primary-400',
                            isSelected
                              ? 'bg-primary-600 text-white'
                              : 'text-gray-700 hover:bg-primary-50 hover:text-primary-700',
                            isToday && !isSelected && 'ring-1 ring-primary-300 text-primary-700'
                          )}
                          aria-label={formatSelectedDate(value)}
                          aria-pressed={isSelected}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Clock size={13} />Время
              </label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full min-h-11 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Clock size={13} />Длительность (мин)
            </label>
            <div className="flex items-center gap-2">
              {DURATION_PRESETS.map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDuration(option)}
                  className={cn(
                    'min-h-11 px-3 py-2 rounded-xl border text-sm font-medium transition-colors shrink-0',
                    'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                    duration === option
                      ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-primary-300 hover:text-primary-600'
                  )}
                  aria-pressed={duration === option}
                >
                  {option} мин
                </button>
              ))}
              <input
                type="number"
                value={duration}
                onChange={e => setDuration(Math.max(1, Number(e.target.value) || 1))}
                min={15}
                max={480}
                step={5}
                aria-label="Произвольная длительность в минутах"
                className="w-24 min-h-11 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Teacher */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <User size={13} />Преподаватель
            </label>
            {canChangeTeacher ? (
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
            ) : (
              <div className="w-full border border-gray-100 bg-gray-50 rounded-xl px-3 py-2 text-sm text-gray-700">
                {teachers.find(t => t.id === teacherId)?.full_name ?? '—'}
              </div>
            )}
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
        <div className="px-4 sm:px-6 py-4 border-t border-gray-100 shrink-0 flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-3">
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
