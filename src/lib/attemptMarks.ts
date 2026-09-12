/**
 * §156. «Очистить пометки» на работе — счёт и удаление всех пометок попытки:
 * находок ИИ по всем её задачам и наборов аннотаций всех проверяющих.
 *
 * Поштучного удаления находок ИИ не существует: клиенту на
 * `topic_homework_ai_findings` оставлен только `select`, а «удаление» в
 * интерфейсе разбора — правка регионов `annotation_sets` после переноса
 * черновика. Поэтому единственный путь в базу — RPC
 * `topic_homework_clear_marks`, и она же считает: `dryRun = true` (по
 * умолчанию) ничего не удаляет.
 */

import { supabase } from '@/lib/supabase'

export interface MarkCounts {
  aiFindings: number
  /** Рамки ВСЕХ проверяющих — преподавателя, куратора, владельца. */
  teacherRegions: number
}

export const EMPTY_MARK_COUNTS: MarkCounts = { aiFindings: 0, teacherRegions: 0 }

function rowToCounts(rows: unknown): MarkCounts {
  const row = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown> | null | undefined
  return {
    aiFindings: Number(row?.ai_findings ?? 0) || 0,
    teacherRegions: Number(row?.teacher_regions ?? 0) || 0,
  }
}

/** Сколько пометок на работе — без удаления. */
export async function countAttemptMarks(attemptId: string): Promise<MarkCounts> {
  const { data, error } = await supabase.rpc('topic_homework_clear_marks', {
    p_attempt_id: attemptId,
    p_dry_run: true,
  })
  if (error) throw new Error(error.message)
  return rowToCounts(data)
}

/** Удалить все пометки на работе. Необратимо — подтверждение обязано быть до вызова. */
export async function clearAttemptMarks(attemptId: string): Promise<MarkCounts> {
  const { data, error } = await supabase.rpc('topic_homework_clear_marks', {
    p_attempt_id: attemptId,
    p_dry_run: false,
  })
  if (error) throw new Error(error.message)
  return rowToCounts(data)
}

export function hasAnyMarks(counts: MarkCounts): boolean {
  return counts.aiFindings > 0 || counts.teacherRegions > 0
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/**
 * Текст подтверждения — с числами: человек должен понимать, что именно
 * исчезает. «Рамок проверяющих», а не «ваших»: наборы на работе могут
 * принадлежать разным людям, и куратор не должен стирать рамки преподавателя,
 * думая, что стирает свои.
 */
export function clearMarksPrompt(counts: MarkCounts): string {
  const parts: string[] = []
  if (counts.aiFindings > 0) {
    parts.push(`${counts.aiFindings} ${plural(counts.aiFindings, 'находку ИИ', 'находки ИИ', 'находок ИИ')}`)
  }
  if (counts.teacherRegions > 0) {
    parts.push(`${counts.teacherRegions} ${plural(counts.teacherRegions, 'рамку проверяющих', 'рамки проверяющих', 'рамок проверяющих')}`)
  }
  if (parts.length === 0) return 'На этой работе нет пометок.'
  return `Удалить ${parts.join(' и ')}? Это необратимо.`
}
