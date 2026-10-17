import { Link } from 'react-router-dom'
import { Sticker } from '@/components/student/skin/Sticker'

export interface TodayItem {
  key: string
  text: string
  to: string | null
  pill: string
  tone: 'hw' | 'bad' | 'lesson'
}

const TONE: Record<TodayItem['tone'], string> = { hw: 'stu-tag t-or', bad: 'stu-tag t-red', lesson: 'stu-tag t-blue' }

/**
 * «Сегодня» — списком с галочками (письмо 16.10): ДЗ к сдаче (те же, что
 * считает «ДЗ» в меню) и следующий урок. «Задачу дня» владелец снял с главной
 * 13.10 — её здесь нет. Пусто — одна отмеченная строка «всё сделано».
 */
export function HomeToday({ items, loading }: { items: TodayItem[]; loading: boolean }) {
  return (
    <section className="stu-nblock" data-testid="home-today" aria-labelledby="home-today-h">
      <div className="stu-nblock-h">
        <h2 id="home-today-h"><Sticker name="check" size={26} />Сегодня</h2>
      </div>
      {loading ? (
        <p className="stu-muted text-[14px]">Загружаем…</p>
      ) : items.length === 0 ? (
        <ul className="stu-checks"><li data-done><span className="stu-cbx on" aria-hidden="true">✓</span><span className="flex-1">На сегодня всё сделано — можно повторить или решить задачи в банке</span></li></ul>
      ) : (
        <ul className="stu-checks">
          {items.map(it => (
            <li key={it.key} data-testid="home-today-item">
              <span className="stu-cbx" aria-hidden="true" />
              {it.to ? <Link to={it.to} className="min-w-0 flex-1 hover:underline">{it.text}</Link> : <span className="min-w-0 flex-1">{it.text}</span>}
              <span className={`${TONE[it.tone]} shrink-0`}>{it.pill}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
