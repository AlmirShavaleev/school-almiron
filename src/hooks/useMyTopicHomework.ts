import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useStudentTopicJournal } from '@/hooks/useStudentTopicJournal'
import { useMyCourseMemberships } from '@/hooks/useMyCourseMemberships'
import {
  splitHomeworkBuckets, homeworkCourseOptions, filterHomeworkByCourse,
  type HomeworkBuckets, type HomeworkCourseOption, type TopicJournalHomework,
} from '@/lib/topicJournal'
import { fetchGroupIdByCourse, myTopicHref } from '@/lib/studentTopicAccess'
import { keepLessonItem, useLessonHomeworkFilter } from '@/lib/lessonCourses'
import { autocheckLeft, withAutocheck, type AutocheckProgress, type BoardRow } from '@/lib/homeworkBoard'

/**
 * ДЗ с автопроверкой среди открытых: какие ДЗ (`topic_homework.autocheck`) и
 * сколько задач осталось по урокам. Ученику база отдаёт только ДЗ и задачи
 * открытых ему тем (политики §282.2) и только свои ответы. Сбой — пусто:
 * такие ДЗ остаются со статусом журнала.
 */
async function loadAutocheck(topicIds: string[]): Promise<{ hw: Set<string>; progress: Map<string, AutocheckProgress> }> {
  const empty = { hw: new Set<string>(), progress: new Map<string, AutocheckProgress>() }
  if (topicIds.length === 0) return empty
  try {
    const db = supabase as unknown as {
      from: (t: string) => { select: (c: string) => { in: (c: string, v: string[]) => { eq: (c: string, v: unknown) => PromiseLike<{ data: unknown[] | null; error: unknown }> } & PromiseLike<{ data: unknown[] | null; error: unknown }> } }
    }
    const hwRes = await db.from('topic_homework').select('id, topic_id').in('topic_id', topicIds).eq('autocheck', true)
    if (hwRes.error) return empty
    const hwRows = (hwRes.data ?? []) as Array<{ id: string; topic_id: string }>
    if (hwRows.length === 0) return empty
    const acTopics = [...new Set(hwRows.map(h => h.topic_id))]
    const tasksRes = await db.from('topic_autocheck_tasks').select('id, topic_id').in('topic_id', acTopics)
    const tasks = (tasksRes.error ? [] : tasksRes.data ?? []) as Array<{ id: string; topic_id: string }>
    const answersRes = tasks.length
      ? await db.from('topic_autocheck_answers').select('task_id, is_correct').in('task_id', tasks.map(t => t.id))
      : { data: [], error: null }
    const answers = (answersRes.error ? [] : answersRes.data ?? []) as Array<{ task_id: string; is_correct: boolean }>
    return { hw: new Set(hwRows.map(h => h.id)), progress: autocheckLeft(tasks, answers) }
  } catch {
    return empty
  }
}

/**
 * students.id текущего пользователя. Тот же однострочный резолв, что руками
 * повторён в десятке хуков; здесь он нужен, чтобы отдать p_student_id в
 * get_student_topic_journal (RPC сама проверит, что это «сам ученик»).
 */
