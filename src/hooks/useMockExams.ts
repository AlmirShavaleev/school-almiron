import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { useEffectiveRole } from '@/store/staffModeStore'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'
import { ownStudentRow } from '@/lib/ownStudent'
import { hasWorkOf, windowOf, type ExamListProgress, type WorkInput } from '@/lib/mockExamV3'
import type { Tables } from '@/types/database'

const EXAM_COLUMNS = 'id, title, date, subject, exam_type, group_id, max_score'
const LIST_TAIL = 'starts_at, duration_minutes, photo_grace_minutes, mock_exam_templates(max_points), mock_exam_sheets(student_id, submitted_at, answers), mock_exam_photos(student_id), mock_exam_task_scores(student_id, task_number), mock_exam_results(student_id), mock_exam_rosters(student_ids)'
/**
 * §218. Только для выгрузки в Excel: имя ученика, итог и баллы по номерам.
 */
const EXPORT_TAIL = 'mock_exam_templates(max_points), mock_exam_task_scores(student_id,task_number,points), mock_exam_results(student_id,score,primary_score,part1_score,part2_score,notes,students(profiles(full_name)))'
/**
 * §219. Режим учителя — пробники ГРУППЫ, а не автора. `!inner` здесь
 * намеренно: пробник без группы (девять образцов прода) ни к кому не
 * относится и в режиме учителя не показывается, а у настоящего
 * преподавателя RLS на `groups` (`groups_select_all` → `course_is_staff`)
 * оставляет ровно группы курсов, где он персонал, — и пробник коллеги по
 * курсу тоже.
 */
export type MockExamListItem = Pick<Tables<'mock_exams'>, 'id' | 'title' | 'date' | 'subject' | 'exam_type' | 'group_id' | 'max_score'> & {
  groups: { name: string } | null
  progress?: ExamListProgress
}

type StaffExamRow = Omit<MockExamListItem, 'groups' | 'progress'> & Parameters<typeof windowOf>[0] & {
  groups: { name: string; group_students: { student_id: string }[] } | null
  mock_exam_templates: { max_points: number[] } | null
  mock_exam_sheets: (NonNullable<WorkInput['sheet']> & { student_id: string })[]
  mock_exam_photos: { student_id: string }[]
  mock_exam_task_scores: { student_id: string; task_number: number }[]
  mock_exam_results: { student_id: string }[]
  mock_exam_rosters: { student_ids: string[] } | null
}

export type MockExamExportItem = MockExamListItem & {
  mock_exam_templates: { max_points: number[] } | null
  mock_exam_task_scores: { student_id: string; task_number: number; points: number }[]
  mock_exam_results: (Pick<Tables<'mock_exam_results'>, 'student_id' | 'score' | 'part1_score' | 'part2_score' | 'notes'> & {
    primary_score: number | null
    students: { profiles: { full_name: string } | null } | null
  })[]
}

/**
 * Узкий вид клиента для запроса по группам: фильтр по колонке встроенной
 * таблицы (`groups.course_id`) сгенерированные типы не знают.
 */
type ExamQueryResult<T> = { data: T[] | null; error: { message: string } | null }
interface ExamQuery<T> {
  in(column: string, values: string[]): ExamQuery<T>
  eq(column: string, value: string): ExamQuery<T>
  order(column: string, opts: { ascending: boolean }): PromiseLike<ExamQueryResult<T>>
}

function loadStaffExams<T>(isTeacher: boolean, courseIds: string[] | null, exportGroup?: string | null): PromiseLike<ExamQueryResult<T>> {
  // Для списка и выгрузки применяется одинаковый преподавательский охват.
  if (isTeacher && courseIds?.length === 0) return Promise.resolve({ data: [], error: null })
  const groupFields = exportGroup === undefined ? 'name, group_students(student_id)' : 'name'
  const groupSelect = isTeacher ? `groups!inner(${groupFields}, course_id)` : `groups(${groupFields})`
  const tail = exportGroup === undefined ? LIST_TAIL : EXPORT_TAIL
  const db = supabase as unknown as { from(t: string): { select(s: string): ExamQuery<T> } }
  let query = db.from('mock_exams').select(`${EXAM_COLUMNS}, ${groupSelect}, ${tail}`)
  if (isTeacher && courseIds) query = query.in('groups.course_id', courseIds)
  if (exportGroup) query = query.eq('group_id', exportGroup)
  return query.order('date', { ascending: false })
}

