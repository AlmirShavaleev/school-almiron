import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sticker } from '@/components/student/skin/Sticker'
import { useStudentCourseProgram } from '@/hooks/useStudentCourseProgram'
import { useCourseDemo } from '@/hooks/useStudentPath'
import { studentProgramModules } from '@/lib/courseAssessments'
import { DEMO_LOCK_NOTE, withDemoLocks } from '@/lib/studentPath'
import type { LessonTile } from '@/lib/courseScreen'
import { continueCards } from '@/lib/homeNotion'

const STICKER: Record<LessonTile['state'], 'check' | 'book' | 'play' | 'lock'> = {
  done: 'check', review: 'check', hw: 'book', open: 'play', nohw: 'play', locked: 'lock',
}
const PILL: Record<LessonTile['state'], string> = {
  done: 'stu-tag t-green', review: 'stu-tag t-grey', hw: 'stu-tag t-or', open: 'stu-tag t-blue', nohw: 'stu-tag t-blue', locked: 'stu-tag t-grey',
}

/** «Продолжить» — карточки уроков: 3D-иконка сверху, «Урок N · название», раздел, статус. */
export function HomeContinue({ groupId, courseId, courseTitle, nextTopicId }: {
  groupId: string
  courseId: string
  courseTitle: string
  nextTopicId: string
}) {
  const { modules, loading } = useStudentCourseProgram(groupId)
  const demo = useCourseDemo(courseId)
  const cards = useMemo(
    () => continueCards(withDemoLocks(studentProgramModules(modules, false), demo), nextTopicId, demo ? DEMO_LOCK_NOTE : undefined),
    [modules, demo, nextTopicId],
  )
  const [tip, setTip] = useState<string | null>(null)
  if (loading || cards.length === 0) return null

  return (
    <section className="stu-nblock" data-testid="home-continue" aria-labelledby="home-continue-h">
      <div className="stu-nblock-h">
        <h2 id="home-continue-h"><Sticker name="book" size={26} />Продолжить</h2>
        <Link to={`/my-course/${groupId}`} className="stu-link text-[13.5px]">Весь курс</Link>
      </div>
      <ul className="stu-ncards">
        {cards.map(c => {
          const body = (
            <>
              <span className="stu-ncard-ph"><Sticker name={STICKER[c.tile.state]} size={52} /></span>
              <span className="stu-ncard-b">
                <b className="text-[14.5px] leading-snug break-words">Урок {c.no} · {c.title}</b>
                <span className="stu-ncard-m stu-muted text-[12.5px]" title={`${c.module} · ${courseTitle}`}>{c.module}</span>
                <span><span className={c.tile.overdue ? 'stu-tag t-red' : PILL[c.tile.state]} data-testid="home-continue-pill">{c.tile.pill}</span></span>
              </span>
            </>
          )
          return (
            <li key={c.id} className="relative flex" data-testid="home-continue-card" data-state={c.tile.state}>
              {c.tile.state === 'locked' ? (
                <button type="button" className="stu-ncard is-locked stu-focus text-left" onClick={() => setTip(tip === c.id ? null : c.id)}>{body}</button>
              ) : (
                <Link to={`/my-course/${groupId}/topic/${c.id}`} className="stu-ncard stu-focus">{body}</Link>
              )}
              {tip === c.id && c.tile.tip && <span role="tooltip" className="stu-lt-tip">{c.tile.tip}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
