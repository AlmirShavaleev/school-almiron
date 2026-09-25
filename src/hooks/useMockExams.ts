import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useEffectiveRole } from '@/store/staffModeStore'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * §218. К пробнику — его шаблон и баллы по заданиям: без них выгрузка в
 * Excel не знала бы, сколько набрано по каждому номеру. У старых пробников
 * шаблона нет, и оба поля приходят пустыми — список это переживает.
 */
const EXAM_TAIL = 'mock_exam_templates(title, max_points, part1_last), mock_exam_task_scores(student_id,task_number,points), mock_exam_results(student_id,score,primary_score,part1_score,part2_score,notes,students(profiles(full_name)))'
const EXAM_SELECT = `*, groups(name), ${EXAM_TAIL}`
/**
 * §219. Режим учителя — пробники ГРУППЫ, а не автора. `!inner` здесь
 * намеренно: пробник без группы (девять образцов прода) ни к кому не
 * относится и в режиме учителя не показывается, а у настоящего
 * преподавателя RLS на `groups` (`groups_select_all` → `course_is_staff`)
 * оставляет ровно группы курсов, где он персонал, — и пробник коллеги по
 * курсу тоже.
 */
const EXAM_SELECT_BY_GROUP = `*, groups!inner(name, course_id), ${EXAM_TAIL}`

/**
 * Узкий вид клиента для запроса по группам: фильтр по колонке встроенной
 * таблицы (`groups.course_id`) сгенерированные типы не знают.
 */
interface ByGroupQuery extends PromiseLike<{ data: unknown[] | null }> {
  in(column: string, values: string[]): ByGroupQuery
  order(column: string, opts: { ascending: boolean }): PromiseLike<{ data: unknown[] | null }>
}
const byGroup = () =>
  (supabase as unknown as { from(t: string): { select(s: string): ByGroupQuery } })
    .from('mock_exams').select(EXAM_SELECT_BY_GROUP)

export function useMockExams(tick = 0) {
  const profile = useAuthStore(s => s.profile)
  // Роль ПРЕДСТАВЛЕНИЯ, а не из профиля: владелец в режиме учителя видит
  // только своё. Под админской RLS база отдаёт ему всю школу, поэтому
  // сужение стоит в запросе клиента. На права это не влияет (§77).
  const effectiveRole = useEffectiveRole()
  // «Что моё» для владельца в режиме учителя — тот же набор, что у соседних
  // экранов (программа курса, ученики, проверка ДЗ). Своего правила нет.
  const scope = useMyTeachingScope()
  const scopeKey = scope.active ? (scope.loading ? 'loading' : scope.courseIds.join(',')) : 'off'
  const [exams,    setExams]   = useState<any[]>([])
  const [myResults, setMyResults] = useState<any[]>([])
  const [loading,  setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    setLoading(true)
    // Набор «что моё» ещё грузится — спрашивать рано: иначе на кадр
    // показали бы пустой список (или, хуже, всю школу).
    if ((effectiveRole ?? profile.role) === 'teacher' && scopeKey === 'loading') return

    async function load() {
      try {
        const role = effectiveRole ?? profile!.role

        if (role === 'student') {
          const { data: st } = await supabase
            .from('students').select('id').eq('profile_id', profile!.id).single()
          if (!st) return

          // Student sees their own results joined with exam info
          const { data: results } = await supabase
            .from('mock_exam_results')
            .select('*, mock_exams(*, groups(name))')
            .eq('student_id', st.id)
            .order('created_at', { ascending: true })
          setMyResults(results || [])
          setExams((results || []).map((r: any) => r.mock_exams).filter(Boolean))

        } else if (role === 'teacher') {
          // Раньше здесь был фильтр по автору (`created_by`) — и список
          // пустел дважды: у владельца с ролью admin пробник ложился с
          // created_by = null (§219), а второй преподаватель курса не видел
          // пробник коллеги. Пробник принадлежит группе, не автору.
          let q = byGroup()
          if (scope.active) {
            // Владелец в режиме учителя: RLS отдаёт ему всю школу, сужаем до
            // курсов, где он владелец или ведёт группу (useMyTeachingScope).
            if (scope.courseIds.length === 0) { setExams([]); return }
            q = q.in('groups.course_id', scope.courseIds)
          }
          const { data } = await q.order('date', { ascending: false })
          setExams(data || [])

        } else {
          const { data } = await supabase
            .from('mock_exams')
            .select(EXAM_SELECT)
            .order('date', { ascending: false })
          setExams(data || [])
        }
      } finally {
        setLoading(false)
      }
    }
    load()
    // scope.courseIds входит через scopeKey — строкой, чтобы новый массив с
    // тем же содержимым не перезапрашивал список.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, effectiveRole, tick, scopeKey])

  return { exams, myResults, loading }
}
