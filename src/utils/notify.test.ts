import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      eq: vi.fn().mockReturnThis(),
    })),
  },
}))

import { supabase } from '@/lib/supabase'
import { notifyHomeworkChecked } from './notify'

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  ;(supabase.from as any).mockReturnValue({
    select: vi.fn().mockReturnThis(),
    insert: mockInsert,
    eq: vi.fn().mockReturnThis(),
  })
})

describe('notifyHomeworkChecked', () => {
  it('sends success notification when checked with score', async () => {
    await notifyHomeworkChecked('user-1', 'ДЗ по физике', 'checked', 85, 100)

    expect(mockInsert).toHaveBeenCalledWith([
      {
        user_id: 'user-1',
        title: '✅ ДЗ проверено',
        message: '«ДЗ по физике» — 85/100 б.',
        type: 'success',
      },
    ])
  })

  it('sends success notification when checked without score', async () => {
    await notifyHomeworkChecked('user-1', 'ДЗ по математике', 'checked')

    expect(mockInsert).toHaveBeenCalledWith([
      {
        user_id: 'user-1',
        title: '✅ ДЗ проверено',
        message: '«ДЗ по математике»',
        type: 'success',
      },
    ])
  })

  it('sends warning notification when revision', async () => {
    await notifyHomeworkChecked('user-1', 'ДЗ по физике', 'revision')

    expect(mockInsert).toHaveBeenCalledWith([
      {
        user_id: 'user-1',
        title: '🔄 ДЗ на доработку',
        message: '«ДЗ по физике» — учитель отправил на доработку',
        type: 'warning',
      },
    ])
  })

  it('handles score of 0', async () => {
    await notifyHomeworkChecked('user-1', 'ДЗ', 'checked', 0, 100)

    expect(mockInsert).toHaveBeenCalledWith([
      expect.objectContaining({ message: '«ДЗ» — 0/100 б.' }),
    ])
  })
})
