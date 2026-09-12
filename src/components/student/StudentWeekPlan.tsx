import { Link } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Circle, Lock } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { useStudentWeekPlan, type StudentWeekCourse, type StudentWeekTopic } from '@/hooks/useStudentWeekPlan'
import { HW_STATUS_LABEL, formatDayShort, formatWeekRange } from '@/lib/studyPlanBoard'
import { cn } from '@/utils/cn'

/**
 * «Эта неделя» в кабинете ученика (§151).
 *
 * Показывает ровно текущую неделю плана: темы, срок до воскресенья и что из
 * этого уже сдано. Список на пятьдесят недель вперёд ученику не нужен и
 * давит — решение владельца.
 *
 * Пока планов нет ни у одного курса, компонент не рисует ничего: пустая
 * карточка «нет плана» читалась бы как поломка, а не как ответ.
 */
export function StudentWeekPlan({ courseId, className }: { courseId?: string; className?: string }) {
  const { courses, loading, error } = useStudentWeekPlan()
  if (loading || error) return null

  const visible = courseId ? courses.filter(c => c.course_id === courseId) : courses
  if (visible.length === 0) return null

  return (
    <div className={cn('space-y-4', className)} data-testid="student-week-plan">
      {visible.map(course => <WeekCard key={course.course_id} course={course} showTitle={!courseId} />)}
    </div>
  )
}

function topicLine(topic: StudentWeekTopic): { label: string; done: boolean } {
  if (topic.hw_published) {
    return { label: HW_STATUS_LABEL[topic.hw_status], done: topic.done }
  }
  // Без опубликованного ДЗ зачёт идёт по отметке «пройдено» — и об этом
  // сказано прямо, чтобы «не сдано» не читалось там, где сдавать нечего.
  return {
    label: topic.done ? 'пройдено' : 'ДЗ нет — отметь тему пройденной',
    done: topic.done,
  }
}

function WeekCard({ course, showTitle }: { course: StudentWeekCourse; showTitle: boolean }) {
  const { week_no: week, weeks_total: total } = course

  let body: React.ReactNode
  if (week < 1) {
    body = <p className="text-sm text-gray-500">План начнётся {formatDayShort(course.week_start)}.</p>
  } else if (total > 0 && week > total) {
    body = <p className="text-sm text-gray-500">План курса завершён.</p>
  } else if (course.topics.length === 0) {
    body = <p className="text-sm text-gray-500">На этой неделе тем по плану нет.</p>
  } else {
    const done = course.topics.filter(t => t.done).length
    body = (
      <>
        <p className="text-xs text-gray-500">
          Срок — до воскресенья {formatDayShort(course.week_end)} · сделано {done} из {course.topics.length}
        </p>
        <ul className="mt-2 divide-y divide-gray-100">
          {course.topics.map(topic => {
            const line = topicLine(topic)
            const inner = (
              <>
                {line.done
                  ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-600" />
                  : topic.open_now
                    ? <Circle size={16} className="mt-0.5 shrink-0 text-gray-300" />
                    : <Lock size={16} className="mt-0.5 shrink-0 text-gray-300" />}
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm break-words', line.done ? 'text-gray-500' : 'text-gray-900')}>
                    {topic.title}
                  </span>
                  <span className={cn('block text-xs', line.done ? 'text-green-700' : 'text-gray-500')}>
                    {topic.open_now ? line.label : 'откроется позже'}
                  </span>
                </span>
              </>
            )
            return (
              <li key={topic.topic_id} data-testid="student-week-topic">
                {topic.open_now ? (
                  <Link
                    to={`/my-course/${course.group_id}/topic/${topic.topic_id}`}
                    className="flex min-h-11 items-start gap-2 py-2 hover:bg-gray-50 rounded-lg -mx-1 px-1"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex min-h-11 items-start gap-2 py-2 opacity-70">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      </>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <CalendarDays size={16} className="text-primary-600" />
            {week >= 1 && (total === 0 || week <= total)
              ? <>Неделя {week} · {formatWeekRange(course.week_start, 1)}</>
              : 'Учебный план'}
          </span>
        </CardTitle>
      </CardHeader>
      {showTitle && <p className="mb-2 text-xs text-gray-400">{course.course_title}</p>}
      {body}
    </Card>
  )
}
