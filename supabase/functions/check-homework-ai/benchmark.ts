/**
 * §247. Замер ИИ-проверки на других моделях — чистая часть.
 *
 * Чистый модуль без Deno-API и без сети — как `findings.ts` и `reference.ts`:
 * его гоняет vitest из `src/lib/__tests__/aiBenchmark.test.ts`. Сеть, база и
 * сам запуск — в `index.ts` (`handleBenchmark`).
 *
 * Зачем. Владелец хочет знать, станет ли проверка заметно точнее на другой
 * модели. Честный ответ даёт только прогон ТЕХ ЖЕ работ ТЕМ ЖЕ промптом через
 * несколько моделей и сверка с итоговым вердиктом учителя. Поэтому бенчмарк —
 * не вторая функция и не вторая копия промпта, а ветка того же `index.ts`:
 * эталон, условие, критерии, страницы, промпт, разбор ответа и фильтр
 * `findings.ts` у боевого пути и у замера общие. Отличаются только:
 *  — кто может звать (секрет `CRON_SECRET`, а не права преподавателя);
 *  — куда пишется результат (`ai_benchmark_results`, а не ai_jobs/findings —
 *    ни ученик, ни учитель замера не видят);
 *  — модель (из тела запроса, по белому списку) и, где без этого модель не
 *    отдаёт целый JSON, потолок `max_tokens`.
 *
 * Боевой путь берёт отсюда ровно одну вещь — `chatRequestBody`, и тест
 * фиксирует, что его тело запроса побайтно прежнее.
 */

import { compareAnswers, type TaskRow, type TaskVerdict } from './findings.ts'

/** Модель проверки по умолчанию (переменная `AI_MODEL` не задана). */
export const DEFAULT_AI_MODEL = 'qwen/qwen3-vl-235b-a22b-instruct'

/**
 * Потолок ответа боевого пути. §180: таблица по заданиям удлиняет ответ —
 * 20 строк это ещё ~1,5 тыс. токенов сверх находок; в выгрузке 15.09 выход
 * был до 1,7 тыс.
 */
export const COMBAT_MAX_TOKENS = 6000

/**
 * Белый список моделей замера. Любой другой id — 400: замер тратит деньги
 * владельца, и опечатка в имени модели не должна превращаться в счёт за
 * случайную модель (OpenRouter принимает сотни id).
 *
 * Текущая боевая модель (`AI_MODEL` проекта) допускается всегда — см.
 * `isBenchmarkModel`: сравнивать надо с тем, что реально стоит в бою.
 */
export const BENCHMARK_MODELS = [
  DEFAULT_AI_MODEL,
  'google/gemini-3.8-flash',
  'google/gemini-3.1-pro-preview',
  'anthropic/claude-sonnet-5.5',
] as const

/**
 * Потолок ответа для «думающих» моделей Google. У Gemini 3 рассуждение
 * включено по умолчанию, и его токены идут в completion_tokens — то есть в
 * тот же `max_tokens`. При боевых 6000 рассуждение на работе из 15–20 страниц
 * способно съесть бюджет, и JSON обрывается на середине (`finish_reason:
 * length`) — это не «модель ошиблась», а «модель не дали дописать». 6000 на
 * сам ответ плюс 10000 на рассуждение. Режим рассуждения НЕ трогаем
 * (`reasoning` не передаём): замеряется модель такой, какой она будет в бою.
 */
export const THINKING_MAX_TOKENS = 16000

/** Разумные рамки ручного потолка из тела запроса (`max_tokens`). */
export const MIN_BENCHMARK_MAX_TOKENS = 1000
export const MAX_BENCHMARK_MAX_TOKENS = 64000

/**
 * Сколько ждать модель в замере. Шлюз Supabase обрывает запрос, если функция
 * не ответила за 150 с (504), и тогда строка результата не запишется вовсе —
 * «ошибка без следа», которой замер должен избегать. Поэтому модель
 * обрываем сами раньше: остаток уходит на эталон, рендер и запись строки.
 */
export const BENCHMARK_MODEL_TIMEOUT_MS = 125_000

/** Столько символов причины кладём в `ai_benchmark_results.error`. */
export const BENCHMARK_ERROR_CHARS = 1000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RUN_ID_CHARS = 100

