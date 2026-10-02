import { Link } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { numbersText, weeklyProgressText, type WeeklyGoal } from '@/lib/catalogRewards'
import { longDay } from '@/lib/studentHome'

/**
 * §256. «Цель недели»: 10 задач каталога из двух слабых номеров, пн–вс по
 * Москве. Номера фиксирует база на неделю (`student_weekly_goal`), прогресс —
 * засчитанные задачи этих номеров за неделю; бонус начисляет
 * `student_school_points` один раз.
 */
export function WeeklyGoalCard({ goal, className }: { goal: WeeklyGoal; className?: string }) {
  const ratio = Math.min(1, goal.progress / goal.target)
  const next = goal.sections[0] ?? null
  const subjectSlug = goal.subject === 'physics' ? 'physics' : 'math'
  return (
    <section aria-labelledby="home-weekly-h" data-testid="weekly-goal-card" data-done={goal.done || undefined} className={cn('platform-surface flex flex-col gap-3 rounded-card p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h2 id="home-weekly-h" className="text-[15px] font-extrabold text-graphite-950">Цель недели</h2>
        <span className="rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-extrabold text-gold-800">бонус +{goal.bonus}</span>
      </div>
      <p className="text-sm text-graphite-500">
        {goal.target} задач из {goal.numbers.length > 1 ? 'двух ваших слабых номеров' : 'вашего слабого номера'}: {numbersText(goal.numbers)}.
        {goal.weekEnd ? ` До воскресенья, ${longDay(goal.weekEnd)}.` : ' До воскресенья.'}
      </p>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-graphite-100"
        role="progressbar"
        aria-label="Цель недели"
        aria-valuemin={0}
        aria-valuemax={goal.target}
        aria-valuenow={Math.min(goal.progress, goal.target)}
      >
        <i className="block h-full rounded-full bg-verdict-ok transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b data-testid="weekly-progress" className="text-sm text-graphite-900">{weeklyProgressText(goal)}</b>
        {!goal.done && next && (
          <Link
            to={`/catalog/${next.sectionId}?subject=${subjectSlug}&exam=ege`}
            className="rounded-[10px] bg-primary-50 px-3 py-1.5 text-[13px] font-extrabold text-primary-700 ring-1 ring-primary-200 hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            Продолжить №{next.n} →
          </Link>
        )}
      </div>
    </section>
  )
}
