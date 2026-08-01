/**
 * Черновик ИИ-проверки ДЗ — типы и чистые помощники.
 *
 * Главное, что здесь стоит держать в голове: это ПРЕДЛОЖЕНИЕ. Ни балл, ни
 * текст, ни рамки не видны ученику, пока преподаватель их не принял. Вердикт
 * по-прежнему ставит человек через topic_homework_review_attempt, а ИИ пишет
 * в свои таблицы (миграция 20260730225053).
 */

export type AiJobStatus = 'pending' | 'processing' | 'done' | 'failed'
export type AiConfidence = 'high' | 'medium' | 'low'
export type AiFindingCategory = 'comment' | 'calc' | 'logic' | 'format' | 'praise'

export interface AiJobRow {
  id: string
  attempt_id: string
  status: AiJobStatus
  provider: string | null
  model: string | null
  readable: boolean | null
  suggested_score: number | null
  confidence: AiConfidence | null
  summary: string | null
  last_error: string | null
  accepted_at: string | null
  created_at: string
  completed_at: string | null
}

export interface AiFindingRow {
  id: string
  job_id: string
  file_id: string
  page: number
  rect_x: number
  rect_y: number
  rect_w: number
  rect_h: number
  category: AiFindingCategory
  text: string
  position: number
}

/** Насколько модель уверена — словами, а не ярлыком. */
export const CONFIDENCE_LABEL: Record<AiConfidence, string> = {
  high: 'высокая уверенность',
  medium: 'средняя уверенность',
  low: 'низкая уверенность',
}

/**
 * Стоит ли вообще показывать предложенный балл.
 *
 * При низкой уверенности или нечитаемой работе число рядом с надписью
 * «предлагает ИИ» слишком легко принять за оценку. Лучше показать разбор без
 * балла: тогда преподаватель поставит его сам, а не согласится с чужим.
 */
export function shouldShowScore(job: AiJobRow): boolean {
  return job.status === 'done'
    && job.readable !== false
    && job.suggested_score != null
    && job.confidence !== 'low'
}

/** Идёт ли прогон прямо сейчас — для блокировки кнопки и спиннера. */
export function isRunning(job: AiJobRow | null): boolean {
  return job != null && (job.status === 'pending' || job.status === 'processing')
}

/**
 * Превращает находки в рамки для аннотатора.
 *
 * Находка ссылается на файл по id, а аннотатор адресует страницы по
 * storage_path — отсюда карта. Находки на файлы, которых в разборе нет
 * (например, файл удалили после проверки), выбрасываются: рамку некуда класть.
 */
export function findingsToRegions(
  findings: AiFindingRow[],
  filePathById: Record<string, string>,
): Array<{
  filePath: string
  page: number
  rect: { x: number; y: number; w: number; h: number }
  category: AiFindingCategory
  text: string
}> {
  const out = []
  for (const f of findings) {
    const filePath = filePathById[f.file_id]
    if (!filePath) continue
    out.push({
      filePath,
      page: f.page,
      rect: { x: f.rect_x, y: f.rect_y, w: f.rect_w, h: f.rect_h },
      category: f.category,
      text: f.text,
    })
  }
  return out
}

/**
 * Человеческое объяснение отказа.
 *
 * Технические тексты («503», «GEMINI_API_KEY») преподавателю ничего не
 * говорят, а вот «не настроено» — говорит, и он поймёт, к кому идти.
 */
export function aiErrorMessage(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim()
  if (!text) return 'ИИ-проверка не удалась'
  if (text.includes('AI_API_KEY') || text.includes('GEMINI_API_KEY') || text.includes('не настроена')) {
    return 'ИИ-проверка ещё не подключена — нужен ключ модели в настройках проекта'
  }
  if (text.includes('нет файлов') || text.includes('нет фотографий') || text.includes('слишком большие')) return text
  if (/\b(429|quota|RESOURCE_EXHAUSTED)\b/i.test(text)) {
    return 'Лимит запросов к модели исчерпан — попробуйте позже'
  }
  if (/\b(401|403|API key)\b/i.test(text)) {
    return 'Ключ модели отклонён — проверьте настройки проекта'
  }
  return text.length > 300 ? text.slice(0, 300) + '…' : text
}
