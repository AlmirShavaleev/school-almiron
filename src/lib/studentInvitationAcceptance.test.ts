import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const from = vi.fn()
const getUser = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    auth: { getUser: () => getUser() },
  },
}))

import {
  acceptCourseJoin,
  acceptStudentInvite,
  acceptStudentInviteByCode,
  ensureStudentProfile,
  InvitationAcceptanceError,
} from '@/lib/studentInvitationAcceptance'

/** Цепочка supabase-запросов к `profiles` для ensureStudentProfile. */
function mockProfilesTable(options: {
  /** последовательность ответов на `select(...).eq(...).maybeSingle()` */
  selects: Array<{ data: any; error?: any }>
  /** ответ на `insert(...).select().maybeSingle()` */
  insert?: { data: any; error?: any }
}) {
  const selects = [...options.selects]
  const insertCalls: any[] = []
  from.mockImplementation((table: string) => {
    if (table !== 'profiles') throw new Error(`unexpected table ${table}`)
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => selects.shift() ?? { data: null } }),
      }),
      insert: (row: any) => {
        insertCalls.push(row)
        return {
          select: () => ({ maybeSingle: async () => options.insert ?? { data: row, error: null } }),
        }
      },
    }
  })
  return insertCalls
}

describe('studentInvitationAcceptance result parsing', () => {
  beforeEach(() => rpc.mockReset())

  it('unwraps the TABLE-RPC array and returns real ids', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ invite_id: 'inv-1', student_id: 'stu-1', group_id: 'grp-1' }],
      error: null,
    })

    await expect(acceptStudentInvite('token-1')).resolves.toEqual({
      inviteId: 'inv-1',
      studentId: 'stu-1',
      groupId: 'grp-1',
    })
  })

  it('also accepts a single object row', async () => {
    rpc.mockResolvedValueOnce({
      data: { invite_id: 'inv-2', student_id: 'stu-2', group_id: 'grp-2' },
      error: null,
    })

    await expect(acceptStudentInviteByCode('CODE2')).resolves.toEqual({
      inviteId: 'inv-2',
      studentId: 'stu-2',
      groupId: 'grp-2',
    })
  })

  it('does not yield an empty groupId (regression: array was not unwrapped)', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ invite_id: 'inv-3', student_id: 'stu-3', group_id: 'grp-3' }],
      error: null,
    })

    const result = await acceptStudentInvite('token-3')
    expect(result.groupId).toBe('grp-3')
    expect(result.groupId).not.toBe('')
  })
})

describe('studentInvitationAcceptance error mapping', () => {
  beforeEach(() => rpc.mockReset())

  async function kindOf(error: any): Promise<InvitationAcceptanceError> {
    rpc.mockResolvedValueOnce({ data: null, error })
    const err = await acceptStudentInvite('some-token').catch((e) => e)
    expect(err).toBeInstanceOf(InvitationAcceptanceError)
    return err as InvitationAcceptanceError
  }

  it('maps INVITE_NOT_PENDING: accepted to "used"', async () => {
    const err = await kindOf({ message: 'INVITE_NOT_PENDING: accepted', code: 'P0001' })
    expect(err.kind).toBe('used')
    expect(err.message).toBe('Это приглашение уже использовано.')
  })

  it('maps INVITE_NOT_PENDING: revoked to "revoked"', async () => {
    const err = await kindOf({ message: 'INVITE_NOT_PENDING: revoked', code: 'P0001' })
    expect(err.kind).toBe('revoked')
    expect(err.message).toBe('Приглашение было отозвано. Обратитесь к преподавателю за новой ссылкой.')
  })

  it('maps an unrecognized INVITE_NOT_PENDING status to the generic "unknown" error', async () => {
    const err = await kindOf({ message: 'INVITE_NOT_PENDING: some_future_status', code: 'P0001' })
    expect(err.kind).toBe('unknown')
    expect(err.message).toBe('Не удалось обработать приглашение')
  })

  // Ключевой кейс продового бага: постоянная ссылка/код курса не лежат в
  // enrollment_invites, поэтому легаси-RPC отвечает
  // `RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE='P0001'`. Склейка
  // 'p0001 invite_not_found' не содержала подстроки 'not found' (там underscore)
  // → kind='unknown' → JoinPage не пробовал course_join_accept. Теперь kind
  // должен быть 'invalid', и именно на нём JoinPage уходит в курсовой fallback.
  it('INVITE_NOT_FOUND → kind=invalid (underscore, а не пробел)', async () => {
    const err = await kindOf({ code: 'P0001', message: 'INVITE_NOT_FOUND' })
    expect(err.kind).toBe('invalid')
    expect(err.message).toBe('Ссылка или код приглашения недействительны.')
  })

  it('INVALID_CODE → kind=invalid', async () => {
    expect((await kindOf({ code: 'P0001', message: 'INVALID_CODE' })).kind).toBe('invalid')
  })

  it('by_code идёт через тот же маппер (курсовой код тоже доходит до fallback)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'INVITE_NOT_FOUND' } })
    await expect(acceptStudentInviteByCode('ABCD12')).rejects.toMatchObject({ kind: 'invalid' })
  })

  // Осмысленные отказы легаси НЕ должны превратиться в 'invalid'/'unknown':
  // на них JoinPage показывает человеку конкретную причину, а не курсовую ошибку.
  it.each([
    ['INVITE_EXPIRED', 'expired'],
    ['EMAIL_NOT_CONFIRMED', 'email_unconfirmed'],
    ['PROFILE_ROLE_NOT_STUDENT: teacher', 'wrong_role'],
    ['PROFILE_ROLE_NOT_STUDENT: curator', 'wrong_role'],
    ['GROUP_ALREADY_FULL: 10 / 10 мест', 'group_full'],
  ])('%s → kind=%s (осмысленный отказ, не курсовой fallback)', async (message, kind) => {
    expect((await kindOf({ code: 'P0001', message })).kind).toBe(kind)
  })

  it('сетевая ошибка → kind=network', async () => {
    expect((await kindOf({ message: 'TypeError: Failed to fetch' })).kind).toBe('network')
  })

  it('пустое сообщение → kind=unknown', async () => {
    expect((await kindOf({ code: 'P0001' })).kind).toBe('unknown')
  })
})

