import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sticker } from '@/components/student/skin/Sticker'
import {
  examGoalLabel, fetchMyExamGoals, fetchMyRegularGoals, goalBasis, goalProgressLabel, goalTitle,
  type ExamGoal, type GoalSubject, type RegularGoal,
} from '@/lib/studentGoals'

/**
 * «Цели» на главной ученика (письмо ЛК_стиль_настройки_ученика.md, 16.10):
 * сверху — цель на экзамен по предмету («Цель: физика 80+») и на чём основана
 * оценка пути (последний пробник или «пройдено N из M тем курса»), ниже —
 * «Цели недели» с прогрессом. Целей нет — одна строка со ссылкой в настройки.
 * Сбой загрузки (миграции целей ещё нет) — карточку не показываем.
 */
export interface GoalBasisSource {
  subject: GoalSubject
  mock: { score: number; max: number } | null
  course: { done: number; total: number } | null
}

export function GoalsCard({ profileId, sources }: { profileId: string; sources: GoalBasisSource[] }) {
  const [exam, setExam] = useState<ExamGoal[] | null>(null)
  const [weekly, setWeekly] = useState<RegularGoal[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchMyExamGoals(profileId), fetchMyRegularGoals()]).then(([e, w]) => {
      if (cancelled) return
      setExam(e); setWeekly(w.goals); setFailed(!!w.error)
    })
    return () => { cancelled = true }
  }, [profileId])

  if (exam == null || weekly == null || (failed && exam.length === 0)) return null
  const done = weekly.filter(g => g.done).length

  return (
    <section className="stu-card stu-goals" data-testid="home-goals">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="stu-kicker">Цели</span>
          {exam.length > 0 ? exam.map(g => {
            const src = sources.find(s => s.subject === g.subject)
            const basis = src ? goalBasis(src.mock, src.course) : null
            return (
              <div key={g.subject} className="mt-1" data-testid={`home-exam-goal-${g.subject}`}>
                <p className="stu-h3">{examGoalLabel(g)}</p>
                {basis && <p className="stu-muted text-[13.5px]">{basis}</p>}
              </div>
            )
          }) : (
            <p className="stu-h3 mt-1">Поставь цель на экзамен</p>
          )}
        </div>
        <Sticker name="target" size={56} />
      </div>

      <div className="stu-goals-week">
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-[15px]">Цели недели</b>
          {weekly.length > 0 && <span className="stu-muted text-[13px] font-semibold" data-testid="home-goals-summary">выполнено {done} из {weekly.length}</span>}
        </div>
        {weekly.length === 0 ? (
          <p className="stu-muted text-[14px]">Целей на неделю нет. <Link to="/settings?tab=goals" className="stu-link">Поставить цели</Link></p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {weekly.map(g => (
              <li key={g.id} data-testid="home-weekly-goal" data-done={g.done || undefined}>
                <div className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="min-w-0 font-semibold">{goalTitle(g)}</span>
                  <span className={g.done ? 'stu-tag t-green shrink-0' : 'stu-muted shrink-0 font-semibold tabular-nums'}>{g.done ? '✓ выполнено' : goalProgressLabel(g)}</span>
                </div>
                <span className="stu-step-t mt-1.5 block"><i className="d" style={{ width: `${Math.min(100, (g.progress / g.target) * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        )}
        {(weekly.length > 0 || exam.length === 0) && <Link to="/settings?tab=goals" className="stu-link self-start">Изменить цели</Link>}
      </div>
    </section>
  )
}