// ---------------------------------------------------------------------------
// Доступ
// ---------------------------------------------------------------------------

/**
 * Сравнение строк за постоянное время — как `safeEqual` в
 * process-notification-queue: по времени ответа нельзя подбирать секрет
 * символ за символом. Длина при этом не скрывается (как и там).
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

/**
 * Пропускать ли запрос замера. Секрет в проекте не задан — не пускаем никого
 * (fail-closed): иначе пустой заголовок совпал бы с пустым секретом.
 */
export function checkCronSecret(got: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return false
  return safeEqual(String(got ?? ''), expected)
}

/**
 * Это запрос замера? Клиент приложения шлёт только `{ attempt_id }`. Любое
 * присутствие поля `benchmark`, кроме `false`/`null`, уводит в ветку замера —
 * а там без секрета 401. Иначе `benchmark: "true"` (строкой) ушёл бы в боевой
 * путь, и при подходящем токене в `Authorization` родилась бы видимая
 * преподавателю задача ИИ.
 */
export function isBenchmarkRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const flag = (body as Record<string, unknown>).benchmark
  return flag !== undefined && flag !== null && flag !== false
}

// ---------------------------------------------------------------------------
// Запрос замера
// ---------------------------------------------------------------------------

export interface BenchmarkRequest {
  attemptId: string
  model: string
  runId: string
  /** Ручной потолок ответа; null — по профилю модели. */
  maxTokens: number | null
}

export type BenchmarkRequestResult =
  | { ok: true; value: BenchmarkRequest }
  | { ok: false; error: string }

/** Модель разрешена: из белого списка или та, что сейчас стоит в бою. */
export function isBenchmarkModel(model: string, currentModel?: string | null): boolean {
  if (!model) return false
  if ((BENCHMARK_MODELS as readonly string[]).includes(model)) return true
  return !!currentModel && model === currentModel
}

/**
 * Разбор тела `{ benchmark: true, attempt_id, model, run_id, max_tokens? }`.
 * Всё, что не так, — отказ с причиной по-русски (400), модель не зовём.
 */
export function parseBenchmarkRequest(body: unknown, currentModel?: string | null): BenchmarkRequestResult {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Тело запроса — не объект' }
  const b = body as Record<string, unknown>
  if (b.benchmark !== true) return { ok: false, error: 'Поле benchmark должно быть true' }

  const attemptId = typeof b.attempt_id === 'string' ? b.attempt_id.trim() : ''
  if (!UUID.test(attemptId)) return { ok: false, error: 'attempt_id — не uuid работы' }

  const runId = typeof b.run_id === 'string' ? b.run_id.trim() : ''
  if (!runId) return { ok: false, error: 'Не передан run_id замера' }
  if (runId.length > MAX_RUN_ID_CHARS) return { ok: false, error: `run_id длиннее ${MAX_RUN_ID_CHARS} символов` }

  const model = typeof b.model === 'string' ? b.model.trim() : ''
  if (!isBenchmarkModel(model, currentModel)) {
    const allowed = [...new Set([...BENCHMARK_MODELS, ...(currentModel ? [currentModel] : [])])]
    return { ok: false, error: `Модель не из списка замера: ${model || '(пусто)'}. Можно: ${allowed.join(', ')}` }
  }

  let maxTokens: number | null = null
  if (b.max_tokens !== undefined && b.max_tokens !== null) {
    const n = b.max_tokens
    if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_BENCHMARK_MAX_TOKENS || n > MAX_BENCHMARK_MAX_TOKENS) {
      return {
        ok: false,
        error: `max_tokens — целое от ${MIN_BENCHMARK_MAX_TOKENS} до ${MAX_BENCHMARK_MAX_TOKENS}`,
      }
    }
    maxTokens = n
  }

  return { ok: true, value: { attemptId: attemptId.toLowerCase(), model, runId, maxTokens } }
}

// ---------------------------------------------------------------------------
// Тело запроса к модели
// ---------------------------------------------------------------------------

/**
 * Тело запроса БОЕВОГО пути. Порядок ключей важен: `JSON.stringify` отдаёт
 * их в порядке вставки, и тест держит байты такими же, как до §247.
 */
