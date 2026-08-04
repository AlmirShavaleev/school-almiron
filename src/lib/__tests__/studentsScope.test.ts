import { describe, expect, it } from 'vitest'
import { isMyInvite, isMyJoinRequest, isMyStudent } from '@/lib/studentsScope'
import type { TeachingScope } from '@/hooks/useMyTeachingScope'
import type { MyStudent, MyStudentInvite } from '@/lib/studentEnrollment'
import type { MyJoinRequest } from '@/lib/teacherJoinRequests'

/**
 * Три вкладки раздела «Ученики» сужаются тремя РАЗНЫМИ правилами, потому что
 * три RPC отдают администратору всю школу по-разному. В §80 под гребень
 * попала только первая вкладка, и незамеченными остались ровно те две, у
 * которых правило другое. Проверяем сами правила из `lib/studentsScope`, а не
 * их копию: копия зеленела бы, даже если страница разъедется.
 */

const ME = 'owner-profile'
const MY_TEACHER = 'owner-teacher-row'

const adminMode: TeachingScope = { active: false, loading: false, teacherId: null, courseIds: [], groupIds: [] }
const teacherMode: TeachingScope = {
  active: true, loading: false,
  teacherId: MY_TEACHER, courseIds: ['c-mine'], groupIds: ['g-mine'],
}
const stillLoading: TeachingScope = { ...teacherMode, loading: true }

const student = (groups: string[], courses: string[]): MyStudent => ({
  studentId: 's', profileId: 'p', fullName: 'Ученик', classGrade: '11',
  groups: groups.map(id => ({ id, name: id })),
  courses: courses.map(id => ({ id, title: id })),
  relationStatus: null, addedAt: null,
})

const request = (teacherId: string | null): MyJoinRequest => ({
  id: 'r', studentId: 's', teacherId, fullName: 'Ученик', email: null,
  status: 'pending', createdAt: '', reviewedAt: null,
})

const invite = (invitedBy: string | null, groupId: string | null): MyStudentInvite => ({
  inviteId: 'i', invitedBy, groupId, groupName: null, batchId: null,
  fullName: 'Ученик', classGrade: null, email: null, phone: null,
  status: 'pending', createdAt: null, expiresAt: null,
})

describe('Сужение раздела «Ученики» по режиму', () => {
  it('в режиме админа видно всё на всех трёх вкладках', () => {
    expect(isMyStudent(student(['g-alien'], ['c-alien']), adminMode)).toBe(true)
    expect(isMyJoinRequest(request('someone-else'), adminMode)).toBe(true)
    expect(isMyInvite(invite('someone-else', 'g-alien'), adminMode, ME)).toBe(true)
  })

  it('вкладка «Ученики»: свой по группе или по курсу, чужой отсеян', () => {
    expect(isMyStudent(student(['g-mine'], []), teacherMode)).toBe(true)
    expect(isMyStudent(student([], ['c-mine']), teacherMode)).toBe(true)
    expect(isMyStudent(student(['g-alien'], ['c-alien']), teacherMode)).toBe(false)
  })

  it('вкладка «Новые ученики»: заявка отбирается по адресату, а не по группе', () => {
    expect(isMyJoinRequest(request(MY_TEACHER), teacherMode)).toBe(true)
    expect(isMyJoinRequest(request('other-teacher'), teacherMode)).toBe(false)
    // Заявка приходит от ученика, которого ещё нет в группах, — правило
    // «по группе» здесь не работает в принципе.
    expect(isMyJoinRequest(request(null), teacherMode)).toBe(false)
  })

  it('вкладка «Приглашения»: своё авторство ИЛИ своя группа', () => {
    expect(isMyInvite(invite(ME, null), teacherMode, ME)).toBe(true)
    expect(isMyInvite(invite('other', 'g-mine'), teacherMode, ME)).toBe(true)
    expect(isMyInvite(invite('other', 'g-alien'), teacherMode, ME)).toBe(false)
    expect(isMyInvite(invite('other', null), teacherMode, ME)).toBe(false)
  })

  it('пока набор «что моё» не приехал, не показываем ничего', () => {
    expect(isMyStudent(student(['g-mine'], []), stillLoading)).toBe(false)
    expect(isMyJoinRequest(request(MY_TEACHER), stillLoading)).toBe(false)
    expect(isMyInvite(invite(ME, 'g-mine'), stillLoading, ME)).toBe(false)
  })
})
