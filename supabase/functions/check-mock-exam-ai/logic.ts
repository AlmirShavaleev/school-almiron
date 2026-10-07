// §222b. Чистая часть ИИ-проверки второй части пробника: разбор тела запроса,
// номера второй части по шаблону, промпт, разбор и проверка ответа модели,
// рамки, пул на три ученика. Без Deno, сети и базы — его гоняет vitest
// (src/lib/__tests__/mockExamAiCheck.test.ts); сеть и база — в index.ts.
//
// Блоки эталона и критериев — те же, что у ИИ-проверки ДЗ (reference.ts):
// оговорки про распознавание PDF там уже выстраданы, второй копии не заводим.

import {
  CRITERIA_CHAR_LIMIT,
  REFERENCE_CHAR_LIMIT,
  criteriaPromptBlock,
  referencePromptBlock,
} from '../check-homework-ai/reference.ts'

/** Учеников одновременно в одном вызове функции — как у очереди ДЗ (useQueueAiJobs, 429 у поставщика). */
export const CONCURRENCY = 3
/** Учеников за один вызов. Больше — экран шлёт по одному (см. useMockExamAi). */
export const MAX_STUDENTS = 60
/**
 * Сколько ждём модель. В бою ДЗ предела нет, у замера §247 — 125 с; здесь
 * ставим тот же предел, что у замера: функция ведёт до трёх учеников сразу, и
 * один подвисший ответ не должен съесть весь потолок по стене (400 с).
 */
export const MODEL_TIMEOUT_MS = 125_000
/** Страниц работы на ученика — как MAX_PAGES в check-homework-ai. */
export const MAX_PAGES = 20
/** Байтов картинок на ученика в одном запросе — как MAX_INLINE_BYTES в check-homework-ai. */
export const MAX_INLINE_BYTES = 15 * 1024 * 1024
/**
 * Бюджет рендера PDF на ВЕСЬ вызов (2 с CPU на запрос, §48/§196). Ученики в
 * одном вызове делят его: фото с камеры рендера не требуют, PDF — редкость.
 */
export const RENDER_BUDGET_MS = 1500
/** Рамок на номер: больше одной-двух преподавателю не нужно, остальное — шум. */
export const MAX_REGIONS_PER_TASK = 4
export const COMMENT_LIMIT = 600

export type Confidence = 'high' | 'medium' | 'low'

export interface Part2Task {
  task: number
  max: number
}

