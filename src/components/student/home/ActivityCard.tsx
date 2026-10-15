import { Sticker } from '@/components/student/skin/Sticker'
import { plural } from '@/lib/plural'
import { shortDay, type ActivityDay, type ActivityGrid } from '@/lib/topicCalendar'

const DAYS = ['Пн', '', 'Ср', '', 'Пт', '', 'Вс']
const LEGEND: Array<[ActivityDay['level'], string]> = [
  [0, 'не заходил'], [1, 'заходил'], [2, '1–4 задачи'], [3, '5–9'], [4, '10+'],
]

function dayTitle(d: ActivityDay): string {
  if (d.future) return shortDay(d.day)
  if (d.solved > 0) return `${shortDay(d.day)}: ${d.solved} ${plural(d.solved, 'задача', 'задачи', 'задач')}`
  return `${shortDay(d.day)}: ${d.level > 0 ? 'заходил' : 'не заходил'}`
}

/**
 * «Посещения по дням» (письмо 15.10): спокойная карта за 12 недель — клетка
 * на день, цвет — заходил / сколько задач решил; рядом «дней подряд» и
 * рекорд. Без очков, бейджей и наград. Данные — `student_home_activity(84)`.
 */
export function ActivityCard({ grid }: { grid: ActivityGrid }) {
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

      <div className="stu-heat" role="img" aria-label={`Карта посещений за 12 недель: ${grid.activeDays} активных дней, ${grid.streak} подряд, рекорд ${grid.record}`}>
        <div className="stu-heat-days" aria-hidden="true">
          {DAYS.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="stu-heat-grid" aria-hidden="true">
          {grid.weeks.map((w, i) => (
            <div key={i} className="stu-heat-col">
              {w.map(d => (
                <i key={d.day} className={d.future ? 'is-future' : `lv-${d.level}`} title={dayTitle(d)} />
              ))}
            </div>
          ))}
        </div>
      </div>

    </section>
  )
}
