import { describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

import {
  clearAttemptMarks, clearMarksPrompt, countAttemptMarks, hasAnyMarks,
} from '../attemptMarks'

/**
 * §156. Подтверждение обязано называть число, и число обязано быть честным:
 * «рамок проверяющих», а не «ваших» — на работе могут лежать рамки
 * преподавателя, куратора и владельца, кнопка стирает все.
 */
describe('clearMarksPrompt — число и склонение', () => {
  it('и находки, и рамки', () => {
    expect(clearMarksPrompt({ aiFindings: 8, teacherRegions: 3 }))
      .toBe('Удалить 8 находок ИИ и 3 рамки проверяющих? Это необратимо.')
  })

  it('единственное число', () => {
    expect(clearMarksPrompt({ aiFindings: 1, teacherRegions: 1 }))
      .toBe('Удалить 1 находку ИИ и 1 рамку проверяющих? Это необратимо.')
  })

  it('только один вид пометок — второй не упоминается', () => {
    expect(clearMarksPrompt({ aiFindings: 0, teacherRegions: 12 }))
      .toBe('Удалить 12 рамок проверяющих? Это необратимо.')
    expect(clearMarksPrompt({ aiFindings: 21, teacherRegions: 0 }))
      .toBe('Удалить 21 находку ИИ? Это необратимо.')
  })

  it('нечего удалять — говорит об этом, не предлагает удалить', () => {
    expect(clearMarksPrompt({ aiFindings: 0, teacherRegions: 0 })).toBe('На этой работе нет пометок.')
    expect(hasAnyMarks({ aiFindings: 0, teacherRegions: 0 })).toBe(false)
    expect(hasAnyMarks({ aiFindings: 0, teacherRegions: 1 })).toBe(true)
  })

  it('слово «ваших» в тексте не встречается', () => {
    expect(clearMarksPrompt({ aiFindings: 2, teacherRegions: 5 })).not.toMatch(/ваш/i)
  })
})

describe('вызовы RPC', () => {
  it('счёт — dry run, ничего не удаляет', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ai_findings: 4, teacher_regions: 2 }], error: null })
    const counts = await countAttemptMarks('a-1')
    expect(rpc).toHaveBeenCalledWith('topic_homework_clear_marks', { p_attempt_id: 'a-1', p_dry_run: true })
    expect(counts).toEqual({ aiFindings: 4, teacherRegions: 2 })
  })

  it('удаление — dry run выключен явно', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ai_findings: 4, teacher_regions: 2 }], error: null })
    await clearAttemptMarks('a-1')
    expect(rpc).toHaveBeenLastCalledWith('topic_homework_clear_marks', { p_attempt_id: 'a-1', p_dry_run: false })
  })

  it('отказ базы превращается в ошибку с её текстом', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Нет прав на проверку этой работы' } })
    await expect(countAttemptMarks('a-1')).rejects.toThrow('Нет прав на проверку этой работы')
  })
})