function listItem(row: StaffExamRow): MockExamListItem {
  const { id, title, date, subject, exam_type, group_id, max_score } = row
  const groups = row.groups ? { name: row.groups.name } : null
  const item = { id, title, date, subject, exam_type, group_id, max_score, groups }
  const window = windowOf(row)
  const taskCount = row.mock_exam_templates?.max_points.length
  const results = row.mock_exam_results ?? []

  // У старого пробника сохранён только итог. По номерам его уже не проверяют.
  if (!group_id || !taskCount) {
    const hasWork = results.length > 0
    return { ...item, progress: { window, hasWork, allChecked: hasWork } }
  }

  const roster = new Set(row.groups?.group_students?.map(student => student.student_id))
  const studentsWithWork = new Set<string>()
  const marked = new Map<string, number>()
  for (const sheet of row.mock_exam_sheets) {
    if (hasWorkOf({ sheet, photos: 0 })) studentsWithWork.add(sheet.student_id)
  }
  for (const photo of row.mock_exam_photos) studentsWithWork.add(photo.student_id)
  for (const result of results) studentsWithWork.add(result.student_id)
  for (const task of row.mock_exam_task_scores) {
    if (task.task_number < 1 || task.task_number > taskCount) continue
    studentsWithWork.add(task.student_id)
    marked.set(task.student_id, (marked.get(task.student_id) ?? 0) + 1)
  }

  const selected = row.mock_exam_rosters ? new Set(row.mock_exam_rosters.student_ids) : null
  const participants = [...studentsWithWork].filter(studentId => roster.has(studentId) && (!selected || selected.has(studentId)))
  const hasWork = participants.length > 0
  const allChecked = hasWork && participants.every(studentId => marked.get(studentId) === taskCount)
  return { ...item, progress: { window, hasWork, allChecked } }
}

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
  const role = effectiveRole ?? profile?.role
  const [exams,    setExams]   = useState<MockExamListItem[]>([])
  const [myResults, setMyResults] = useState<any[]>([])
  const [loading,  setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    setLoading(true)
    // Набор «что моё» ещё грузится — спрашивать рано: иначе на кадр
    // показали бы пустой список (или, хуже, всю школу).
    if (role === 'teacher' && scopeKey === 'loading') return
    let cancelled = false
    let requesting = false
    let refreshTimer: ReturnType<typeof setTimeout> | undefined

    async function load() {
      if (requesting) return
      requesting = true
      clearTimeout(refreshTimer)
      const requestedAt = Date.now()
      try {
        if (role === 'student') {
          const { data: st } = await ownStudentRow(profile!.id)
          if (!st) return

          // Student sees their own results joined with exam info
          const { data: results } = await supabase
            .from('mock_exam_results')
            .select('*, mock_exams(*, groups(name))')
            .eq('student_id', st.id)
            .order('created_at', { ascending: true })
          if (cancelled) return
          setMyResults(results || [])
          setExams((results || []).flatMap(r => r.mock_exams ? [r.mock_exams] : []))
        } else {
          const { data } = await loadStaffExams<StaffExamRow>(role === 'teacher', scope.active ? scope.courseIds : null)
          if (cancelled) return
          const list = (data ?? []).map(listItem)
          setExams(list)

          // После закрытия приёма фото перечитываем работы, поступившие с момента открытия списка.
          const now = Date.now()
          const nextClose = list.reduce((next, exam) => {
            const close = Date.parse(exam.progress?.window.photos_until ?? '')
            return close > requestedAt ? Math.min(next, close) : next
          }, Infinity)
          if (Number.isFinite(nextClose)) {
            refreshTimer = setTimeout(load, Math.max(0, Math.min(nextClose - now, 2_147_483_647)))
          }
        }
      } finally {
        requesting = false
        if (!cancelled) setLoading(false)
      }
    }
    load()
    if (role !== 'student') window.addEventListener('focus', load)
    return () => {
      cancelled = true
      clearTimeout(refreshTimer)
      window.removeEventListener('focus', load)
    }
    // scope.courseIds входит через scopeKey — строкой, чтобы новый массив с
    // тем же содержимым не перезапрашивал список.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, role, tick, scopeKey])

  const loadExportExams = (groupId: string | null) =>
    loadStaffExams<MockExamExportItem>(role === 'teacher', scope.active ? scope.courseIds : null, groupId)

  return { exams, myResults, loading, loadExportExams }
}