export function chatRequestBody(model: string, messages: readonly unknown[]): Record<string, unknown> {
  return {
    model,
    messages,
    response_format: { type: 'json_object' },
    max_tokens: COMBAT_MAX_TOKENS,
  }
}

/** Потолок ответа модели в замере, если его не задали в теле запроса. */
export function benchmarkMaxTokens(model: string): number {
  return model.startsWith('google/') ? THINKING_MAX_TOKENS : COMBAT_MAX_TOKENS
}

/**
 * Тело запроса ЗАМЕРА: боевое плюс две вещи.
 *  — `max_tokens` по профилю модели (или из тела запроса): только для моделей,
 *    у которых рассуждение ест тот же бюджет (см. THINKING_MAX_TOKENS);
 *  — `usage: { include: true }` — просьба OpenRouter вернуть `usage.cost`.
 *    На генерацию не влияет, другие поставщики поле игнорируют.
 * Промпт, сообщения и `response_format` — те же, что в бою.
 */
export function benchmarkRequestBody(
  model: string,
  messages: readonly unknown[],
  opts: { maxTokens?: number | null } = {},
): Record<string, unknown> {
  return {
    ...chatRequestBody(model, messages),
    max_tokens: opts.maxTokens ?? benchmarkMaxTokens(model),
    usage: { include: true },
  }
}

// ---------------------------------------------------------------------------
// Ответ поставщика
// ---------------------------------------------------------------------------

