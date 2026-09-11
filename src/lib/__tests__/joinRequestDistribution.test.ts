import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * §150. Дефект 3: окно распределения показывало курсы-шаблоны, в которые
 * зачисление база гарантированно отклоняет (§136). getMyActiveCourses --
 * единственный источник этого списка -- обязан фильтровать is_template на
 * запросе, а не полагаться на кого-то выше по цепочке.
 *
 * Плюс §150 гейт: distributeStudentCourses теперь может вернуть отказ
 * "ученик уже закреплён за другим преподавателем" -- mapError обязан
 * переводить его в человеческий текст, а не отдавать as-is.
 */

const eqMock = vi.fn()
const orderMock = vi.fn()
const selectMock = vi.fn()
const fromMock = vi.fn()
const rpcMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}))

import { getMyActiveCourses, distributeStudentCourses, DistributionError } from '@/lib/joinRequestDistribution'

describe('getMyActiveCourses', () => {
  beforeEach(() => {
    fromMock.mockReset()
    eqMock.mockReset()
    orderMock.mockReset()
    selectMock.mockReset()

    // Builds a chainable eq(...).eq(...).eq(...).eq(...).order(...) mock and
    // records every eq() call so the test can assert is_template was filtered.
    const chain: any = {
      eq: (...args: unknown[]) => { eqMock(...args); return chain },
      order: (...args: unknown[]) => { orderMock(...args); return Promise.resolve({ data: [], error: null }) },
    }
    selectMock.mockReturnValue(chain)
    fromMock.mockReturnValue({ select: selectMock })
  })

  it('фильтрует курс по is_template, а не по названию', async () => {
    await getMyActiveCourses('teacher-1')

    expect(fromMock).toHaveBeenCalledWith('courses')
    expect(eqMock).toHaveBeenCalledWith('owner_id', 'teacher-1')
    expect(eqMock).toHaveBeenCalledWith('is_active', true)
    expect(eqMock).toHaveBeenCalledWith('is_draft', false)
    expect(eqMock).toHaveBeenCalledWith('is_template', false)
  })

  it('не трогает is_draft -- триггер зачисления не запрещает черновики', async () => {
    await getMyActiveCourses('teacher-1')
    // is_draft остаётся отдельным, самостоятельным фильтром -- ровно один
    // вызов eq('is_draft', false), не смешанный с is_template.
    const draftCalls = eqMock.mock.calls.filter(c => c[0] === 'is_draft')
    expect(draftCalls).toEqual([['is_draft', false]])
  })
})

describe('distributeStudentCourses -- перевод отказа гейта §150', () => {
  beforeEach(() => rpcMock.mockReset())

  it('ученик, закреплённый за другим преподавателем, получает человеческий текст', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Этот ученик уже закреплён за другим преподавателем.', hint: 'STUDENT_CLAIMED_BY_OTHER_TEACHER' },
    })

    await expect(distributeStudentCourses('student-1', [], 'req-1')).rejects.toMatchObject({
      message: 'Этот ученик уже закреплён за другим преподавателем',
    })
  })

  it('распознаёт отказ и без HINT, по тексту сообщения', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'Этот ученик уже закреплён за другим преподавателем.' },
    })

    const err = await distributeStudentCourses('student-1', [], 'req-1').catch(e => e)
    expect(err).toBeInstanceOf(DistributionError)
    expect(err.message).toBe('Этот ученик уже закреплён за другим преподавателем')
  })
})
