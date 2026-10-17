import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Sticker } from '@/components/student/skin/Sticker'
import type { ExamWidgetData } from '@/lib/examDates'
import type { ExamCountdown } from '@/lib/examCountdown'
import { MONTHS_BACK, monthGrid, phraseOfDay } from '@/lib/homeNotion'
import { dayLabel, type ActivityDay, type ActivityGrid } from '@/lib/studentActivity'
import { plural } from '@/lib/plural'

/**
 * «До ЕГЭ»: большое число дней, «до ЕГЭ по физике · ≈ 1 июня», полоска
 * «учебный год пройден на N %» и чипы по предметам. Предметов ЕГЭ нет (ОГЭ) —
 * прежний отсчёт `examCountdown` без полоски.
 */
export function ExamWidget({ data, fallback }: { data: ExamWidgetData | null; fallback: ExamCountdown | null }) {
  if (!data && !fallback) return null
  return (
    <section className="stu-card stu-w stu-w-exam" data-testid="home-w-exam" title={fallback?.hint}>
      <p className="stu-w-t"><span className="inline-flex items-center gap-1.5"><Sticker name="calendar25" size={22} />{data ? 'До ЕГЭ' : fallback!.label.replace('до ', 'До ')}</span>
        <span>{data ? data.main.dateLabel : fallback!.note}</span></p>
      <p className="stu-w-big" data-testid="exam-countdown">
        {data ? data.main.days : fallback!.days}<small>{data ? data.main.daysWord : fallback!.daysWord}</small>
      </p>
      {data && (
        <>
          <p className="stu-muted text-[13px]">до ЕГЭ {data.main.of} · {data.main.dateLabel}</p>
          <span className="stu-w-bar" aria-hidden="true"><i style={{ width: `${data.yearPercent}%` }} /></span>
          <p className="stu-muted text-[13px]" data-testid="home-year-pct">учебный год пройден на {data.yearPercent} %</p>
          {data.chips.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {data.chips.map(c => <span key={c.subject} className="stu-nchip is-static">{c.label}</span>)}
            </div>
          )}
        </>
      )}
    </section>
  )
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const two = (n: number) => String(n).padStart(2, '0')

/** Время устройства; обновление раз в 20 с — секунд нет, минута не «залипает» дольше. */
function useNow(stepMs = 20_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), stepMs)
    return () => window.clearInterval(t)
  }, [stepMs])
  return now
}

/** «Часы»: перекидные ЧЧ:ММ, день недели и дата, фраза дня. */
export function ClockWidget({ today }: { today: string }) {
  const now = useNow()
  return (
    <section className="stu-card stu-w stu-w-clock" data-testid="home-w-clock">
      <p className="stu-w-t"><span className="inline-flex items-center gap-1.5"><Sticker name="clock" size={22} />Сейчас</span></p>
      <div className="stu-flip" aria-label={`${two(now.getHours())}:${two(now.getMinutes())}`} role="img">
        <span>{two(now.getHours())}</span><span>{two(now.getMinutes())}</span>
      </div>
      <p className="stu-clock-day" data-testid="home-clock-day">
        <span>{WEEKDAYS[now.getDay()]}</span>
        <span>{now.getDate()} {MONTHS_GEN[now.getMonth()]}</span>
      </p>
      <p className="stu-quote" data-testid="home-phrase">{phraseOfDay(today)}</p>
    </section>
  )
}

const HEAD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const LEGEND: Array<[ActivityDay['level'], string]> = [
  [0, 'не заходил'], [1, 'заходил'], [2, '1–4 задачи'], [3, '5–9'], [4, '10+'],
]

/**
 * Мини-календарь текущего месяца вместо ленты «Посещения по дням»: та же
 * шкала и те же данные (`student_home_activity`), сегодня обведено, будущие
 * дни пустые; ‹ › — до трёх месяцев назад. Внизу — «подряд N · рекорд M».
 */
export function MonthWidget({ grid, today }: { grid: ActivityGrid; today: string }) {
  const [offset, setOffset] = useState(0)
  const days = useMemo(() => new Map(grid.weeks.flat().map(d => [d.day, d])), [grid])
  // «Сегодня» — из ответа базы (как в прежней ленте), часы устройства — запасной вариант.
  const base = useMemo(() => grid.weeks.flat().find(d => d.today)?.day ?? today, [grid, today])
  const m = monthGrid(base, offset, days)
  // День, про который строка под сеткой: наведённый, иначе выбранный нажатием, иначе сегодня.
  const [picked, setPicked] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const shown = hover ?? picked ?? base
  const shownInfo = days.get(shown) ?? (shown > base ? { day: shown, level: 0, solved: 0, future: true, today: false } as ActivityDay : null)
  const shownLabel = shownInfo ? dayLabel(shownInfo) : null
  return (
    <section className="stu-card stu-w stu-w-cal" data-testid="home-activity">
      <div className="stu-w-t">
        <span className="inline-flex items-center gap-1.5"><Sticker name="calendar" size={22} /><span data-testid="home-month-title">{m.title}</span></span>
        <span className="inline-flex items-center gap-1">
          <button type="button" className="stu-w-nav stu-focus" aria-label="Прошлый месяц" disabled={offset >= MONTHS_BACK}
            onClick={() => setOffset(o => Math.min(MONTHS_BACK, o + 1))} data-testid="home-month-prev"><ChevronLeft size={16} /></button>
          <button type="button" className="stu-w-nav stu-focus" aria-label="Следующий месяц" disabled={offset === 0}
            onClick={() => setOffset(o => Math.max(0, o - 1))} data-testid="home-month-next"><ChevronRight size={16} /></button>
        </span>
      </div>
      <table className="stu-mcal" data-testid="activity-calendar">
        <thead><tr>{HEAD.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {m.weeks.map((w, i) => (
            <tr key={i}>
              {w.map((c, j) => {
                if (!c) return <td key={j} className="is-out" />
                const info = c.info
                const cls = [info?.future ? 'is-future' : `lv-${info?.level ?? 0}`, c.day === base ? 'is-today' : ''].filter(Boolean).join(' ')
                const label = info ? dayLabel(info) : `${c.n}: нет данных`
                return (
                  <td key={j} className={[cls, picked === c.day ? 'is-picked' : ''].filter(Boolean).join(' ')} data-day={c.day}>
                    <button type="button" className="stu-mcal-d stu-focus" aria-label={label} aria-pressed={picked === c.day}
                      onClick={() => setPicked(p => (p === c.day ? null : c.day))}
                      onMouseEnter={() => setHover(c.day)} onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(c.day)} onBlur={() => setHover(null)}>
                      {c.n}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="stu-mcal-info" aria-live="polite" data-testid="home-day-info">{shownLabel ?? ' '}</p>
      <ul className="stu-heat-legend" aria-label="Обозначения">
        {LEGEND.map(([lv, label]) => <li key={lv}><i className={`lv-${lv}`} aria-hidden="true" />{label}</li>)}
      </ul>
      <p className="flex items-baseline justify-between gap-2 text-[13.5px]" data-testid="home-streak">
        <span>подряд <b className="text-[17px] font-extrabold tabular-nums">{grid.streak}</b> {plural(grid.streak, 'день', 'дня', 'дней')}</span>
        <span className="stu-muted">рекорд {grid.record} · {m.activeDays} {plural(m.activeDays, 'день', 'дня', 'дней')} с занятиями</span>
      </p>
    </section>
  )
}
