import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dateTimeLocalToIso, toDateTimeLocalValue } from '@/utils/dateTimeLocal'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ profile: null }),
}))

import { updateAssignment } from '@/hooks/useVariantAssignments'

describe('variant assignment date helpers', () => {
  it('formats ISO values for datetime-local without UTC slicing', () => {
    const iso = new Date(2026, 6, 11, 19, 45).toISOString()

    expect(toDateTimeLocalValue(iso)).toBe('2026-07-11T19:45')
  })

  it('returns an ISO value from a datetime-local field', () => {
    expect(dateTimeLocalToIso('2026-07-11T19:45')).toBe(new Date(2026, 6, 11, 19, 45).toISOString())
  })

  it('treats empty datetime-local input as absent, not an invalid date', () => {
    expect(dateTimeLocalToIso('')).toBeNull()
    expect(toDateTimeLocalValue(null)).toBe('')
  })
})

describe('updateAssignment RPC payload', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
  })

  it('sends first-save dates and keeps clear flags false', async () => {
    await updateAssignment('assignment-1', {
      available_from: null,
      due_at: '2026-07-11T16:45:00.000Z',
    })

    expect(rpc).toHaveBeenCalledWith('update_variant_assignment', expect.objectContaining({
      p_assignment_id: 'assignment-1',
      p_available_from: null,
      p_due_at: '2026-07-11T16:45:00.000Z',
      p_clear_available_from: false,
      p_clear_due_at: false,
    }))
  })

  it('distinguishes explicit deadline clear from unchanged empty values', async () => {
    await updateAssignment('assignment-1', {
      due_at: null,
      clear_due_at: true,
    })

    expect(rpc).toHaveBeenCalledWith('update_variant_assignment', expect.objectContaining({
      p_due_at: null,
      p_clear_due_at: true,
    }))
  })
})
