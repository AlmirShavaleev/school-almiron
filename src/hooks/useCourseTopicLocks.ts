/**
 * §288. Замки уроков курса «по прохождению» (`my_course_topic_locks`).
 * Курс по датам — `mode: 'schedule'`, программа показывается по-старому.
 * Без react-query, как useCourseAccess: страница курса живёт и без провайдера.
 * Ошибка чтения = «нет данных»: правила по датам, страница цела.
 *
 * `who` — ученик (id профиля): тогда по приходу ответа считается, какие уроки
 * открылись с прошлого визита (`opened`, для «Открыт урок «…»»). В превью
 * персонала — null, сообщений нет.
 */
import { useCallback, useEffect, useState } from 'react'
import { fetchCourseTopicLocks, takeNewlyOpened, type CourseTopicLocks, type TopicLock } from '@/lib/progressUnlock'

interface Got {
  courseId: string
  data: CourseTopicLocks | null
  opened: TopicLock[]
}

export function useCourseTopicLocks(courseId: string | null | undefined, who: string | null = null) {
  const [got, setGot] = useState<Got | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!courseId) return
    let alive = true
    fetchCourseTopicLocks(courseId)
      .then((d) => {
        if (!alive) return
        setGot({ courseId, data: d, opened: d && who ? takeNewlyOpened(courseId, who, d) : [] })
      })
      .catch(() => { if (alive) setGot({ courseId, data: null, opened: [] }) })
    return () => {
      alive = false
    }
  }, [courseId, who, tick])
  const refresh = useCallback(() => setTick((n) => n + 1), [])
  const mine = got && got.courseId === courseId ? got : null
  return { data: mine?.data ?? null, opened: mine?.opened ?? [], refresh }
}
