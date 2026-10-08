import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import {
  CALENDAR_KIND_LABEL, CALENDAR_KIND_ORDER, MONTHS_NOM, WEEKDAYS_SHORT,
  eventsByDay, longDayLabel, monthGrid, relativeDayLabel, shiftMonth, upcomingEvents,
  type CalendarEvent, type CalendarEventKind,
} from '@/lib/studentCalendar'
import { plural } from '@/lib/plural'

/**
 * §274. «Календарь» на главной ученика: сетка месяца (неделя с понедельника),
 * точки событий по типам с легендой, список выбранного дня и «Ближайшие
 * 7 дней». Данные готовит `lib/studentCalendar` — компонент только рисует.
 *
 * Телефон (375): семь узких колонок, в клетке число и точки; список дня — под
 * сеткой. Шире `sm` в клетке — короткие плашки с названием (две, остальное
 * «+N»), шире `lg` список дня и «Ближайшие» стоят справа от сетки.
 */

/** Цвет типа: точка, плашка в клетке, метка в списке. */
const KIND_TONE: Record<CalendarEventKind, { dot: string; chip: string }> = {
  homework: { dot: 'bg-primary-500', chip: 'bg-primary-50 text-primary-800' },
  lesson: { dot: 'bg-verdict-ok', chip: 'bg-verdict-ok-tint text-verdict-ok-ink' },
  mock: { dot: 'bg-gold-400', chip: 'bg-gold-50 text-gold-800' },
  work: { dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-800' },
}

export function StudentCalendarCard({ events, today, className }: {
  events: CalendarEvent[]
  /** Сегодня по Москве, «YYYY-MM-DD». */
  today: string
  className?: string
}) {
  const [view, setView] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }))
  const [selected, setSelected] = useState(today)
  const byDay = useMemo(() => eventsByDay(events), [events])
  const weeks = useMemo(() => monthGrid(view.year, view.month), [view])
  const upcoming = useMemo(() => upcomingEvents(events, today), [events, today])
  const isCurrentMonth = view.year === Number(today.slice(0, 4)) && view.month === Number(today.slice(5, 7)) - 1
  const dayEvents = byDay.get(selected) ?? []

  function go(delta: number) {
    const next = shiftMonth(view.year, view.month, delta)
    setView(next)
    // Выбранный день остаётся, если он в новом месяце; иначе — сегодня (в
    // текущем месяце) или 1-е число.
    const prefix = `${next.year}-${String(next.month + 1).padStart(2, '0')}`
    if (!selected.startsWith(prefix)) setSelected(today.startsWith(prefix) ? today : `${prefix}-01`)
  }

  function goToday() {
    setView({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })
    setSelected(today)
  }

  return (
    <section
      aria-labelledby="home-calendar-h"
      data-testid="student-calendar"
      className={cn('platform-surface rounded-card p-3 sm:p-5', className)}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="home-calendar-h" className="text-[15px] font-extrabold text-graphite-950">Календарь</h2>
            <div className="flex items-center gap-1">
              {!isCurrentMonth && (
                <button
                  type="button"
                  onClick={goToday}
                  className="mr-1 rounded-full px-2.5 py-1 text-xs font-bold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  Сегодня
                </button>
              )}
              <button
                type="button"
                aria-label="Предыдущий месяц"
                data-testid="calendar-prev"
                onClick={() => go(-1)}
                className="grid h-9 w-9 place-items-center rounded-full text-graphite-600 hover:bg-graphite-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
              <p
                className="min-w-[8.5rem] text-center text-sm font-extrabold text-graphite-900"
                aria-live="polite"
                data-testid="calendar-month"
              >
                {MONTHS_NOM[view.month]} {view.year}
              </p>
              <button
                type="button"
                aria-label="Следующий месяц"
                data-testid="calendar-next"
                onClick={() => go(1)}
                className="grid h-9 w-9 place-items-center rounded-full text-graphite-600 hover:bg-graphite-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            </div>
          </header>

          <div className="grid grid-cols-7 gap-0.5 sm:gap-1" data-testid="calendar-grid">
            {WEEKDAYS_SHORT.map((w, i) => (
              <div
                key={w}
                data-testid="calendar-weekday"
                className={cn('pb-1 text-center text-[11px] font-bold uppercase tracking-wide', i >= 5 ? 'text-graphite-400' : 'text-graphite-500')}
              >
                {w}
              </div>
            ))}
            {weeks.flat().map(cell => {
              const list = byDay.get(cell.day) ?? []
              const isToday = cell.day === today
              const isSelected = cell.day === selected
              const kinds = CALENDAR_KIND_ORDER.filter(k => list.some(e => e.kind === k))
              return (
                <button
                  key={cell.day}
                  type="button"
                  onClick={() => setSelected(cell.day)}
                  aria-pressed={isSelected}
                  aria-label={`${longDayLabel(cell.day)}${list.length ? `: ${list.length} ${plural(list.length, 'событие', 'события', 'событий')}` : ''}${isToday ? ', сегодня' : ''}`}
                  data-testid="calendar-day"
                  data-day={cell.day}
                  data-in-month={cell.inMonth || undefined}
                  className={cn(
                    'group relative flex min-h-[46px] min-w-0 flex-col items-center rounded-xl border p-1 text-left transition-colors sm:min-h-[84px] sm:items-stretch sm:p-1.5',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                    isSelected ? 'border-primary-500 bg-primary-50' : 'border-transparent hover:bg-graphite-50',
                    !cell.inMonth && 'opacity-45',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold tabular-nums sm:h-6 sm:w-6 sm:text-xs',
                      isToday ? 'bg-primary-600 text-white' : 'text-graphite-800',
                    )}
                  >
                    {cell.date}
                  </span>
                  {/* Телефон: только точки по типам */}
                  {kinds.length > 0 && (
                    <span className="mt-0.5 flex gap-0.5 sm:hidden" aria-hidden>
                      {kinds.map(k => <i key={k} className={cn('h-1.5 w-1.5 rounded-full', KIND_TONE[k].dot)} />)}
                    </span>
                  )}
                  {/* Шире: две плашки и «+N» */}
                  {list.length > 0 && (
                    <span className="mt-1 hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden>
                      {list.slice(0, 2).map(e => (
                        <span
                          key={e.id}
                          className={cn('flex min-w-0 items-center gap-1 truncate rounded-md px-1 py-px text-[10.5px] font-semibold leading-4', KIND_TONE[e.kind].chip, e.done && 'opacity-60')}
                        >
                          <i className={cn('h-1.5 w-1.5 shrink-0 rounded-full', KIND_TONE[e.kind].dot)} />
                          <span className="truncate">{e.title}</span>
                        </span>
                      ))}
                      {list.length > 2 && <span className="px-1 text-[10.5px] font-bold text-graphite-500">+{list.length - 2}</span>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Обозначения" data-testid="calendar-legend">
            {CALENDAR_KIND_ORDER.map(k => (
              <li key={k} className="flex items-center gap-1.5 text-xs text-graphite-600">
                <i aria-hidden className={cn('h-2 w-2 rounded-full', KIND_TONE[k].dot)} />
                {CALENDAR_KIND_LABEL[k]}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid min-w-0 content-start gap-4 border-t border-graphite-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div data-testid="calendar-day-list">
            <h3 className="mb-2 text-sm font-extrabold text-graphite-900">
              {selected === today ? 'Сегодня, ' : ''}{longDayLabel(selected)}
            </h3>
            {dayEvents.length === 0 ? (
              <p className="text-sm text-graphite-500">В этот день ничего нет</p>
            ) : (
              <ul className="grid gap-1.5">
                {dayEvents.map(e => <EventRow key={e.id} event={e} />)}
              </ul>
            )}
          </div>

          <div data-testid="calendar-upcoming">
            <h3 className="mb-2 text-sm font-extrabold text-graphite-900">Ближайшие 7 дней</h3>
            {upcoming.length === 0 ? (
              <p className="text-sm text-graphite-500">Неделя свободна — сроков и событий нет</p>
            ) : (
              <ul className="grid gap-1.5">
                {upcoming.map(e => <EventRow key={e.id} event={e} when={relativeDayLabel(e.day, today)} />)}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function EventRow({ event: e, when }: { event: CalendarEvent; when?: string }) {
  const meta = [CALENDAR_KIND_LABEL[e.kind], e.time, e.course].filter(Boolean).join(' · ')
  const body = (
    <>
      <i aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', KIND_TONE[e.kind].dot)} />
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words text-sm font-bold leading-snug', e.done ? 'text-graphite-500' : 'text-graphite-950')}>
          {e.title}
        </span>
        <span className="block text-xs text-graphite-500">{meta}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        {when && <span className="text-xs font-bold text-graphite-700">{when}</span>}
        {e.note && (
          <span className={cn(
            'rounded-full px-1.5 py-px text-[11px] font-bold',
            e.note === 'просрочено' ? 'bg-verdict-bad-tint text-verdict-bad-ink'
              : e.done ? 'bg-verdict-ok-tint text-verdict-ok-ink' : 'bg-graphite-100 text-graphite-600',
          )}>
            {e.note}
          </span>
        )}
      </span>
    </>
  )
  const cls = 'flex items-start gap-2 rounded-xl px-2 py-1.5'
  return (
    <li data-testid="calendar-event" data-kind={e.kind}>
      {e.href ? (
        <Link
          to={e.href}
          className={cn(cls, 'transition-colors hover:bg-primary-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500')}
        >
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}
