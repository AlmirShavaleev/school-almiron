import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpcMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ profile: { id: 'profile-1', role: 'teacher' } }),
}))

import { useVariantTopicSections } from '@/hooks/useVariantAutoBuild'

/**
 * Имена тем уникальны только внутри своего номера задания (§50): по физике ЕГЭ
 * «ЕГЭ прошлых лет» — это 22 РАЗНЫЕ темы в 22 номерах. Плоским списком форма
 * показывала их одинаковыми строками, выбрать было невозможно.
 */
const row = (
  topicId: string, topicTitle: string,
  sectionId: string, sectionTitle: string, sectionPosition: number, examNumber: number,
  level: string, available: number,
) => ({
  topic_id: topicId,
  topic_title: topicTitle,
  section_id: sectionId,
  section_title: sectionTitle,
  section_position: sectionPosition,
  exam_number: examNumber,
  level,
  available,
})

describe('useVariantTopicSections', () => {
  beforeEach(() => {
    rpcMock.mockReset()
  })

  it('groups same-named topics under their own exam numbers', async () => {
    rpcMock.mockResolvedValue({
      data: [
        row('t-2', 'ЕГЭ прошлых лет', 's-2', '№2 Динамика',   2, 2, 'medium', 7),
        row('t-1', 'ЕГЭ прошлых лет', 's-1', '№1 Кинематика', 1, 1, 'medium', 4),
        row('t-1', 'ЕГЭ прошлых лет', 's-1', '№1 Кинематика', 1, 1, 'hard',   2),
        row('t-3', 'Равноускоренное движение', 's-1', '№1 Кинематика', 1, 1, 'easy', 9),
      ],
      error: null,
    })

    const { result } = renderHook(() => useVariantTopicSections('Физика', 'ЕГЭ', null))

    await waitFor(() => expect(result.current.sections).toHaveLength(2))

    // Номера идут по позиции раздела, а не по порядку строк из базы.
    expect(result.current.sections.map(s => s.title)).toEqual([
      '№1 Кинематика',
      '№2 Динамика',
    ])

    const first = result.current.sections[0]
    expect(first.topics).toHaveLength(2)

    // Одноимённые темы разъехались по своим номерам и больше не сливаются.
    const inFirst  = first.topics.find(t => t.id === 't-1')
    const inSecond = result.current.sections[1].topics.find(t => t.id === 't-2')
    expect(inFirst?.title).toBe('ЕГЭ прошлых лет')
    expect(inSecond?.title).toBe('ЕГЭ прошлых лет')

    // Уровни одной темы складываются, задачи по уровням не смешиваются.
    expect(inFirst?.byLevel).toEqual({ medium: 4, hard: 2 })
    expect(inFirst?.total).toBe(6)
    expect(inSecond?.byLevel).toEqual({ medium: 7 })
  })

  it('sorts topics inside a number by how many tasks they have', async () => {
    rpcMock.mockResolvedValue({
      data: [
        row('t-small', 'Мало задач',  's-1', '№1 Кинематика', 1, 1, 'easy', 2),
        row('t-big',   'Много задач', 's-1', '№1 Кинематика', 1, 1, 'easy', 30),
      ],
      error: null,
    })

    const { result } = renderHook(() => useVariantTopicSections('Физика', 'ЕГЭ', null))

    await waitFor(() => expect(result.current.sections).toHaveLength(1))
    expect(result.current.sections[0].topics.map(t => t.title)).toEqual([
      'Много задач',
      'Мало задач',
    ])
  })

  it('surfaces the rpc error instead of showing an empty picker', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const { result } = renderHook(() => useVariantTopicSections('Физика', 'ЕГЭ', null))

    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.sections).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})
