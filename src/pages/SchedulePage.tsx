import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Video, Users, Clock, Plus, Calendar } from 'lucide-react'
import { useLessons, type Lesson } from '@/hooks/useLessons'
import { useAuthStore } from '@/store/authStore'
import { CreateLessonModal } from '@/components/modals/CreateLessonModal'
import { cn } from '@/utils/cn'

const WEEKDAYS   = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const HOURS      = Array.from({ length: 14 }, (_, i) => i + 8) // 08:00–21:00
const SLOT_H     = 56 // px per hour

function getMonday(d: Date) {
  const date = new Date(d)
  const day  = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function topOffset(iso: string) {
  const d = new Date(iso)
  const h = d.getHours() + d.getMinutes() / 60
  return Math.max(0, (h - 8) * SLOT_H)
}

function blockHeight(minutes: number) {
  return Math.max(SLOT_H * 0.5, (minutes / 60) * SLOT_H)
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-primary-100 border-primary-400 text-primary-900',
  completed: 'bg-green-100  border-green-400  text-green-900',
  cancelled: 'bg-gray-100   border-gray-300   text-gray-500',
}

function LessonBlock({ lesson, onClick }: { lesson: Lesson; onClick: () => void }) {
  const top    = topOffset(lesson.scheduled_at)
  const height = blockHeight(lesson.duration_minutes)
  const d      = new Date(lesson.scheduled_at)
  const time   = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <button
      onClick={onClick}
      style={{ top, height }}
      className={cn(
        'absolute left-0.5 right-0.5 rounded-lg border-l-4 px-2 py-1 text-left overflow-hidden',
        'hover:brightness-95 transition-all cursor-pointer z-10',
        STATUS_COLORS[lesson.status] || STATUS_COLORS.scheduled,
      )}
    >
      <div className="text-[11px] font-semibold leading-tight truncate">{lesson.title}</div>
      <div className="text-[10px] opacity-70 mt-0.5 leading-tight">{time}</div>
      {lesson.groups?.name && height > 44 && (
        <div className="text-[10px] opacity-60 truncate">{lesson.groups.name}</div>
      )}
    </button>
  )
}

interface LessonDetailProps {
  lesson: Lesson
  onClose: () => void
}