/** Номера второй части: part1_last + 1 … конец шаблона, максимумы — из шаблона. */
export function part2Tasks(maxPoints: readonly number[], part1Last: number): Part2Task[] {
  const out: Part2Task[] = []
  for (let i = Math.max(0, part1Last); i < maxPoints.length; i += 1) {
    out.push({ task: i + 1, max: Math.max(0, Math.trunc(Number(maxPoints[i]) || 0)) })
  }
  return out
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export type CheckRequest =
  | { ok: true; mockExamId: string; studentIds: string[] | null }
  | { ok: false; error: string }

/** Тело `{ mock_exam_id, student_ids? }`. student_ids нет — «у всех» (решает база). */
export function parseCheckRequest(body: unknown): CheckRequest {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const id = typeof b.mock_exam_id === 'string' ? b.mock_exam_id.trim() : ''
  if (!isUuid(id)) return { ok: false, error: 'Не передан идентификатор пробника' }
  if (b.student_ids == null) return { ok: true, mockExamId: id, studentIds: null }
  if (!Array.isArray(b.student_ids)) return { ok: false, error: 'student_ids — список идентификаторов учеников' }
  const ids = [...new Set(b.student_ids.map(x => (typeof x === 'string' ? x.trim() : '')))]
  if (ids.some(x => !isUuid(x))) return { ok: false, error: 'В student_ids не идентификатор ученика' }
  if (ids.length === 0) return { ok: false, error: 'Список учеников пуст' }
  if (ids.length > MAX_STUDENTS) return { ok: false, error: `Не больше ${MAX_STUDENTS} учеников за один вызов` }
  return { ok: true, mockExamId: id, studentIds: ids }
}

/** Страница, ушедшая модели: фото (page 1) или страница PDF. */
export interface SentPage {
  photo_id: string
  page: number
  label: string
}

export interface Region {
  photo_id: string
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface SuggestionRow {
  task_number: number
  points: number
  max_points: number
  confidence: Confidence
  comment: string | null
  regions: Region[]
}

export interface PromptContext {
  examTitle: string
  /** Номер варианта ученика; null — у пробника нет строк вариантов. */
  variantPosition: number | null
  variantLabel: string | null
  variantCount: number
  tasks: Part2Task[]
  solutionText: string
  solutionTruncated: boolean
  criteriaText: string
  criteriaTruncated: boolean
  pageCount: number
}

export function variantName(position: number | null, label: string | null): string | null {
  if (position == null) return null
  const l = (label ?? '').trim()
  return l ? `вариант №${position} («${l}»)` : `вариант №${position}`
}

/**
 * Промпт. Важнее формулировок три вещи:
 *  — ВАРИАНТ назван явно: один PDF решений (и критериев) часто содержит все
 *    варианты подряд, и без номера модель сверит ученика с чужим вариантом;
 *  — номера второй части и их максимумы — из шаблона, перечислены поимённо:
 *    первую часть модель не трогает, балла больше максимума не ставит;
 *  — координаты рамок — доли страницы 0..1, как у ИИ-проверки ДЗ.
 */
export function buildPrompt(ctx: PromptContext): string {
  const variant = variantName(ctx.variantPosition, ctx.variantLabel)
  const list = ctx.tasks.map(t => `№${t.task} (максимум ${t.max})`).join(', ')
  const first = ctx.tasks[0]?.task ?? 0
  const last = ctx.tasks.at(-1)?.task ?? 0
  return [
    'Ты опытный эксперт ЕГЭ/ОГЭ. Проверяешь развёрнутые ответы ВТОРОЙ ЧАСТИ пробного экзамена по фотографиям рукописной работы ученика.',
    '',
    `ПРОБНИК: ${ctx.examTitle}`,
    variant
      ? `ВАРИАНТ УЧЕНИКА: ${variant}.`
      : 'Вариант у пробника один.',
    variant
      ? `ВАЖНО: файл решений и критериев может содержать НЕСКОЛЬКО вариантов подряд. Бери решения, ответы и критерии ТОЛЬКО для ${variant}${ctx.variantCount > 1 ? ` (всего вариантов: ${ctx.variantCount})` : ''}. Задания других вариантов не используй, даже если номера совпадают.`
      : '',
    `ПРОВЕРЯЙ ТОЛЬКО номера ${first}–${last}: ${list}. Первую часть (ответы в бланк) не проверяй — её проверил ключ.`,
    '',
    ctx.solutionText
      ? referencePromptBlock({ text: ctx.solutionText, truncated: ctx.solutionTruncated })
      : 'АВТОРСКОГО РЕШЕНИЯ НЕТ: сверять не с чем, оценивай по существу и не завышай уверенность.',
    '',
    criteriaPromptBlock({ text: ctx.criteriaText, truncated: ctx.criteriaTruncated }),
    ctx.criteriaText ? '' : 'КРИТЕРИЕВ НЕТ: ставь баллы по общепринятым критериям ЕГЭ/ОГЭ для этого номера и не завышай уверенность.',
    '',
    'ПОРЯДОК РАБОТЫ:',
    '1. По каждому номеру найди решение ученика на страницах. Номер обычно подписан («13», «№13», «Задание 13»).',
    '2. Сначала реши сам, потом сверь с решением ученика и с эталоном. Если твой ответ расходится с эталоном — прав эталон.',
    '3. Балл ставь по критериям: сколько баллов за какой шаг. Частичный балл — когда критерий это допускает.',
    '',
    `Тебе передано страниц: ${ctx.pageCount}. Перед каждой идёт строка «Страница #N: имя».`,
    '',
    'ОТВЕТЬ СТРОГО ОДНИМ JSON-объектом, без пояснений и без markdown:',
    '{',
    '  "tasks": [',
    `    {"task": ${first || 13}, "points": 1, "confidence": "medium", "comment": "Верно найдены корни, но отбор на отрезке не выполнен", "regions": [{"page_index": 1, "x": 0.08, "y": 0.42, "w": 0.6, "h": 0.12}]},`,
    `    {"task": ${last || 14}, "points": null, "confidence": "low", "comment": "Решения этого номера на фото нет", "regions": []}`,
    '  ]',
    '}',
    '',
    'ПРАВИЛА:',
    '- По одной строке на КАЖДЫЙ номер из списка выше, других номеров не пиши.',
    '- points — целое число от 0 до максимума номера. Не решал / решения на фото нет — points 0 и комментарий «решения нет». Не можешь прочитать или проверить — points null.',
    '- confidence: "high" — читается уверенно и балл однозначен; "medium" — есть сомнения; "low" — почерк плохо разбирается или спорный случай.',
    '- comment — по-русски, одно-два коротких предложения для учителя: что не так и за что снижен балл. За полный балл — «Верно» или пусто.',
    '- regions — рамки на месте ошибки или на решении этого номера. page_index — номер страницы из строки «Страница #N», начиная с 1.',
    '- КООРДИНАТЫ — ДОЛИ СТРАНИЦЫ ОТ 0 ДО 1, начало отсчёта в левом верхнем углу. Не пиксели. x + w не больше 1, y + h не больше 1.',
    `- Не больше ${MAX_REGIONS_PER_TASK} рамок на номер. Рамка плотно охватывает нужные строки, а не всю страницу.`,
    '- В спорном случае решай в пользу ученика и понижай confidence: твой балл — предложение, балл ставит учитель.',
  ].filter(s => s !== '').join('\n')
}

// ── Ответ модели ────────────────────────────────────────────────────────────

/** Текст ответа OpenAI-совместимого API (то же правило, что в check-homework-ai/index.ts). */
interface ChatPayload {
  choices?: { message?: { content?: unknown } }[]
  candidates?: { content?: { parts?: { text?: unknown }[] } }[]
  text?: unknown
}

export function extractText(payload: unknown): string {
  const p = (payload && typeof payload === 'object' ? payload : null) as ChatPayload | null
  const content = p?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (Array.isArray(content)) {
    const joined = content.map((x: { text?: unknown } | null) => (typeof x?.text === 'string' ? x.text : '')).join('').trim()
    if (joined) return joined
  }
  const alt = p?.candidates?.[0]?.content?.parts?.[0]?.text ?? p?.text
  return typeof alt === 'string' ? alt.trim() : ''
}

/** Модель иногда оборачивает JSON в ```json — вытаскиваем объект по скобкам. */
export function parseJson(text: string): Record<string, unknown> | null {
  const tryParse = (t: string) => {
    try {
      const v = JSON.parse(t)
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const direct = tryParse(text)
  if (direct) return direct
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return tryParse(text.slice(start, end + 1))
}

function clamp01(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

/** Рамка модели → рамка на фото. Кривая (вне страницы, нулевая, без страницы) — null. */
export function normalizeRegion(raw: unknown, pages: readonly SentPage[]): Region | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rect = (r.rect && typeof r.rect === 'object' ? r.rect : r) as Record<string, unknown>
  const index = Number(r.page_index ?? r.page)
  if (!Number.isInteger(index)) return null
  const target = pages[index - 1]
  if (!target) return null
  const x = clamp01(rect.x)
  const y = clamp01(rect.y)
  let w = clamp01(rect.w)
  let h = clamp01(rect.h)
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null
  w = Math.min(w, 1 - x)
  h = Math.min(h, 1 - y)
  if (w <= 0 || h <= 0) return null
  const round = (v: number) => Math.round(v * 10000) / 10000
  return { photo_id: target.photo_id, page: target.page, x: round(x), y: round(y), w: round(w), h: round(h) }
}

export interface ParsedSuggestions {
  rows: SuggestionRow[]
  /** Номера, по которым модель балла не дала (null, нет строки) — предложения нет. */
  missing: number[]
  /** Строки, выброшенные проверкой, с причиной — в лог и в приписку. */
  dropped: string[]
}

const CONFIDENCE: readonly Confidence[] = ['high', 'medium', 'low']

/**
 * Ответ модели → строки предложений. Правила:
 *  — номер не из второй части → выброшен; повтор номера → берём первый;
 *  — points не целое в [0, максимум] → выброшен (балл больше максимума или
 *    «1,5» молча округлять нельзя — это уже не предложение модели);
 *  — points null / номера нет → предложения нет (missing), строку не пишем;
 *  — confidence не из трёх → 'low'; комментарий — обрезан; рамки — по
 *    одной, кривые выброшены, не больше MAX_REGIONS_PER_TASK.
 */
export function parseSuggestions(parsed: unknown, tasks: readonly Part2Task[], pages: readonly SentPage[]): ParsedSuggestions {
  const p = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const raw = Array.isArray(p.tasks) ? p.tasks : Array.isArray(p.suggestions) ? p.suggestions : []
  const maxOf = new Map(tasks.map(t => [t.task, t.max]))
  const rows: SuggestionRow[] = []
  const seen = new Set<number>()
  const dropped: string[] = []

  for (const item of raw) {
    if (!item || typeof item !== 'object') { dropped.push('строка не объект'); continue }
    const r = item as Record<string, unknown>
    const task = Number(String(r.task ?? r.no ?? r.task_number ?? '').replace(/^№\s*/, ''))
    if (!Number.isInteger(task) || !maxOf.has(task)) { dropped.push(`№${String(r.task ?? r.no ?? '?')} — не номер второй части`); continue }
    if (seen.has(task)) { dropped.push(`№${task} — повтор`); continue }
    seen.add(task)
    if (r.points === null || r.points === undefined || r.points === '') continue
    const points = typeof r.points === 'number' ? r.points : Number(String(r.points).replace(',', '.'))
    const max = maxOf.get(task)!
    if (!Number.isInteger(points)) { dropped.push(`№${task} — балл «${String(r.points)}» не целый`); continue }
    if (points < 0 || points > max) { dropped.push(`№${task} — балл ${points} вне 0…${max}`); continue }
    const confidence = CONFIDENCE.includes(r.confidence as Confidence) ? r.confidence as Confidence : 'low'
    const comment = typeof r.comment === 'string' ? r.comment.trim().replace(/\s+/g, ' ').slice(0, COMMENT_LIMIT) : ''
    const regions: Region[] = []
    for (const reg of Array.isArray(r.regions) ? r.regions : []) {
      if (regions.length >= MAX_REGIONS_PER_TASK) break
      const n = normalizeRegion(reg, pages)
      if (n) regions.push(n)
    }
    rows.push({ task_number: task, points, max_points: max, confidence, comment: comment || null, regions })
  }

  const got = new Set(rows.map(r => r.task_number))
  const missing = tasks.map(t => t.task).filter(t => !got.has(t))
  rows.sort((a, b) => a.task_number - b.task_number)
  return { rows, missing, dropped }
}

/** Приписка к удачному прогону: чему преподаватель верит и чего не хватило. */
export function runNote(o: {
  solution: 'used' | 'missing' | 'failed'
  criteria: 'used' | 'missing' | 'failed'
  solutionError?: string | null
  criteriaError?: string | null
  skipped: readonly string[]
  missing: readonly number[]
  dropped: readonly string[]
}): string | null {
  const parts: string[] = []
  if (o.solution === 'missing') parts.push('Проверено без решения: у варианта нет PDF решений.')
  if (o.solution === 'failed') parts.push(`Проверено без решения: ${o.solutionError ?? 'PDF решений не удалось прочитать'}.`)
  if (o.criteria === 'failed') parts.push(`Без критериев: ${o.criteriaError ?? 'PDF критериев не удалось прочитать'}.`)
  if (o.skipped.length) parts.push(`Не всё фото дошло до модели: ${o.skipped.join('; ')}.`)
  if (o.missing.length) parts.push(`Без предложения: ${o.missing.map(n => `№${n}`).join(', ')} — поставьте сами.`)
  if (o.dropped.length) parts.push(`Отброшено строк ответа модели: ${o.dropped.length} (${o.dropped.slice(0, 3).join('; ')}).`)
  const text = parts.join(' ')
  return text ? text.slice(0, 2000) : null
}

/** Не больше `limit` задач одновременно; порядок результатов — порядок входа. */
export async function runPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next
      next += 1
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

export const SOLUTION_LIMIT = REFERENCE_CHAR_LIMIT
export const CRITERIA_LIMIT = CRITERIA_CHAR_LIMIT
