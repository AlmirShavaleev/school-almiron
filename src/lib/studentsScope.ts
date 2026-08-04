import type { MyStudent, MyStudentInvite } from '@/lib/studentEnrollment'
import type { MyJoinRequest } from '@/lib/teacherJoinRequests'
import type { TeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * Правила «моё ли это» для трёх вкладок раздела «Ученики».
 *
 * Живут отдельным модулем, а не внутри страницы, по двум причинам. Первая —
 * их можно проверить тестом без рендера. Вторая важнее: правила РАЗНЫЕ для
 * каждой вкладки, и держать их копию в тесте значило бы завести второй
 * источник правды — ровно тот рассинхрон, из-за которого случились §21 и §29.
 *
 * Почему сужение вообще нужно: все три RPC устроены как
 * `X = моё OR is_admin_or_owner()`, то есть администратору отдают всю школу.
 * В режиме учителя владелец обязан видеть только своё, и сделать это можно
 * только на клиенте — трогать общие функции ради режима представления нельзя,
 * ими пользуются настоящие преподаватели.
 *
 * Общий инвариант: пока набор «что моё» не приехал (`scope.loading`), не
 * показываем НИЧЕГО. Лучше пустой список на мгновение, чем чужие ученики.
 */

/** Свой ученик — тот, кто в моей группе или на моём курсе. */
export function isMyStudent(student: MyStudent, scope: TeachingScope): boolean {
  if (!scope.active) return true
  if (scope.loading) return false
  return student.groups.some(group => scope.groupIds.includes(group.id))
      || student.courses.some(course => scope.courseIds.includes(course.id))
}

/**
 * Своя заявка — адресованная лично мне. По группе тут отбирать нельзя в
 * принципе: заявка приходит от ученика, которого ещё нет ни в одной группе, —
 * в этом её смысл.
 */
export function isMyJoinRequest(request: MyJoinRequest, scope: TeachingScope): boolean {
  if (!scope.active) return true
  if (scope.loading) return false
  return request.teacherId != null && request.teacherId === scope.teacherId
}

/** Своё приглашение — выписанное мной либо в мою группу. */
export function isMyInvite(
  invite: MyStudentInvite,
  scope: TeachingScope,
  myProfileId: string | null | undefined,
): boolean {
  if (!scope.active) return true
  if (scope.loading) return false
  return (myProfileId != null && invite.invitedBy === myProfileId)
      || (invite.groupId != null && scope.groupIds.includes(invite.groupId))
}