function LessonDetail({ lesson, onClose }: LessonDetailProps) {
  const d    = new Date(lesson.scheduled_at)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const date = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 z-10">
        <div className={cn(
          'w-10 h-10 rounded-xl border-2 flex items-center justify-center mb-4',
          STATUS_COLORS[lesson.status]
        )}>
          <Calendar size={18} />
        </div>
        <h2 className="font-bold text-gray-900 text-lg leading-tight">{lesson.title}</h2>
        <div className="mt-3 space-y-2 text-sm text-gray-600">
          <div className="flex items-center gap-2"><Clock size={14} className="text-gray-400" />{date}, {time}</div>
          <div className="flex items-center gap-2"><Clock size={14} className="text-gray-400" />{lesson.duration_minutes} минут</div>
          {lesson.groups?.name && (
            <div className="flex items-center gap-2"><Users size={14} className="text-gray-400" />{lesson.groups.name}</div>
          )}
          {lesson.teachers?.profiles?.full_name && (
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-gray-200 shrink-0" />
              {lesson.teachers.profiles.full_name}
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          {lesson.zoom_link && lesson.status === 'scheduled' && (
            <a href={lesson.zoom_link} target="_blank" rel="noreferrer" className="flex-1">
              <button className="w-full flex items-center justify-center gap-1.5 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors">
                <Video size={14} />Подключиться
              </button>
            </a>
          )}
          {lesson.recording_url && (
            <a href={lesson.recording_url} target="_blank" rel="noreferrer" className="flex-1">
              <button className="w-full py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
                Запись
              </button>
            </a>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 text-gray-500 text-sm rounded-xl hover:bg-gray-50 transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}

export function SchedulePage() {
  const profile   = useAuthStore(s => s.profile)
  const canCreate = profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)
  const { lessons, loading, reload } = useLessons()

  const today    = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d }, [])
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [selected,  setSelected]  = useState<Lesson | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDate, setCreateDate] = useState<Date | null>(null)

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const lessonsByDay = useMemo(() => {
    const map = new Map<string, Lesson[]>()
    for (const l of lessons) {
      const key = new Date(l.scheduled_at).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    }
    return map
  }, [lessons])

  const weekLabel = useMemo(() => {
    const end = addDays(weekStart, 6)
    const fmt = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    return `${fmt(weekStart)} — ${fmt(end)}`
  }, [weekStart])

  function prevWeek() { setWeekStart(d => addDays(d, -7)) }
  function nextWeek() { setWeekStart(d => addDays(d,  7)) }
  function goToday()  { setWeekStart(getMonday(new Date())) }

  const nowTop = useMemo(() => {
    const now = new Date()
    return (now.getHours() + now.getMinutes() / 60 - 8) * SLOT_H
  }, [])

  const isCurrentWeek = sameDay(weekStart, getMonday(new Date()))

  return (
    <div className="flex flex-col h-[calc(100vh-88px)] min-h-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Расписание</h1>
          <p className="text-gray-500 text-sm mt-0.5">{weekLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {!isCurrentWeek && (
            <button
              onClick={goToday}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Сегодня
            </button>
          )}
          <button onClick={prevWeek} className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <ChevronLeft size={18} className="text-gray-600" />
          </button>
          <button onClick={nextWeek} className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <ChevronRight size={18} className="text-gray-600" />
          </button>
          {canCreate && (
            <button
              onClick={() => { setCreateDate(null); setCreateOpen(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Plus size={15} />Занятие
            </button>
          )}
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-2xl bg-white">
        <div className="flex min-w-[640px]">

          {/* Time axis */}
          <div className="w-14 shrink-0 border-r border-gray-100">
            {/* Header spacer */}
            <div className="h-14 border-b border-gray-100" />
            <div className="relative">
              {HOURS.map(h => (
                <div key={h} style={{ height: SLOT_H }} className="border-b border-gray-100 flex items-start justify-end pr-2 pt-1">
                  <span className="text-[10px] text-gray-400">{String(h).padStart(2,'0')}:00</span>
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          {weekDays.map((day, di) => {
            const isToday   = sameDay(day, today)
            const dayLessons = lessonsByDay.get(day.toDateString()) || []
            const isWeekend = di >= 5

            return (
              <div key={di} className={cn('flex-1 min-w-0 border-r border-gray-100 last:border-r-0', isWeekend && 'bg-gray-50/40')}>
                {/* Day header */}
                <div
                  className={cn(
                    'h-14 border-b border-gray-100 flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:bg-gray-50 transition-colors',
                    isToday && 'bg-primary-50'
                  )}
                  onClick={() => canCreate && (setCreateDate(day), setCreateOpen(true))}
                >
                  <span className={cn('text-[11px] font-medium uppercase tracking-wide', isToday ? 'text-primary-600' : 'text-gray-400')}>
                    {WEEKDAYS[di]}
                  </span>
                  <span className={cn(
                    'w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold',
                    isToday ? 'bg-primary-600 text-white' : 'text-gray-800'
                  )}>
                    {day.getDate()}
                  </span>
                </div>

                {/* Slots */}
                <div className="relative" style={{ height: SLOT_H * HOURS.length }}>
                  {/* Hour lines */}
                  {HOURS.map(h => (
                    <div key={h} style={{ top: (h - 8) * SLOT_H }} className="absolute inset-x-0 border-b border-gray-100" />
                  ))}

                  {/* Now line */}
                  {isToday && nowTop >= 0 && nowTop <= SLOT_H * HOURS.length && (
                    <div style={{ top: nowTop }} className="absolute inset-x-0 z-20 flex items-center">
                      <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                      <div className="flex-1 h-px bg-red-500" />
                    </div>
                  )}

                  {/* Lessons */}
                  {dayLessons.map(l => (
                    <LessonBlock key={l.id} lesson={l} onClick={() => setSelected(l)} />
                  ))}

                  {/* Click to add */}
                  {canCreate && (
                    <div
                      className="absolute inset-0 cursor-pointer"
                      onClick={() => { setCreateDate(day); setCreateOpen(true) }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 shrink-0">
        {[
          ['scheduled', 'bg-primary-400', 'Запланировано'],
          ['completed', 'bg-green-400',   'Проведено'],
          ['cancelled', 'bg-gray-300',    'Отменено'],
        ].map(([, color, label]) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className={cn('w-2 h-2 rounded-full', color)} />{label}
          </span>
        ))}
        {loading && <span className="text-xs text-gray-400 ml-auto">Загрузка…</span>}
      </div>

      {/* Modals */}
      {selected && <LessonDetail lesson={selected} onClose={() => setSelected(null)} />}

      <CreateLessonModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={reload}
        defaultDate={createDate}
      />
    </div>
  )
}
