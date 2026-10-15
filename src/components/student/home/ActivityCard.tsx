import { useCallback, useState, type FocusEvent, type MouseEvent } from 'react'
import { Sticker } from '@/components/student/skin/Sticker'
import { plural } from '@/lib/plural'
import { dayLabel, type ActivityDay, type ActivityGrid } from '@/lib/studentActivity'

const DAYS = ['Пн', '', 'Ср', '', 'Пт', '', 'Вс']
const LEGEND: Array<[ActivityDay['level'], string]> = [
  [0, 'не заходил'], [1, 'заходил'], [2, '1–4 задачи'], [3, '5–9'], [4, '10+'],
]

/**
 * Подсказка над клеткой — сразу при наведении И при фокусе с клавиатуры, как
 * было на главной до «лёгкой» (§254, FloatingTip). Системный `title` давал
 * подсказку с задержкой, без фокуса, а местами не давал вовсе. Одна на карту;
 * `position: fixed` от клетки, по ширине прижимается к краям окна (390 px).
 */
function useCellTip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  const show = useCallback((el: Element, text: string) => {
    const r = el.getBoundingClientRect()
    const x = Math.max(120, Math.min(r.left + r.width / 2, window.innerWidth - 120))
    const below = r.top < 56
    setTip({ text, x, y: below ? r.bottom + 8 : r.top - 8, below })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  const bind = (text: string) => ({
    onMouseEnter: (e: MouseEvent<Element>) => show(e.currentTarget, text),
    onMouseLeave: hide,
    onFocus: (e: FocusEvent<Element>) => show(e.currentTarget, text),
    onBlur: hide,
  })
  const node = tip ? (
    <div
      role="tooltip"
      className="stu-tip"
      data-testid="activity-tip"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
    >
      {tip.text}
    </div>
  ) : null
  return { bind, node }
}

/**
 * «Посещения по дням» (письмо 15.10): спокойная карта за 12 недель — клетка
 * на день, цвет — заходил / сколько задач решил; рядом «дней подряд» и
 * рекорд. Без очков, бейджей и наград. Данные — `student_home_activity(84)`.
 * Наведение или фокус на клетке — день и что в нём было; сегодня обведено.
 */
export function ActivityCard({ grid }: { grid: ActivityGrid }) {
  const tip = useCellTip()
  return (
    <section className="stu-card stu-activity" aria-labelledby="home-activity-h" data-testid="home-activity">
      <div className="stu-activity-side">
        <div className="flex items-center gap-3">
          <Sticker name="calendar" size={56} />
          <div className="min-w-0 flex-1">
            <h2 id="home-activity-h" className="stu-h3">Посещения по дням</h2>
            <span className="stu-muted text-[13.5px]">последние 12 недель · {grid.activeDays} {plural(grid.activeDays, 'день', 'дня', 'дней')} с занятиями</span>
          </div>
        </div>

        <p className="text-[15px]" data-testid="home-streak">
          <b className="text-[22px] font-extrabold tabular-nums">{grid.streak}</b>{' '}
          {plural(grid.streak, 'день', 'дня', 'дней')} подряд
          <span className="stu-muted"> · рекорд {grid.record}</span>
        </p>
        <ul className="stu-heat-legend" aria-label="Обозначения">
          {LEGEND.map(([lv, label]) => (
            <li key={lv}><i className={`lv-${lv}`} aria-hidden="true" />{label}</li>
          ))}
        </ul>
      </div>

      <div className="stu-heat">
        <div className="stu-heat-days" aria-hidden="true">
          {DAYS.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="stu-heat-grid" role="group" aria-label="Посещения за 12 недель" data-testid="activity-calendar">
          {grid.weeks.map((w, i) => (
            <div key={i} className="stu-heat-col">
              {w.map(d => {
                const label = dayLabel(d)
                const cls = [d.future ? 'is-future' : `lv-${d.level}`, d.today ? 'is-today' : ''].filter(Boolean).join(' ')
                return (
                  <i
                    key={d.day}
                    role="img"
                    tabIndex={d.future ? -1 : 0}
                    aria-label={label}
                    data-day={d.day}
                    className={cls}
                    {...tip.bind(label)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {tip.node}
    </section>
  )
}
