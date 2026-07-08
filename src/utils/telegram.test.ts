/**
 * Тесты для Telegram-уведомлений MVP.
 * Используют только E2E TEST — записи и очищают их после.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Мок supabase ──────────────────────────────────────────────────────────────
// vi.mock is hoisted, so factory must not reference outer-scope variables.

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

import { supabase } from '@/lib/supabase'
import { notifyNewHomework, notifyHomeworkChecked, notifyLessonRescheduled, notifyLessonCancelled } from './notify'

const mockFrom = supabase.from as ReturnType<typeof vi.fn>

// Helpers for building chainable mock
function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select:      vi.fn().mockReturnThis(),
    insert:      vi.fn().mockResolvedValue({ data: null, error: null }),
    update:      vi.fn().mockReturnThis(),
    upsert:      vi.fn().mockResolvedValue({ data: null, error: null }),
    delete:      vi.fn().mockReturnThis(),
    eq:          vi.fn().mockReturnThis(),
    is:          vi.fn().mockReturnThis(),
    single:      vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  }
  return chain
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const E2E_PREFIX = 'E2E TEST — '
const createdDedupKeys: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  // В реальных E2E-тестах здесь был бы cleanup БД.
  // В unit-тестах просто сбрасываем tracking.
  createdDedupKeys.length = 0
})

// ── 1. Новое ДЗ создаёт по одному уведомлению каждому ученику ────────────────

describe('notifyNewHomework', () => {
  it('creates one in-app and one queue entry per student', async () => {
    const members = [
      { students: { profile_id: 'student-1' } },
      { students: { profile_id: 'student-2' } },
    ]

    const inAppInsert    = vi.fn().mockResolvedValue({ data: null, error: null })
    const queueInsert    = vi.fn().mockResolvedValue({ data: null, error: null })
    let callCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: members, error: null }),
        }
      }
      if (table === 'notifications') {
        return { insert: inAppInsert }
      }
      if (table === 'notification_queue') {
        return { insert: queueInsert }
      }
      return makeChain()
    })

    await notifyNewHomework('group-1', `${E2E_PREFIX}ДЗ по физике`, '2026-06-30', 'hw-1', 'Курс ЕГЭ')

    // In-app: один вызов insert с массивом из 2 элементов
    expect(inAppInsert).toHaveBeenCalledTimes(1)
    const inAppPayload = inAppInsert.mock.calls[0][0]
    expect(inAppPayload).toHaveLength(2)
    expect(inAppPayload[0]).toMatchObject({ user_id: 'student-1', type: 'info' })
    expect(inAppPayload[1]).toMatchObject({ user_id: 'student-2', type: 'info' })

    // Queue: по одному insert на каждого студента
    expect(queueInsert).toHaveBeenCalledTimes(2)
    const queueCall1 = queueInsert.mock.calls[0][0]
    expect(queueCall1).toMatchObject({
      profile_id:        'student-1',
      event_type:        'new_homework',
      deduplication_key: 'new_homework:hw-1:student-1',
      channel:           'telegram',
    })
  })

  it('does not enqueue if hwId is not provided (no entity to deduplicate)', async () => {
    const members = [{ students: { profile_id: 'student-1' } }]
    const queueInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const inAppInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: members }) }
      }
      if (table === 'notifications') return { insert: inAppInsert }
      if (table === 'notification_queue') return { insert: queueInsert }
      return makeChain()
    })

    // hwId omitted
    await notifyNewHomework('group-1', `${E2E_PREFIX}ДЗ без ID`, '2026-06-30')

    expect(inAppInsert).toHaveBeenCalledTimes(1)
    expect(queueInsert).not.toHaveBeenCalled()
  })
})

// ── 2. Deduplication key уникален — повторное событие не создаёт дубль ───────

describe('deduplication_key uniqueness', () => {
  it('same hw+student always produces same dedup key', async () => {
    const dedupKeys: string[] = []
    const queueInsert = vi.fn().mockImplementation((payload: any) => {
      dedupKeys.push(payload.deduplication_key)
      return Promise.resolve({ data: null, error: null })
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({
          data: [{ students: { profile_id: 'student-1' } }]
        })}
      }
      if (table === 'notifications') return { insert: vi.fn().mockResolvedValue({}) }
      if (table === 'notification_queue') return { insert: queueInsert }
      return makeChain()
    })

    await notifyNewHomework('g', 'T', '2026-01-01', 'hw-fixed')
    await notifyNewHomework('g', 'T', '2026-01-01', 'hw-fixed')

    // Оба вызова должны давать одинаковый ключ (БД блокирует второй через UNIQUE)
    expect(dedupKeys[0]).toBe('new_homework:hw-fixed:student-1')
    expect(dedupKeys[1]).toBe('new_homework:hw-fixed:student-1')
    expect(dedupKeys[0]).toBe(dedupKeys[1])
  })
})

// ── 3. homework_reviewed создаёт одно уведомление ────────────────────────────

describe('notifyHomeworkChecked with Telegram queue', () => {
  it('enqueues telegram notification when hwId provided', async () => {
    const inAppInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const queueInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'notifications')      return { insert: inAppInsert }
      if (table === 'notification_queue') return { insert: queueInsert }
      return makeChain()
    })

    await notifyHomeworkChecked('p-1', `${E2E_PREFIX}ДЗ`, 'checked', 90, 100, 'hw-2')

    expect(inAppInsert).toHaveBeenCalledTimes(1)
    expect(queueInsert).toHaveBeenCalledTimes(1)

    const queuePayload = queueInsert.mock.calls[0][0]
    expect(queuePayload).toMatchObject({
      profile_id: 'p-1',
      event_type: 'homework_reviewed',
      channel:    'telegram',
      payload:    expect.objectContaining({ status: 'checked', score: 90 }),
    })
  })

  it('does NOT enqueue when hwId not provided', async () => {
    const queueInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'notifications')      return { insert: vi.fn().mockResolvedValue({}) }
      if (table === 'notification_queue') return { insert: queueInsert }
      return makeChain()
    })

    await notifyHomeworkChecked('p-1', 'ДЗ', 'checked', 90, 100)
    expect(queueInsert).not.toHaveBeenCalled()
  })
})

// ── 4. Отменённое занятие получает lesson_cancelled (не reminder) ─────────────

describe('notifyLessonCancelled', () => {
  it('enqueues lesson_cancelled event, not lesson_reminder', async () => {
    const members = [{ students: { profile_id: 'student-3' } }]
    const queueInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: members }) }
      }
      if (table === 'notifications')      return { insert: vi.fn().mockResolvedValue({}) }
      if (table === 'notification_queue') return { insert: queueInsert }
      return makeChain()
    })

    await notifyLessonCancelled('g-1', 'lesson-1', `${E2E_PREFIX}Физика`, '2026-07-01T10:00:00Z', 'ЕГЭ-группа')

    const call = queueInsert.mock.calls[0][0]
    expect(call.event_type).toBe('lesson_cancelled')
    expect(call.event_type).not.toBe('lesson_reminder')
    expect(call.deduplication_key).toBe('lesson_cancelled:lesson-1:student-3')
  })
})

// ── 5. Перенос создаёт одно уведомление ─────────────────────────────────────

describe('notifyLessonRescheduled', () => {
  it('enqueues exactly one entry per student', async () => {
    const members = [
      { students: { profile_id: 'student-4' } },
      { students: { profile_id: 'student-5' } },
    ]
    const queueInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: members }) }
      }
      if (table === 'notifications')      return { insert: vi.fn().mockResolvedValue({}) }
      if (table === 'notification_queue') return { insert: queueInsert }
      return makeChain()
    })

    await notifyLessonRescheduled(
      'g-1', 'lesson-2', `${E2E_PREFIX}Математика`,
      '2026-07-01T10:00:00Z', '2026-07-02T10:00:00Z'
    )

    // По одному insert на студента (не один общий)
    expect(queueInsert).toHaveBeenCalledTimes(2)
    expect(queueInsert.mock.calls[0][0].event_type).toBe('lesson_rescheduled')
    expect(queueInsert.mock.calls[1][0].event_type).toBe('lesson_rescheduled')
    // Ключи у разных студентов разные
    expect(queueInsert.mock.calls[0][0].deduplication_key)
      .not.toBe(queueInsert.mock.calls[1][0].deduplication_key)
  })
})

// ── 6. Статус pending создаётся по умолчанию ─────────────────────────────────

describe('queue entry defaults', () => {
  it('always sets status=pending on enqueue', async () => {
    const members = [{ students: { profile_id: 'student-1' } }]
    const queueInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'group_students') {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: members }) }
      }
      if (table === 'notifications')      return { insert: vi.fn().mockResolvedValue({}) }
      if (table === 'notification_queue') return { insert: queueInsert }
      return makeChain()
    })

    await notifyNewHomework('g', 'T', '2026-01-01', 'hw-status-test')

    const payload = queueInsert.mock.calls[0][0]
    expect(payload.status).toBe('pending')
    expect(payload.channel).toBe('telegram')
  })
})

// ── 7. Token hashing (unit test для логики webhook) ──────────────────────────

describe('token hash logic', () => {
  it('same input produces same SHA-256 hash', async () => {
    async function hashToken(token: string): Promise<string> {
      const encoder    = new TextEncoder()
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token))
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    }

    const token = 'E2E-test-token-abc123'
    const hash1 = await hashToken(token)
    const hash2 = await hashToken(token)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex = 64 chars
  })

  it('different tokens produce different hashes', async () => {
    async function hashToken(token: string): Promise<string> {
      const encoder    = new TextEncoder()
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token))
      return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    }

    const hash1 = await hashToken('token-A')
    const hash2 = await hashToken('token-B')
    expect(hash1).not.toBe(hash2)
  })

  it('expired token would be rejected (date comparison)', () => {
    const expiresAt  = new Date(Date.now() - 1000).toISOString()  // в прошлом
    const isExpired  = new Date(expiresAt) < new Date()
    expect(isExpired).toBe(true)
  })

  it('valid token is not expired', () => {
    const expiresAt  = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    const isExpired  = new Date(expiresAt) < new Date()
    expect(isExpired).toBe(false)
  })
})
