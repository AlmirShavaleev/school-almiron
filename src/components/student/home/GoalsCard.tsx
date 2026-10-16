import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sticker } from '@/components/student/skin/Sticker'
import {
  examGoalLabel, fetchMyExamGoals, fetchMyWeeklyGoals, goalBasis, weeklyGoalTitle, weeklyProgressLabel,
  type CourseWeekly, type ExamGoal, type GoalSubject,
} from '@/lib/studentGoals'

/**
 * «Цели» на главной ученика (письмо ЛК_стиль_настройки_ученика.md, правка
 * 16.10 15:46): сверху — цель на экзамен («Цель: физика 80+», её ставит
 * ученик) и на чём основана оценка пути (последний пробник или «пройдено N из M
 * тем курса»); ниже — «Цели недели», которые поставил преподаватель, с
 * прогрессом («3 из 5 дней»), неделя пн–вс. Ничего нет — одна строка со
 * ссылкой на цель на экзамен.
 */
export interface GoalBasisSource {
  subject: GoalSubject
  mock: { score: number; max: number } | null
  course: { done: number; total: number } | null
}

export function GoalsCard({ profileId, sources }: { profileId: string; sources: GoalBasisSource[] }) {
  const [exam, setExam] = useState<ExamGoal[] | null>(null)
  const [weekly, setWeekly] = useState<CourseWeekly[] | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchMyExamGoals(profileId), fetchMyWeeklyGoals()]).then(([e, w]) => {
      if (cancelled) return
      setExam(e); setWeekly(w.error ? [] : w.courses)
    })
    return () => { cancelled = true }
  }, [profileId])

  if (exam == null || weekly == null) return null
  const goals = weekly.flatMap(c => c.goals.map(g => ({ ...g, course: c.courseTitle })))
  const done = goals.filter(g => g.done).length
  const many = weekly.length > 1

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
            <p className="mt-1 text-[15px]">
              <span className="stu-h3 block">Поставь цель на экзамен</span>
              <Link to="/settings?tab=goals" className="stu-link">Выбрать балл</Link>
            </p>
          )}
        </div>
        <Sticker name="target" size={56} />
      </div>

      {goals.length > 0 && (
        <div className="stu-goals-week">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-[15px]">Цели недели</b>
            <span className="stu-muted text-[13px] font-semibold" data-testid="home-goals-summary">выполнено {done} из {goals.length}</span>
          </div>
          <ul className="flex flex-col gap-2.5">
            {goals.map(g => (
              <li key={`${g.course}-${g.kind}`} data-testid="home-weekly-goal" data-done={g.done || undefined}>
                <div className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="min-w-0 font-semibold">
                    {weeklyGoalTitle(g.kind, g.target)}{many && <span className="stu-muted font-medium"> · {g.course}</span>}
                  </span>
                  <span className={g.done ? 'stu-tag t-green shrink-0' : 'stu-muted shrink-0 font-semibold tabular-nums'}>{g.done ? '✓ выполнено' : weeklyProgressLabel(g)}</span>
                </div>
                <span className="stu-step-t mt-1.5 block"><i className="d" style={{ width: `${Math.min(100, (g.progress / g.target) * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
          <p className="stu-muted text-[12.5px]">Цели недели ставит преподаватель · неделя с понедельника по воскресенье</p>
        </div>
      )}
    </section>
  )
}