export function useMyStudentId(enabled = true) {
  const profileId = useAuthStore(s => s.profile?.id)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // `enabled = false` — предпросмотр глазами ученика (§178): у владельца
    // строки `students` нет, и искать её незачем.
    if (!profileId || !enabled) { setStudentId(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    supabase.from('students').select('id').eq('profile_id', profileId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setStudentId(data?.id ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [profileId, enabled])

  return { studentId, loading }
}

/**
 * Своё ДЗ по новому контуру, разложенное по трём корзинам для страницы
 * «Домашние задания» ученика.
 *
 * Источник — та же RPC get_student_topic_journal, что и журнал: она
 * единственная отдаёт ДЗ, к которому ученик ещё НЕ прикасался
 * (status = 'not_started'). Дашборд (useStudentDashboard) читает только
 * topic_homework_attempts, поэтому «предстоящие» там не видны в принципе —
 * из-за этого у ученика и не было списка предстоящих работ.
 *
 * `useMyCourseMemberships` остался ровно для одного — полного списка курсов
 * ученика в ряду переключателей: курс без заданий тоже должен быть виден.
 * Адрес темы он больше не даёт, см. ниже.
 *
 * Предмет для цветной метки читается ОТДЕЛЬНЫМ запросом по `courses`, а не
 * берётся из зачислений: `useMyCourseMemberships` выбрасывает курсы с
 * `is_active = false`, а на проде оба курса единственного ученика с двумя
 * курсами именно такие — метка тогда красилась бы запасным цветом у обоих, то
 * есть ровно там, где она нужна. Политика чтения `courses` про `is_active`
 * ничего не знает, сужение держит членство в группе.
 *
 * `courseId` — выбранный курс (null = все). Отбор идёт ДО раскладки по
 * корзинам, поэтому порядок «сначала срочное» одинаков в любом режиме, а
 * счётчики в переключателях считаются по неотфильтрованным строкам.
 */
export function useMyTopicHomework(courseId: string | null = null) {
  const { studentId, loading: resolvingStudent } = useMyStudentId()
  const { journal, loading: loadingJournal, error, reload } = useStudentTopicJournal(studentId)
  const { courses, loading: loadingCourses } = useMyCourseMemberships()

  // Группа для ссылки — из членства, а не из зачислений: `useMyCourseMemberships`
  // выбрасывает курсы с `is_active = false`, и карточки ДЗ у ученика с
  // курсом-черновиком переставали быть ссылками (§123.7). Право увидеть работу
  // дало членство в группе — оно же обязано давать и адрес темы.
  const [groupByCourseId, setGroupByCourseId] = useState<Map<string, string>>(new Map())
  const [loadingGroups, setLoadingGroups] = useState(true)

  useEffect(() => {
    if (!studentId) { setGroupByCourseId(new Map()); setLoadingGroups(false); return }
    let cancelled = false
    setLoadingGroups(true)
    fetchGroupIdByCourse(studentId).then(map => {
      if (cancelled) return
      setGroupByCourseId(map)
      setLoadingGroups(false)
    })
    return () => { cancelled = true }
  }, [studentId])

  // Через useMemo, а не выражением: `?? []` каждый раз даёт новый массив, и
  // зависящие от него useMemo пересчитывались бы на каждый рендер.
  const allRows = useMemo(() => journal?.homework ?? [], [journal])
  // 15.10, владелец: ДЗ «урочных» курсов (раздел «Мой курс») — только уроков,
  // открытых ученику сейчас (src/lib/lessonCourses.ts): в списке, счётчиках и
  // переключателе курсов. Школьные группы — как были.
  const lesson = useLessonHomeworkFilter(useMemo(
    () => [...allRows.map(r => r.course_id), ...courses.map(c => c.courseId)],
    [allRows, courses],
  ))
  const openRows = useMemo(() => allRows.filter(r => keepLessonItem(lesson.filter, r.course_id, r.topic_id)), [allRows, lesson.filter])

  // 15.10 (письмо ЛК_стиль_раздел_ДЗ_открытые_уроки.md): ДЗ с автопроверкой —
  // тоже карточкой; «сдать», пока остались задачи, «принято» — когда все закрыты.
  const topicKey = useMemo(() => [...new Set(openRows.map(r => r.topic_id))].sort().join(','), [openRows])
  const [autocheck, setAutocheck] = useState<{ key: string; hw: Set<string>; progress: Map<string, AutocheckProgress> } | null>(null)
  useEffect(() => {
    let alive = true
    loadAutocheck(topicKey ? topicKey.split(',') : []).then(r => { if (alive) setAutocheck({ key: topicKey, ...r }) })
    return () => { alive = false }
  }, [topicKey])
  const autocheckReady = !!autocheck && autocheck.key === topicKey
  const rows = useMemo<BoardRow[]>(
    () => withAutocheck(openRows, autocheckReady ? autocheck!.hw : new Set(), autocheckReady ? autocheck!.progress : new Map()),
    [openRows, autocheck, autocheckReady],
  )

  const courseIdsKey = useMemo(
    () => Array.from(new Set(rows.map(r => r.course_id))).sort().join(','),
    [rows],
  )

  const [subjectByCourseId, setSubjectByCourseId] = useState<Map<string, string | null>>(new Map())

  useEffect(() => {
    const ids = courseIdsKey ? courseIdsKey.split(',') : []
    if (ids.length === 0) { setSubjectByCourseId(new Map()); return }
    let cancelled = false
    supabase.from('courses').select('id, subject').in('id', ids)
      .then(({ data }) => {
        if (cancelled) return
        const map = new Map<string, string | null>()
        for (const row of data ?? []) map.set(row.id, row.subject ?? null)
        setSubjectByCourseId(map)
      })
    return () => { cancelled = true }
  }, [courseIdsKey])

  const courseOptions = useMemo<HomeworkCourseOption[]>(
    // Предмет из прямого чтения перекрывает предмет из зачислений: цвет в
    // кнопке и в карточке обязан считаться одним источником.
    () => homeworkCourseOptions(rows, courses)
      // Урочный курс — в переключателе, только если в нём есть открытое ДЗ.
      .filter(o => !lesson.filter.lessonIds.has(o.id) || rows.some(r => r.course_id === o.id))
      .map(o => ({ ...o, subject: subjectByCourseId.get(o.id) ?? o.subject })),
    [rows, courses, subjectByCourseId, lesson.filter],
  )

  // Курс из адреса, которого у ученика нет (выбыл из группы, ссылка со
  // стороны), считается «Все»: иначе страница навсегда застряла бы в отборе,
  // который ничего не может показать. Решение принимается здесь, а не на
  // странице, чтобы отбор и подсветка кнопки не могли разойтись.
  const activeCourseId = useMemo(
    () => (courseId && courseOptions.some(o => o.id === courseId) ? courseId : null),
    [courseId, courseOptions],
  )

  const buckets = useMemo<HomeworkBuckets<BoardRow>>(
    () => splitHomeworkBuckets(filterHomeworkByCourse(rows, activeCourseId)),
    [rows, activeCourseId],
  )

  /** Ссылка на тему с этим ДЗ. Путь собирает общее правило, не эта страница. */
  const topicLink = (row: TopicJournalHomework): string | null =>
    myTopicHref(groupByCourseId.get(row.course_id), row.topic_id)

  /** Предмет курса этой работы — для цвета метки. */
  const courseSubject = (row: TopicJournalHomework): string | null =>
    subjectByCourseId.get(row.course_id) ?? null

  return {
    buckets,
    /** Всего заданий у ученика, без учёта отбора: отличает «нет заданий вовсе» от «нет по этому курсу». */
    totalRows: rows.length,
    courseOptions,
    /** Курс, по которому реально идёт отбор (null = все). */
    activeCourseId,
    summary: journal?.summary ?? null,
    topicLink,
    courseSubject,
    // Ожидание групп входит в загрузку: иначе карточка успела бы отрисоваться
    // неактивной, а через мгновение стать ссылкой — мигание вместо перехода.
    /** Курсы «Мой курс» (уроки): остальные ДЗ — школьные группы, своей группой «Школа». */
    lessonCourseIds: lesson.filter.lessonIds,
    loading: resolvingStudent || loadingJournal || loadingCourses || loadingGroups || !lesson.ready || !autocheckReady,
    error,
    reload,
    /** Ученик не найден — например, персонал открыл страницу по прямой ссылке. */
    noStudentRecord: !resolvingStudent && !studentId,
  }
}

/**
 * Число «сдать» для бейджа «Домашние задания» в меню ученика — тот же хук и
 * то же правило, что счётчик «Сдать» на странице (письмо 15.10, п. 5): ДЗ
 * открытых уроков, включая автопроверку, и школьные. null — ещё грузится.
 */
export function useHomeworkToDoCount(): number | null {
  const { buckets, loading, noStudentRecord } = useMyTopicHomework(null)
  if (noStudentRecord) return 0
  return loading ? null : buckets.todo.length
}