describe('ensureStudentProfile', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    getUser.mockReset()
  })

  it('создаёт профиль student, если его нет (RLS: id=auth.uid(), role=student)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'stud@example.com', user_metadata: {} } } })
    const inserts = mockProfilesTable({ selects: [{ data: null }] })

    const profile = await ensureStudentProfile()

    expect(inserts).toEqual([{ id: 'u1', email: 'stud@example.com', full_name: 'stud', role: 'student' }])
    expect(profile).toMatchObject({ id: 'u1', role: 'student' })
  })

  it('берёт ФИО из метаданных регистрации, если оно есть', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'stud@example.com', user_metadata: { full_name: '  Иван Иванов  ' } } },
    })
    const inserts = mockProfilesTable({ selects: [{ data: null }] })

    await ensureStudentProfile()

    expect(inserts[0].full_name).toBe('Иван Иванов')
  })

  it('не падает при пустом ФИО и пустом email (full_name NOT NULL)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: {} } } })
    const inserts = mockProfilesTable({ selects: [{ data: null }] })

    await ensureStudentProfile()

    expect(inserts[0]).toMatchObject({ email: '', full_name: 'Ученик', role: 'student' })
  })

  it('существующий профиль не трогает (в т.ч. с ролью не student)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'c@example.com', user_metadata: {} } } })
    const inserts = mockProfilesTable({ selects: [{ data: { id: 'u1', role: 'curator' } }] })

    const profile = await ensureStudentProfile()

    expect(inserts).toEqual([])
    expect(profile).toMatchObject({ role: 'curator' })
  })

  it('гонка вставки (профиль создан параллельно) не роняет поток', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'c@example.com', user_metadata: {} } } })
    mockProfilesTable({
      selects: [{ data: null }, { data: { id: 'u1', role: 'student' } }],
      insert: { data: null, error: { code: '23505', message: 'duplicate key' } },
    })

    await expect(ensureStudentProfile()).resolves.toMatchObject({ id: 'u1' })
  })

  it('отказ вставки без профиля → понятная ошибка', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'c@example.com', user_metadata: {} } } })
    mockProfilesTable({
      selects: [{ data: null }, { data: null }],
      insert: { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } },
    })

    await expect(ensureStudentProfile()).rejects.toThrow(/Не удалось создать профиль/)
  })

  it('без сессии ничего не делает', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    await expect(ensureStudentProfile()).resolves.toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})

describe('acceptCourseJoin', () => {
  beforeEach(() => {
    rpc.mockReset()
    from.mockReset()
    getUser.mockReset()
  })

  it('создаёт профиль ДО вызова course_join_accept', async () => {
    const order: string[] = []
    getUser.mockImplementation(async () => {
      order.push('getUser')
      return { data: { user: { id: 'u1', email: 'stud@example.com', user_metadata: {} } } }
    })
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => { order.push('select'); return { data: null } } }) }),
      insert: (row: any) => ({
        select: () => ({ maybeSingle: async () => { order.push('insert'); return { data: row, error: null } } }),
      }),
    }))
    rpc.mockImplementation(async () => {
      order.push('rpc')
      return { data: [{ group_id: 'g1', course_id: 'c1', course_title: 'Физика', joined_as: 'student' }], error: null }
    })

    const result = await acceptCourseJoin('course-token')

    expect(order).toEqual(['getUser', 'select', 'insert', 'rpc'])
    expect(result).toEqual({ groupId: 'g1', courseId: 'c1', courseTitle: 'Физика', joinedAs: 'student' })
  })

  it('пробрасывает joined_as=curator', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'c@example.com', user_metadata: {} } } })
    mockProfilesTable({ selects: [{ data: { id: 'u1', role: 'student' } }] })
    rpc.mockResolvedValue({
      data: [{ group_id: null, course_id: 'c1', course_title: 'Физика', joined_as: 'curator' }],
      error: null,
    })

    await expect(acceptCourseJoin('curator-token')).resolves.toMatchObject({ joinedAs: 'curator', groupId: null })
  })

  it('сообщение RPC доходит до пользователя', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'c@example.com', user_metadata: {} } } })
    mockProfilesTable({ selects: [{ data: { id: 'u1', role: 'student' } }] })
    rpc.mockResolvedValue({ data: null, error: { message: 'Набор закрыт. Обратитесь к преподавателю.' } })

    await expect(acceptCourseJoin('course-token')).rejects.toThrow('Набор закрыт. Обратитесь к преподавателю.')
  })
})
