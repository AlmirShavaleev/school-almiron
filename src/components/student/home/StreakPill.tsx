import { Zap } from 'lucide-react'
import { cn } from '@/utils/cn'
import { streakPhrase, weekDots, type HomeActivity } from '@/lib/studentHome'

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

/** §254. Плашка серии в шапке: «N дней подряд» и точки текущей недели пн–вс. */
export function StreakPill({ activity }: { activity: HomeActivity }) {
  const dots = weekDots(activity)
  const visitedNames = WEEKDAYS.filter((_, i) => dots[i])
  // §256: серия — дни с решением, а не заходы (пока база старая — заходы).
  const bySolve = activity.streakDays != null
  return (
    <div
      data-testid="streak-pill"
      className="inline-flex max-w-full items-center gap-2.5 rounded-full bg-gold-100 py-1.5 pl-2 pr-3.5 text-[15px] font-extrabold text-graphite-950"
      title={bySolve ? 'Дни подряд, когда вы что-то решили: задачу каталога с проверкой, ДЗ, тест или пробник' : 'Дни подряд, когда вы заходили в школу'}
    >
      <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-300">
        <Zap size={16} strokeWidth={2.4} className="text-graphite-900" />
      </span>
      <span className="whitespace-nowrap">{activity.streak > 0 ? streakPhrase(activity.streak) : 'Начните серию'}</span>
      <span
        className="ml-0.5 inline-flex gap-1"
        role="img"
        aria-label={visitedNames.length > 0
          ? `Эта неделя: ${bySolve ? 'решали' : 'заходили'} — ${visitedNames.join(', ')}`
          : bySolve ? 'На этой неделе ещё ничего не решали' : 'На этой неделе ещё не заходили'}
      >
        {dots.map((on, i) => (
          <i key={i} data-on={on || undefined} className={cn('h-[9px] w-[9px] rounded-full', on ? 'bg-gold-400' : 'bg-graphite-200')} />
        ))}
      </span>
    </div>
  )
}
