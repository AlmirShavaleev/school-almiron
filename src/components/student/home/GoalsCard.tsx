import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sticker } from '@/components/student/skin/Sticker'
import { fetchMyWeeklyGoals, weeklyGoalTitle, weeklyProgressLabel, type WeeklyGoal } from '@/lib/studentGoals'

/**
 * «Цели недели» на главной ученика — «блокнотом» (письмо
 * ЛК_стиль_главная_как_notion.md, 16.10): список с галочками и прогрессом
 * («3 из 5 дней»), неделя пн–вс. Цель на экзамен — в строке свойств шапки.
 * Целей нет — мягкая строка «Поставь цели на неделю» в настройки.
 * `weekly` — уже загруженные цели (главная грузит их один раз); без него
 * карточка читает сама.
 */
export function GoalsCard({ weekly: given }: { weekly?: WeeklyGoal[] | null }) {
  const [own, setOwn] = useState<WeeklyGoal[] | null>(null)
  useEffect(() => {
    if (given !== undefined) return
    let cancelled = false
    fetchMyWeeklyGoals().then(w => { if (!cancelled) setOwn(w.data?.goals ?? []) })
    return () => { cancelled = true }
  }, [given])
  const goals = given !== undefined ? given : own
  if (goals == null) return null
  const done = goals.filter(g => g.done).length

  return (
    <section className="stu-nblock" data-testid="home-goals" aria-labelledby="home-goals-h">
      <div className="stu-nblock-h">
        <h2 id="home-goals-h"><Sticker name="target" size={26} />Цели недели</h2>
        {goals.length > 0 && <span className="stu-muted text-[13px] font-semibold" data-testid="home-goals-summary">выполнено {done} из {goals.length}</span>}
      </div>
      {goals.length > 0 ? (
        <>
          <ul className="stu-checks">
            {goals.map(g => (
              <li key={g.kind} data-testid="home-weekly-goal" data-done={g.done || undefined}>
                <span className={g.done ? 'stu-cbx on' : 'stu-cbx'} aria-hidden="true">{g.done ? '✓' : ''}</span>
                <span className="min-w-0 flex-1">
                  <span className="block">{weeklyGoalTitle(g.kind, g.target)}</span>
                  <span className="stu-step-t mt-1.5 block"><i className="d" style={{ width: `${Math.min(100, (g.progress / g.target) * 100)}%` }} /></span>
                </span>
                <span className={g.done ? 'stu-tag t-green shrink-0' : 'stu-muted shrink-0 font-semibold tabular-nums'}>{g.done ? 'выполнено' : weeklyProgressLabel(g)}</span>
              </li>
            ))}
          </ul>
          <Link to="/settings?tab=goals" className="stu-link self-start text-[13.5px]">Изменить цели</Link>
        </>
      ) : (
        <Link to="/settings?tab=goals" className="stu-goals-empty" data-testid="home-goals-empty">
          <b>Поставь цели на неделю</b>
          <span className="stu-muted">Заходить, проходить темы, решать задачи — 1–3 цели, каждую неделю</span>
        </Link>
      )}
    </section>
  )
}
