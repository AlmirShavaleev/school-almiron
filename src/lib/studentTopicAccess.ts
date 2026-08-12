import { supabase } from '@/lib/supabase'

/**
 * Как ученик попадает в тему: одно правило адреса и один способ узнать группу.
 *
 * Раньше адрес собирался в двух местах по двум разным источникам. На странице
 * ДЗ группа бралась из `useMyCourseMemberships`, а тот выбрасывает курсы с
 * `is_active = false` — у ученика 11А оба курса были черновиками, и карточки
 * ДЗ показывались, но никуда не вели (§123.3). При этом на дашборде тот же
 * переход работал: там группа читалась прямо из `group_students`.
 *
 * Отсюда правило: группу берём из ТОГО ЖЕ источника, который вообще дал право
 * увидеть работу, — из членства в группе. Активность курса к доступу
 * отношения не имеет: и журнальная RPC, и политики ДЗ сужают по
 * `group_students`, а не по `courses.is_active`. Витринный признак «курс
 * опубликован» не должен решать, откроется ли тема.
 */

/** Строка членства в том виде, в каком её отдаёт запрос ниже. */
interface MembershipRow {
  groups?: { id?: string | null; course_id?: string | null } | null
}

/**
 * Курс → группа. Первая встреченная группа курса выигрывает: с §61 закон
 * «один курс = одна группа» держит база (unique на `groups.course_id`), но
 * читать это как «строка ровно одна» нельзя — старые данные переживали и
 * дубли, и падать на них незачем.
 */
export function groupIdByCourse(rows: unknown[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of rows) {
    const group = (raw as MembershipRow)?.groups
    const courseId = group?.course_id
    const groupId = group?.id
    if (!courseId || !groupId) continue
    if (!map.has(courseId)) map.set(courseId, groupId)
  }
  return map
}

/**
 * Группы ученика по курсам. Сужение держит RLS (`group_students_select_own`),
 * своего фильтра «только моё» здесь нет и быть не может.
 *
 * Фильтра по `is_active` — ни у группы, ни у курса — тоже нет намеренно:
 * см. заголовок файла.
 */
export async function fetchGroupIdByCourse(studentId: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('group_students')
    .select('group_id, groups!inner(id, course_id)')
    .eq('student_id', studentId)
  return groupIdByCourse(data ?? [])
}

/**
 * Адрес темы в кабинете ученика. Единственное место, где живёт этот путь.
 *
 * `null` — когда группу назвать нечем. Тогда карточка не притворяется ссылкой:
 * лучше неактивная строка, чем переход в никуда. Практически это состояние
 * достижимо только пока карта групп ещё едет либо если запрос членства
 * отказал; отчисленный из группы ученик работы в списке уже не увидит — и ДЗ,
 * и журнал сужаются тем же членством, так что «строка есть, а группы нет» из
 * отчисления не рождается.
 */
export function myTopicHref(
  groupId: string | null | undefined,
  topicId: string | null | undefined,
): string | null {
  if (!groupId || !topicId) return null
  return `/my-course/${groupId}/topic/${topicId}`
}
