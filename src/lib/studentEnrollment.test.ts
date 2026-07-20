import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildInviteUrl,
  createStudentInvite,
  createStudentInviteBatch,
  inviteStudentFlow,
  reissueStudentInvite,
  reissueStudentInviteBatch,
} from '@/lib/studentEnrollment'

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

const completeInviteRow = {
  invite_id: 'invite-1',
  token: 'token value/1',
  short_code: 'CODE1',
  expires_at: '2026-08-01T12:00:00.000Z',
}

const createParams = {
  groupId: 'group-1',
  fullName: 'Иван Петров',
  email: null,
  phone: null,
  classGrade: null,
}

describe('studentEnrollment RPC parsing', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('parses create_student_invite when Supabase returns a one-row array', async () => {
    rpc.mockResolvedValueOnce({ data: [completeInviteRow], error: null })

    await expect(createStudentInvite(createParams)).resolves.toEqual({
      inviteId: 'invite-1',
      token: 'token value/1',
      shortCode: 'CODE1',
      expiresAt: '2026-08-01T12:00:00.000Z',
    })
  })

  it('parses create_student_invite when Supabase returns an object', async () => {
    rpc.mockResolvedValueOnce({ data: completeInviteRow, error: null })

    await expect(createStudentInvite(createParams)).resolves.toMatchObject({
      inviteId: 'invite-1',
      token: 'token value/1',
      shortCode: 'CODE1',
      expiresAt: '2026-08-01T12:00:00.000Z',
    })
  })

  it('rejects create_student_invite without token', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...completeInviteRow, token: null }], error: null })

    await expect(createStudentInvite(createParams)).rejects.toThrow(
      'Сервер создал приглашение, но вернул неполные данные. Перевыпустите приглашение',
    )
  })

  it('rejects create_student_invite without short_code', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...completeInviteRow, short_code: '' }], error: null })

    await expect(createStudentInvite(createParams)).rejects.toThrow(
      'Сервер создал приглашение, но вернул неполные данные. Перевыпустите приглашение',
    )
  })

  it('rejects create_student_invite without expires_at', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...completeInviteRow, expires_at: undefined }], error: null })

    await expect(createStudentInvite(createParams)).rejects.toThrow(
      'Сервер создал приглашение, но вернул неполные данные. Перевыпустите приглашение',
    )
  })

  it('rejects create_student_invite without invite_id', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...completeInviteRow, invite_id: null }], error: null })

    await expect(createStudentInvite(createParams)).rejects.toThrow(
      'Сервер создал приглашение, но вернул неполные данные. Перевыпустите приглашение',
    )
  })

  it('builds invite links only with a real encoded token', () => {
    expect(buildInviteUrl('token value/1')).toBe(`${window.location.origin}/join/token%20value%2F1`)
    expect(buildInviteUrl('')).toBe('')
    expect(buildInviteUrl(null)).not.toContain('/join/')
  })

  it('parses reissue_student_invite when Supabase returns a one-row array', async () => {
    rpc.mockResolvedValueOnce({ data: [completeInviteRow], error: null })

    await expect(reissueStudentInvite('invite-1')).resolves.toEqual({
      inviteId: 'invite-1',
      token: 'token value/1',
      shortCode: 'CODE1',
      expiresAt: '2026-08-01T12:00:00.000Z',
    })
  })

  it('keeps create_student_invite_batch jsonb envelope parsing intact', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        batch_id: 'batch-1',
        items: [
          {
            client_row_id: 'row-1',
            invite_id: 'invite-1',
            status: 'invite_created',
            token: 'token-1',
            short_code: 'CODE1',
            expires_at: '2026-08-01T12:00:00.000Z',
            error: null,
          },
        ],
      },
      error: null,
    })

    await expect(createStudentInviteBatch({
      groupId: 'group-1',
      rows: [{ clientRowId: 'row-1', fullName: 'Иван Петров' }],
    })).resolves.toEqual({
      batchId: 'batch-1',
      items: [
        {
          clientRowId: 'row-1',
          inviteId: 'invite-1',
          status: 'invite_created',
          token: 'token-1',
          shortCode: 'CODE1',
          expiresAt: '2026-08-01T12:00:00.000Z',
          error: null,
        },
      ],
    })
  })

  it('parses reissue_student_invite_batch when Supabase returns row arrays', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          client_row_id: 'row-1',
          invite_id: 'invite-1',
          status: 'invite_created',
          token: 'token-1',
          short_code: 'CODE1',
          expires_at: '2026-08-01T12:00:00.000Z',
          error: null,
        },
      ],
      error: null,
    })

    await expect(reissueStudentInviteBatch('batch-1')).resolves.toEqual([
      {
        clientRowId: 'row-1',
        inviteId: 'invite-1',
        status: 'invite_created',
        token: 'token-1',
        shortCode: 'CODE1',
        expiresAt: '2026-08-01T12:00:00.000Z',
        error: null,
      },
    ])
  })

  it('forwards the idempotency request_id to invite_student_flow', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        invite_id: 'invite-1', token: 'token-1', short_code: 'CODE1', expires_at: '2026-08-01T12:00:00.000Z',
        group_id: 'group-1', course_id: 'course-1', course_created: true, group_created: true, draft_course: true,
      },
      error: null,
    })

    const res = await inviteStudentFlow({
      fullName: 'Иван Петров', format: 'individual', subject: 'physics', examType: 'ege',
      requestId: 'req-abc',
    })

    expect(rpc).toHaveBeenCalledWith('invite_student_flow', expect.objectContaining({ p_request_id: 'req-abc' }))
    expect(res).toMatchObject({ courseId: 'course-1', draftCourse: true })
  })
})
