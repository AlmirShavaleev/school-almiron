/**
 * §222b. Предложения ИИ по второй части пробника — чистая логика экрана:
 * состояние проверки словами, «Принять все» (не трогает поставленные баллы),
 * рамки на фото выбранного номера, прогресс «проверено N из M» во вкладке
 * «Работы». Данные — `mock_exam_ai_suggestions` / `mock_exam_ai_runs`
 * (20261007171207_mock_exam_ai_222b.sql), пишет их edge-функция check-mock-exam-ai.
 *
 * ИИ балл не ставит: «Принять» кладёт число в клетку как ручной ввод, а в
 * базу оно уходит обычным «Сохранить» (save_mock_exam_grid).
 */

export type AiConfidence = 'high' | 'medium' | 'low'

/** Рамка на фото: доли страницы 0..1 от левого верхнего угла; page — страница PDF (у фото 1). */
export interface AiRegion {
  photo_id: string
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface AiSuggestion {
  student_id: string
  task_number: number
  points: number
  max_points: number
  confidence: AiConfidence
  comment: string | null
  regions: AiRegion[]
  created_at?: string | null
}

export type AiRunStatus = 'queued' | 'running' | 'done' | 'error'

export interface AiRun {
  student_id: string
  status: AiRunStatus
  last_error: string | null
  note: string | null
  requested_at: string | null
  started_at: string | null
  finished_at: string | null
}

/** Дольше — проверка мертва (тот же порог, что у сторожа в mock_exam_ai_request_check). */
export const AI_STALE_MS = 10 * 60_000

export type AiRunState = 'none' | 'queued' | 'running' | 'done' | 'error' | 'stale'

export function aiRunState(run: AiRun | null | undefined, nowMs: number): AiRunState {
  if (!run) return 'none'
  if (run.status === 'queued' || run.status === 'running') {
    const since = Date.parse(run.started_at ?? run.requested_at ?? '')
    if (Number.isFinite(since) && nowMs - since > AI_STALE_MS) return 'stale'
    return run.status
  }
  return run.status
}

export const isAiActive = (s: AiRunState) => s === 'queued' || s === 'running'

export const AI_CONFIDENCE_LABEL: Record<AiConfidence, string> = {
  high: 'уверенно',
  medium: 'есть сомнения',
  low: 'не уверен — проверьте',
}

/** «ИИ: 2 из 3». */
export function aiPointsLine(s: Pick<AiSuggestion, 'points' | 'max_points'>, max: number): string {
  return `ИИ: ${s.points} из ${max}`
}

/**
 * Можно ли принять предложение в клетку: целое, не больше нынешнего максимума
 * номера (шаблон могли поправить после проверки — тогда база всё равно
 * отказала бы при сохранении, лучше не давать поставить).
 */
export function aiUsable(s: AiSuggestion | null | undefined, max: number): s is AiSuggestion {
  return !!s && Number.isInteger(s.points) && s.points >= 0 && s.points <= max
}

/** Предложения одного ученика по номеру. */
export function suggestionsByTask(list: readonly AiSuggestion[], studentId: string): Map<number, AiSuggestion> {
  const out = new Map<number, AiSuggestion>()
  for (const s of list) if (s.student_id === studentId) out.set(s.task_number, s)
  return out
}

/**
 * «Принять все предложения ИИ»: только номера второй части, где клетка ПУСТАЯ
 * и предложение годно. Уже поставленный балл (вручную, по ключу, принятый
 * раньше) не трогаем никогда — даже ноль.
 */
export function acceptAllAi(
  points: readonly (number | null)[],
  byTask: ReadonlyMap<number, AiSuggestion>,
  part1Last: number,
  maxPoints: readonly number[],
): { points: (number | null)[]; accepted: number[] } {
  const next = points.slice()
  const accepted: number[] = []
  for (let i = part1Last; i < maxPoints.length; i += 1) {
    if (next[i] != null) continue
    const s = byTask.get(i + 1)
    if (!aiUsable(s, maxPoints[i])) continue
    next[i] = s.points
    accepted.push(i + 1)
  }
  return { points: next, accepted }
}

/** Сколько номеров «Принять все» заполнит сейчас. */
export function acceptAllCount(
  points: readonly (number | null)[],
  byTask: ReadonlyMap<number, AiSuggestion>,
  part1Last: number,
  maxPoints: readonly number[],
): number {
  return acceptAllAi(points, byTask, part1Last, maxPoints).accepted.length
}

/**
 * Рамки выбранного номера на текущем листе. page null — лист ещё не разложен
 * на страницы (PDF грузится или это фото): у фото рамка всегда page 1.
 */
export function regionsOnSheet(s: AiSuggestion | null | undefined, photoId: string, page: number | null): AiRegion[] {
  if (!s) return []
  return s.regions.filter(r => r.photo_id === photoId && (page == null ? r.page === 1 : r.page === page))
}

/** Первая рамка номера — к ней переключается фото при выборе номера. */
export function firstRegion(s: AiSuggestion | null | undefined): AiRegion | null {
  return s?.regions?.[0] ?? null
}

/** Состояние ИИ одной строкой для экрана проверки. */
export function aiStatusLine(state: AiRunState, run: AiRun | null | undefined, suggestions: number): { tone: 'muted' | 'busy' | 'ok' | 'error'; text: string } {
  switch (state) {
    case 'queued': return { tone: 'busy', text: 'ИИ: в очереди…' }
    case 'running': return { tone: 'busy', text: 'ИИ проверяет вторую часть… обычно до минуты' }
    case 'stale': return { tone: 'error', text: 'ИИ: проверка оборвалась — запустите ещё раз' }
    case 'error': return { tone: 'error', text: `ИИ: ошибка — ${run?.last_error || 'причина не записана'}` }
    case 'done': return { tone: 'ok', text: suggestions > 0 ? `ИИ предложил баллы: ${suggestions}` : 'ИИ проверил, но баллов не предложил — поставьте сами' }
    default: return suggestions > 0
      ? { tone: 'ok', text: `ИИ предложил баллы: ${suggestions}` }
      : { tone: 'muted', text: 'ИИ ещё не проверял эту работу' }
  }
}

/** Ученик для прогресса «Работ»: только id и число фото. */
export interface AiProgressStudent { id: string; photos: number }

export interface AiProgress {
  /** Учеников с фото второй части — их и можно проверить. */
  of: number
  /** Из них есть предложения или проверка закончилась. */
  checked: number
  active: number
  failed: number
  /** Кого проверит «у всех»: с фото, без предложений, проверка не идёт. */
  toCheck: string[]
}

export function aiProgress(
  students: readonly AiProgressStudent[],
  suggestions: readonly AiSuggestion[],
  runs: readonly AiRun[],
  nowMs: number,
): AiProgress {
  const withSug = new Set(suggestions.map(s => s.student_id))
  const runOf = new Map(runs.map(r => [r.student_id, r]))
  let checked = 0
  let active = 0
  let failed = 0
  const toCheck: string[] = []
  const withPhotos = students.filter(s => s.photos > 0)
  for (const s of withPhotos) {
    const st = aiRunState(runOf.get(s.id), nowMs)
    if (isAiActive(st)) active += 1
    else if (st === 'error' || st === 'stale') failed += 1
    if (withSug.has(s.id) || st === 'done') checked += 1
    else if (!isAiActive(st)) toCheck.push(s.id)
  }
  return { of: withPhotos.length, checked, active, failed, toCheck }
}