export interface UsageInfo {
  inputTokens: number | null
  outputTokens: number | null
  /** Токены рассуждения (входят в outputTokens), если поставщик их назвал. */
  reasoningTokens: number | null
  /** Стоимость в долларах, если OpenRouter её отдал (`usage.cost`). */
  costUsd: number | null
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

function costOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Токены и стоимость из `usage` OpenAI-совместимого ответа. Нет — null, не ноль. */
export function parseUsage(payload: unknown): UsageInfo {
  const usage = (payload as Record<string, any> | null)?.usage
  if (!usage || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null, reasoningTokens: null, costUsd: null }
  }
  return {
    inputTokens: intOrNull(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: intOrNull(usage.completion_tokens ?? usage.output_tokens),
    reasoningTokens: intOrNull(usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens),
    costUsd: costOrNull(usage.cost),
  }
}

/** Почему модель закончила ответ: `stop`, `length` (упёрлась в max_tokens) и т. п. */
export function finishReasonOf(payload: unknown): string | null {
  const choice = (payload as Record<string, any> | null)?.choices?.[0]
  const reason = choice?.finish_reason ?? choice?.native_finish_reason
  return typeof reason === 'string' && reason ? reason : null
}

/** Какая модель на самом деле ответила (у `~…-latest` это конкретный id). */
export function servedModelOf(payload: unknown): string | null {
  const model = (payload as Record<string, any> | null)?.model
  return typeof model === 'string' && model ? model : null
}

/**
 * Причина провала замера — одной строкой. К тексту ошибки из общего пути
 * добавляется то, чего в бою не пишут, а для сравнения моделей оно решает:
 *  — ответ обрезан по `max_tokens` (сколько из них ушло на рассуждение);
 *  — поставщик вернул 200 с полем `error` (тогда «пустой ответ» — следствие);
 *  — модель не уложилась в BENCHMARK_MODEL_TIMEOUT_MS.
 */
export function describeBenchmarkError(err: unknown, payload?: unknown): string {
  const name = (err as { name?: unknown } | null)?.name
  const base = name === 'TimeoutError' || name === 'AbortError'
    ? `Модель не ответила за ${Math.round(BENCHMARK_MODEL_TIMEOUT_MS / 1000)} с`
    : err instanceof Error ? err.message : String(err)
  const parts: string[] = []
  if (finishReasonOf(payload) === 'length') {
    const { outputTokens, reasoningTokens } = parseUsage(payload)
    const spent = outputTokens !== null
      ? ` (выход ${outputTokens}${reasoningTokens !== null ? `, из них рассуждение ${reasoningTokens}` : ''})`
      : ''
    parts.push(`Ответ обрезан по max_tokens${spent}`)
  }
  const providerError = (payload as Record<string, any> | null)?.error?.message
  if (typeof providerError === 'string' && providerError && !base.includes(providerError)) {
    parts.push(`Поставщик: ${providerError}`)
  }
  return [...parts, base].join('. ').slice(0, BENCHMARK_ERROR_CHARS)
}

// ---------------------------------------------------------------------------
// Строка результата
// ---------------------------------------------------------------------------

/** Строка таблицы ИИ в результате замера: как в бою плюс вердикт «после заполнения». */
export interface BenchmarkTaskRow extends TaskRow {
  /**
   * Во что строка превратится в таблице преподавателя при заполнении из ИИ
   * (§238, `seededVerdict` в src/lib/reviewTriage.ts): «частично» при
   * совпавшем ответе ложится «верно». Отчёт считает совпадения и по сырому
   * вердикту модели (`verdict`), и по этому — так видно, сколько ошибок модели
   * гасит правило заполнения. Тест сверяет с `seededVerdict` на примерах.
   */
  seeded_verdict: TaskVerdict
}

export function seededTaskVerdict(task: Pick<TaskRow, 'verdict' | 'student_answer' | 'expected_answer'>): TaskVerdict {
  if (task.verdict === 'partial'
    && compareAnswers(task.student_answer ?? '', task.expected_answer ?? '') === 'equal') {
    return 'correct'
  }
  return task.verdict
}

export function benchmarkTasks(tasks: readonly TaskRow[]): BenchmarkTaskRow[] {
  return tasks.map(t => ({ ...t, seeded_verdict: seededTaskVerdict(t) }))
}

/** Итог прогона одной работы одной моделью — то, что знает `index.ts`. */
export interface BenchmarkOutcome {
  /** Таблица по заданиям ПОСЛЕ фильтра `findings.ts` (как `tasks` в бою); null — провал. */
  tasks: readonly TaskRow[] | null
  suggestedScore: number | null
  readable: boolean | null
  /** Причина провала; null — прогон удался. */
  error: string | null
  /** Сырой ответ поставщика, если до него дошло (токены и стоимость — отсюда). */
  payload: unknown
  /** Время запроса к модели, мс; null — до модели не дошло. */
  latencyMs: number | null
  /** Диагностика: страницы, эталон, потолок ответа… — в столбец meta. */
  meta?: Record<string, unknown>
}

export interface BenchmarkResultRow {
  run_id: string
  attempt_id: string
  model: string
  status: 'ok' | 'error'
  tasks: BenchmarkTaskRow[] | null
  suggested_score: number | null
  readable: boolean | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  latency_ms: number | null
  error: string | null
  meta: Record<string, unknown>
  created_at: string
}

/**
 * Строка `ai_benchmark_results`. Провал — тоже строка (`status = 'error'`,
 * причина в `error`), с токенами и стоимостью, если модель успела ответить:
 * оплаченный, но не разобранный ответ — тоже цена модели.
 * `created_at` ставим явно: повтор (upsert) — это новый прогон, а не старый.
 */
export function benchmarkResultRow(req: BenchmarkRequest, outcome: BenchmarkOutcome, now: Date): BenchmarkResultRow {
  const usage = parseUsage(outcome.payload)
  const failed = outcome.error !== null && outcome.error !== undefined
  const latency = outcome.latencyMs
  return {
    run_id: req.runId,
    attempt_id: req.attemptId,
    model: req.model,
    status: failed ? 'error' : 'ok',
    tasks: !failed && outcome.tasks ? benchmarkTasks(outcome.tasks) : null,
    suggested_score: failed ? null : outcome.suggestedScore,
    readable: failed ? null : outcome.readable,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: usage.costUsd,
    latency_ms: typeof latency === 'number' && Number.isFinite(latency) ? Math.max(0, Math.round(latency)) : null,
    error: failed ? String(outcome.error).slice(0, BENCHMARK_ERROR_CHARS) || 'Неизвестная ошибка' : null,
    meta: {
      ...(outcome.meta ?? {}),
      finish_reason: finishReasonOf(outcome.payload),
      reasoning_tokens: usage.reasoningTokens,
      served_model: servedModelOf(outcome.payload),
    },
    created_at: now.toISOString(),
  }
}
