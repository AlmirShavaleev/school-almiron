import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptStudentInvite, acceptStudentInviteByCode, InvitationAcceptanceError } from '@/lib/studentInvitationAcceptance'

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}))

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

  it('maps INVITE_NOT_PENDING: accepted to "used"', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'INVITE_NOT_PENDING: accepted', code: 'P0001' } })

    const err = await acceptStudentInvite('token-used').catch((e) => e)
    expect(err).toBeInstanceOf(InvitationAcceptanceError)
    expect(err.kind).toBe('used')
    expect(err.message).toBe('Это приглашение уже использовано.')
  })

  it('maps INVITE_NOT_PENDING: revoked to "revoked"', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'INVITE_NOT_PENDING: revoked', code: 'P0001' } })

    const err = await acceptStudentInvite('token-revoked').catch((e) => e)
    expect(err).toBeInstanceOf(InvitationAcceptanceError)
    expect(err.kind).toBe('revoked')
    expect(err.message).toBe('Приглашение было отозвано. Обратитесь к преподавателю за новой ссылкой.')
  })

  it('maps an unrecognized INVITE_NOT_PENDING status to the generic "unknown" error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'INVITE_NOT_PENDING: some_future_status', code: 'P0001' } })

    const err = await acceptStudentInvite('token-future-status').catch((e) => e)
    expect(err).toBeInstanceOf(InvitationAcceptanceError)
    expect(err.kind).toBe('unknown')
    expect(err.message).toBe('Не удалось обработать приглашение')
  })
})
