import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronLeft, ChevronRight, Calendar, List, Video,
  Clock, Users, CheckCircle, XCircle, Plus, GraduationCap, ClipboardCheck, User
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatCard } from '@/components/ui/StatCard'
import { useAuthStore } from '@/store/authStore'
import { useLessons, type Lesson } from '@/hooks/useLessons'
import { CreateLessonModal } from '@/components/modals/CreateLessonModal'
import { AttendanceModal } from '@/components/modals/AttendanceModal'
import { cn } from '@/utils/cn'

// ─── helpers ────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTHS = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
]

function toLocalDate(iso: string) {
  return new Date(iso)
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function formatTime(iso: string) {
  return toLocalDate(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function formatFullDate(d: Date) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

const STATUS_CONFIG = {
  scheduled:  { label: 'Запланировано', color: 'bg-blue-500',  text: 'text-blue-700',  bg: 'bg-blue-50 border-blue-200',  badge: 'info' as const },
  completed:  { label: 'Проведено',     color: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50 border-green-200', badge: 'success' as const },
  cancelled:  { label: 'Отменено',      color: 'bg-gray-400',  text: 'text-gray-500',  bg: 'bg-gray-50 border-gray-200',   badge: 'default' as const },
}

// ─── calendar grid builder ───────────────────────────────────────────────────

function buildCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)

  // Monday-first: 0=Mon … 6=Sun
  let startDow = firstDay.getDay() - 1
  if (startDow < 0) startDow = 6

  const days: (Date | null)[] = []
  for (let i = 0; i < startDow; i++) days.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(new Date(year, month, d))

  while (days.length % 7 !== 0) days.push(null)
  return days
}

// ─── LessonCard ──────────────────────────────────────────────────────────────

function LessonCard({
  lesson,
  canManage,
  onAttendance,
}: {
  lesson: Lesson
  canManage?: boolean
  onAttendance?: (lesson: Lesson) => void
}) {
  const cfg = STATUS_CONFIG[lesson.status]
  return (
    <Link
      to={`/lessons/${lesson.id}`}
      className={cn('block p-4 rounded-xl border transition-all duration-200 hover:shadow-md hover:border-primary-300 cursor-pointer', cfg.bg)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate hover:text-primary-700 transition-colors">{lesson.title}</div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock size={12} /> {formatTime(lesson.scheduled_at)} • {lesson.duration_minutes} мин.
            </span>
            {lesson.format === 'individual' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">
                <User size={11} /> Инд.{lesson.student_profile?.full_name ? ` · ${lesson.student_profile.full_name}` : ''}
              </span>
            ) : lesson.groups?.name ? (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Users size={12} /> {lesson.groups.name}
              </span>
            ) : null}
            {lesson.teachers?.profiles?.full_name && (
              <span className="text-xs text-gray-400">{lesson.teachers.profiles.full_name}</span>
            )}
          </div>
          {lesson.topics?.title && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-primary-600 bg-primary-50 px-2 py-0.5 rounded-md w-fit">
              <GraduationCap size={11} />
              <span className="truncate max-w-[260px]">
                {lesson.topics.modules?.title && <span className="text-primary-400">{lesson.topics.modules.title} · </span>}
                {lesson.topics.title}
              </span>
            </div>
          )}
        </div>
        <Badge variant={cfg.badge}>{cfg.label}</Badge>
      </div>

      {(lesson.zoom_link || lesson.recording_url || canManage) && (
        <div className="flex gap-2 mt-3 flex-wrap" onClick={e => e.stopPropagation()}>
          {lesson.zoom_link && lesson.status === 'scheduled' && (
            <a href={lesson.zoom_link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
              <Button size="sm" className="gap-1 text-xs">
                <Video size={13} /> Подключиться
              </Button>
            </a>
          )}
          {lesson.recording_url && (
            <a href={lesson.recording_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
              <Button size="sm" variant="secondary" className="text-xs">Запись</Button>
            </a>
          )}
          {canManage && (
            <Button
              size="sm"
              variant="secondary"
              className="text-xs gap-1"
              onClick={e => { e.stopPropagation(); e.preventDefault(); onAttendance?.(lesson) }}
            >
              <ClipboardCheck size={13} /> Посещаемость
            </Button>
          )}
        </div>
      )}
    </Link>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type View = 'calendar' | 'list'
type Filter = 'all' | 'scheduled' | 'completed'

export function LessonsPage() {
  const profile = useAuthStore(s => s.profile)
  const { lessons, loading, reload } = useLessons()

  const canCreate = profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)

  const today = new Date()
  const [view, setView]           = useState<View>('calendar')
  const [filter, setFilter]       = useState<Filter>('all')
  const [currentYear, setYear]    = useState(today.getFullYear())
  const [currentMonth, setMonth]  = useState(today.getMonth())
  const [selectedDate, setSelected] = useState<Date | null>(today)
  const [modalOpen, setModalOpen] = useState(false)
  const [attendanceTarget, setAttendanceTarget] = useState<Lesson | null>(null)

  // filtered lesson list
  const filteredLessons = useMemo(() => {
    if (filter === 'all') return lessons
    return lessons.filter(l => l.status === filter)
  }, [lessons, filter])

  // lessons grouped by date string
  const lessonsByDay = useMemo(() => {
    const map = new Map<string, Lesson[]>()
    for (const l of lessons) {
      const key = toLocalDate(l.scheduled_at).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    }
    return map
  }, [lessons])

  // lessons for selected day
  const dayLessons = useMemo(() => {
    if (!selectedDate) return []
    return lessons.filter(l => sameDay(toLocalDate(l.scheduled_at), selectedDate))
  }, [lessons, selectedDate])

  const calDays = useMemo(() => buildCalendarDays(currentYear, currentMonth), [currentYear, currentMonth])

  function prevMonth() {
    if (currentMonth === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (currentMonth === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const upcoming  = lessons.filter(l => l.status === 'scheduled').length
  const completed = lessons.filter(l => l.status === 'completed').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Занятия</h1>
          <p className="text-gray-500 mt-1">Расписание и история занятий</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-0.5 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setView('calendar')}
              className={cn(
                'p-1.5 rounded-md transition-all duration-150',
                view === 'calendar' ? 'bg-white shadow-sm text-primary-600' : 'text-gray-400 hover:text-gray-600'
              )}
              title="Календарь"
            >
              <Calendar size={16} />
            </button>
            <button
              onClick={() => setView('list')}
              className={cn(
                'p-1.5 rounded-md transition-all duration-150',
                view === 'list' ? 'bg-white shadow-sm text-primary-600' : 'text-gray-400 hover:text-gray-600'
              )}
              title="Список"
            >
              <List size={16} />
            </button>
          </div>
          {canCreate && (
            <Button size="sm" className="gap-1" onClick={() => setModalOpen(true)}>
              <Plus size={15} /> Создать занятие
            </Button>
          )}
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Предстоящих" value={upcoming}  icon={<Calendar size={20} />} color="blue" />
        <StatCard title="Проведено"   value={completed} icon={<CheckCircle size={20} />} color="green" />
        <StatCard title="Всего"       value={lessons.length} icon={<Clock size={20} />} color="purple" />
      </div>

      {/* ══════════════════════════════════ CALENDAR VIEW ══════════════════════════════════ */}
      {view === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Month grid */}
          <Card className="lg:col-span-2 p-0 overflow-hidden">
            {/* Month header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <ChevronLeft size={18} className="text-gray-600" />
              </button>
              <h2 className="text-base font-semibold text-gray-900">
                {MONTHS[currentMonth]} {currentYear}
              </h2>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <ChevronRight size={18} className="text-gray-600" />
              </button>
            </div>

            {/* Day names */}
            <div className="grid grid-cols-7 border-b border-gray-100">
              {WEEKDAYS.map(d => (
                <div key={d} className="py-2 text-center text-xs font-medium text-gray-400 uppercase tracking-wide">
                  {d}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {calDays.map((day, idx) => {
                if (!day) {
                  return <div key={`empty-${idx}`} className="h-14 border-b border-r border-gray-50 last:border-r-0" />
                }

                const dayKey = day.toDateString()
                const dayLs  = lessonsByDay.get(dayKey) || []
                const isToday    = sameDay(day, today)
                const isSelected = selectedDate ? sameDay(day, selectedDate) : false
                const isWeekend  = day.getDay() === 0 || day.getDay() === 6

                return (
                  <button
                    key={dayKey}
                    onClick={() => setSelected(day)}
                    className={cn(
                      'h-14 flex flex-col items-center justify-start pt-1.5 px-1 border-b border-r border-gray-100 transition-colors duration-150 cursor-pointer relative',
                      'last:border-r-0',
                      isWeekend && !isSelected && 'bg-gray-50/50',
                      isSelected && 'bg-primary-50',
                      !isSelected && 'hover:bg-gray-50',
                    )}
                  >
                    {/* Date number */}
                    <span className={cn(
                      'w-6 h-6 flex items-center justify-center text-xs font-medium rounded-full transition-all',
                      isToday && !isSelected && 'bg-primary-600 text-white font-bold',
                      isSelected && !isToday && 'bg-primary-200 text-primary-800',
                      isSelected && isToday && 'bg-primary-600 text-white font-bold',
                      !isToday && !isSelected && (isWeekend ? 'text-gray-400' : 'text-gray-700'),
                    )}>
                      {day.getDate()}
                    </span>

                    {/* Lesson dots */}
                    {dayLs.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center">
                        {dayLs.slice(0, 3).map(l => (
                          <span
                            key={l.id}
                            className={cn('w-1.5 h-1.5 rounded-full', STATUS_CONFIG[l.status].color)}
                          />
                        ))}
                        {dayLs.length > 3 && (
                          <span className="text-[9px] text-gray-400 leading-none">+{dayLs.length - 3}</span>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 px-5 py-3 border-t border-gray-100">
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span className={cn('w-2 h-2 rounded-full', v.color)} />
                  {v.label}
                </span>
              ))}
            </div>
          </Card>

          {/* Day detail panel */}
          <Card className="h-fit">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-gray-900">
                  {selectedDate ? formatFullDate(selectedDate) : 'Выберите день'}
                </div>
                {dayLessons.length > 0 && (
                  <div className="text-xs text-gray-400 mt-0.5">{dayLessons.length} занятий</div>
                )}
              </div>
              {selectedDate && sameDay(selectedDate, today) && (
                <Badge variant="info">Сегодня</Badge>
              )}
            </div>

            {!selectedDate ? (
              <p className="text-gray-400 text-sm py-8 text-center">Нажмите на дату в календаре</p>
            ) : dayLessons.length === 0 ? (
              <div className="text-center py-8">
                <Calendar size={32} className="text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Занятий нет</p>
                {canCreate && (
                  <button
                    onClick={() => setModalOpen(true)}
                    className="mt-3 text-xs text-primary-600 hover:text-primary-700 font-medium cursor-pointer"
                  >
                    + Добавить занятие на этот день
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {dayLessons.map(l => (
                  <LessonCard
                    key={l.id}
                    lesson={l}
                    canManage={!!canCreate}
                    onAttendance={setAttendanceTarget}
                  />
                ))}
                {canCreate && (
                  <button
                    onClick={() => setModalOpen(true)}
                    className="w-full py-2 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors cursor-pointer"
                  >
                    + Добавить занятие
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════ LIST VIEW ══════════════════════════════════ */}
      {view === 'list' && (
        <div className="space-y-4">

          {/* Filter tabs */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
            {([
              ['all', 'Все'],
              ['scheduled', 'Предстоящие'],
              ['completed', 'Прошедшие'],
            ] as [Filter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer',
                  filter === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {label}
                <span className={cn(
                  'ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full',
                  filter === key ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-500'
                )}>
                  {key === 'all' ? lessons.length
                    : key === 'scheduled' ? upcoming
                    : completed}
                </span>
              </button>
            ))}
          </div>

          {filteredLessons.length === 0 ? (
            <Card>
              <div className="text-center py-12">
                <XCircle size={40} className="text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400">Занятий не найдено</p>
              </div>
            </Card>
          ) : (
            (() => {
              // Group by month+year
              const groups: { label: string; lessons: Lesson[] }[] = []
              for (const lesson of filteredLessons) {
                const d = toLocalDate(lesson.scheduled_at)
                const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
                const last = groups[groups.length - 1]
                if (!last || last.label !== label) groups.push({ label, lessons: [lesson] })
                else last.lessons.push(lesson)
              }

              return groups.map(group => (
                <div key={group.label}>
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{group.label}</h3>
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-xs text-gray-400">{group.lessons.length}</span>
                  </div>
                  <div className="space-y-2">
                    {group.lessons.map(lesson => {
                      const d   = toLocalDate(lesson.scheduled_at)
                      const cfg = STATUS_CONFIG[lesson.status]
                      return (
                        <div
                          key={lesson.id}
                          className={cn(
                            'flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 hover:shadow-md',
                            cfg.bg
                          )}
                        >
                          {/* Date badge */}
                          <div className="shrink-0 w-12 text-center">
                            <div className="text-lg font-bold text-gray-900 leading-none">{d.getDate()}</div>
                            <div className="text-[10px] text-gray-400 uppercase mt-0.5">
                              {d.toLocaleDateString('ru-RU', { weekday: 'short' })}
                            </div>
                          </div>

                          <div className={cn('w-px self-stretch', cfg.color.replace('bg-', 'bg-'))} />

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">{lesson.title}</div>
                            <div className="flex items-center gap-3 mt-1 flex-wrap">
                              <span className="flex items-center gap-1 text-xs text-gray-500">
                                <Clock size={12} /> {formatTime(lesson.scheduled_at)} • {lesson.duration_minutes} мин.
                              </span>
                              {lesson.format === 'individual' ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">
                                  <User size={11} /> Инд.{lesson.student_profile?.full_name ? ` · ${lesson.student_profile.full_name}` : ''}
                                </span>
                              ) : lesson.groups?.name ? (
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                  <Users size={12} /> {lesson.groups.name}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {/* Status + action */}
                          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                            <Badge variant={cfg.badge}>{cfg.label}</Badge>
                            {lesson.zoom_link && lesson.status === 'scheduled' && (
                              <a href={lesson.zoom_link} target="_blank" rel="noreferrer">
                                <Button size="sm" className="gap-1 text-xs">
                                  <Video size={13} /> Войти
                                </Button>
                              </a>
                            )}
                            {lesson.recording_url && (
                              <a href={lesson.recording_url} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="secondary" className="text-xs">Запись</Button>
                              </a>
                            )}
                            {canCreate && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="text-xs gap-1"
                                onClick={() => setAttendanceTarget(lesson)}
                              >
                                <ClipboardCheck size={13} /> Посещаемость
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))
            })()
          )}
        </div>
      )}

      {/* ── Create Lesson Modal ── */}
      <CreateLessonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={reload}
        defaultDate={selectedDate}
      />

      {/* ── Attendance Modal ── */}
      <AttendanceModal
        open={!!attendanceTarget}
        onClose={() => setAttendanceTarget(null)}
        onSaved={() => setAttendanceTarget(null)}
        lesson={attendanceTarget}
      />
    </div>
  )
}
