import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Sticker } from '@/components/student/skin/Sticker'
import { shortDay, weekRange, type CalTopic, type CalWeek } from '@/lib/topicCalendar'
import type { CourseCalendar } from '@/hooks/useTopicCalendar'

const topicHref = (groupId: string, t: CalTopic) => `/my-course/${groupId}/topic/${t.id}`

function TopicRow({ groupId, t, note }: { groupId: string; t: CalTopic; note?: string }) {
  if (t.open) {
    return (
      <li>
        <Link to={topicHref(groupId, t)} className="stu-cal-topic is-open stu-focus" data-testid="cal-topic-open">
          <span className="min-w-0 break-words">{t.title}</span>
          <span aria-hidden="true">→</span>
        </Link>
      </li>
    )
  }
  return (
    <li className="stu-cal-topic is-locked" data-testid="cal-topic-locked">
      <Lock size={14} aria-hidden className="mt-[3px] shrink-0" />
      <span className="min-w-0">
        <span className="block break-words">{t.title}</span>
        <small className="stu-muted block">{note ?? (t.opensOn ? `откроется ${shortDay(t.opensOn)}` : 'откроется позже')}</small>
      </span>
    </li>
  )
}

/** Курс по расписанию: недели плана, текущая выделена; полоса прокручивается вбок. */
function Weeks({ groupId, weeks }: { groupId: string; weeks: CalWeek[] }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    const cur = el?.querySelector<HTMLElement>('[data-current="true"]')
    // Влезают две недели — прошлая целиком слева от текущей; на телефоне
    // (одна колонка) — сразу текущая. offsetLeft считается от полосы: у неё
    // position: relative.
    const prev = cur?.previousElementSibling as HTMLElement | null
    const anchor = el && cur && prev && el.clientWidth >= cur.offsetWidth * 2 ? prev : cur
    if (el && anchor) el.scrollLeft = Math.max(0, anchor.offsetLeft - 2)
  }, [weeks])
  return (
    <ol className="stu-weeks" ref={ref} aria-label="Темы по неделям">
      {weeks.map(w => (
        <li key={w.start} className={w.current ? 'stu-week is-current' : w.past ? 'stu-week is-past' : 'stu-week'} data-current={w.current ? 'true' : undefined}>
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-[14px]">{w.current ? 'Эта неделя' : weekRange(w.start)}</b>
            {w.current && <span className="stu-tag t-blue">{weekRange(w.start)}</span>}
          </div>
          {w.topics.length > 0
            ? <ul className="stu-cal-list">{w.topics.map(t => <TopicRow key={t.id} groupId={groupId} t={t} />)}</ul>
            : <p className="stu-muted text-[13px]">тем нет</p>}
        </li>
      ))}
    </ol>
  )
}

/**
 * «Календарь тем» (письмо 15.10): какие темы откроются по неделям. Курс по
 * расписанию — недели плана (2 назад … 4 вперёд), открытые темы ведут в урок,
 * будущие — с датой. Курс по прохождению — «Сейчас открыто» и следующие 3
 * урока с подписью под замком; в пробном периоде — «Откроется с подпиской».
 */
export function TopicCalendarCard({ calendars }: { calendars: CourseCalendar[] }) {
  if (calendars.length === 0) return null
  return (
    <section className="stu-card stu-calendar" aria-labelledby="home-calendar-h" data-testid="home-calendar">
      <div className="flex items-center gap-3">
        <Sticker name="calendar25" size={56} />
        <div className="min-w-0 flex-1">
          <h2 id="home-calendar-h" className="stu-h3">Календарь тем</h2>
          <span className="stu-muted text-[13.5px]">что открыто сейчас и что откроется дальше</span>
        </div>
      </div>
      {calendars.map(c => (
        <div key={c.course.courseId} className="flex flex-col gap-3" data-testid="cal-course" data-kind={c.kind}>
          {calendars.length > 1 && <span className="stu-kicker break-words">{c.course.title}</span>}
          {c.kind === 'weeks'
            ? <Weeks groupId={c.course.groupId} weeks={c.weeks} />
            : (
              <div className="stu-prog">
                <div>
                  <b className="text-[14px]">Сейчас открыто</b>
                  {c.view.done > 0 && <span className="stu-muted text-[13px]"> · пройдено {c.view.done}</span>}
                  {c.view.open.length > 0
                    ? <ul className="stu-cal-list">{c.view.open.map(t => <TopicRow key={t.id} groupId={c.course.groupId} t={t} />)}</ul>
                    : <p className="stu-muted text-[13px]">открытых уроков нет</p>}
                </div>
                {c.view.next.length > 0 && (
                  <div>
                    <b className="text-[14px]">Дальше</b>
                    <ul className="stu-cal-list">
                      {c.view.next.map(t => <TopicRow key={t.id} groupId={c.course.groupId} t={t} note={t.note} />)}
                    </ul>
                    {c.view.lockedTotal > c.view.next.length && (
                      <p className="stu-muted text-[13px]">и ещё {c.view.lockedTotal - c.view.next.length}</p>
                    )}
                    {c.course.demo && (
                      <Link to="/courses" className="stu-btn stu-btn-o mt-2">Оформить подписку</Link>
                    )}
                  </div>
                )}
              </div>
            )}
        </div>
      ))}
    </section>
  )
}
