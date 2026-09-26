import type { ReviewTaskVerdict } from './homeworkReviewTasks'
import { noteTaskKey } from './reviewNotes'

/**
 * §226. Как выглядит рамка-замечание на экране проверки.
 *
 * Макет v2: рамка подписана номером задания — тем же, что в списке справа, —
 * и окрашена ВЕРДИКТОМ этого задания, а не типом замечания. Глаз ищет на фото
 * «где неверное», и цвет обязан отвечать ровно на этот вопрос. «Не сверено»
 * (ИИ не уверен, ждёт человека) — пунктиром: форма, а не только цвет (принцип
 * брифа, печать чёрно-белая).
 *
 * Рамка без номера задания (старые, похвалы, нарисованные до §209) остаётся
 * как была — цветом типа: вердикта у неё нет, и выдумывать его нельзя.
 */

/** Цвета — значки `verdict.*` дизайн-системы (tailwind.config.js). */
export const VERDICT_FRAME_COLOR: Record<ReviewTaskVerdict, string> = {
  correct: '#33854a',
  wrong: '#b54b43',
  partial: '#a97416',
  unchecked: '#4075aa',
  unsolved: '#8a857c',
}

export interface FrameLook {
  color: string
  dashed: boolean
  label: string
  verdict: ReviewTaskVerdict
}

/** Длина подписи над рамкой: дальше — многоточие, полный текст в списке. */
export const FRAME_LABEL_MAX = 28

/** «3 · не отобран −7π/6» — номер и начало текста замечания. */
export function frameLabel(task: string, text: string | null | undefined, max = FRAME_LABEL_MAX): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return task
  const short = clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean
  return `${task} · ${short}`
}

/**
 * Вид рамки по вердикту её задания. `null` — рамку рисовать по-старому: у неё
 * нет задания или такого задания нет в таблице.
 */
export function frameLookOf(
  region: { task?: string | null; text?: string | null },
  verdicts: Readonly<Record<string, ReviewTaskVerdict>> | null | undefined,
): FrameLook | null {
  if (!verdicts) return null
  const key = noteTaskKey(region.task)
  if (!key) return null
  const verdict = verdicts[key]
  if (!verdict) return null
  return {
    color: VERDICT_FRAME_COLOR[verdict],
    dashed: verdict === 'unchecked',
    label: frameLabel(String(region.task).trim(), region.text),
    verdict,
  }
}

/** Таблица «номер задания → вердикт» в том ключе, по которому ищет `frameLookOf`. */
export function verdictsByTask(
  rows: readonly { no: string; verdict: ReviewTaskVerdict }[],
): Record<string, ReviewTaskVerdict> {
  const out: Record<string, ReviewTaskVerdict> = {}
  for (const row of rows) {
    const key = noteTaskKey(row.no)
    if (key) out[key] = row.verdict
  }
  return out
}
