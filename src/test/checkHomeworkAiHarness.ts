/**
 * §247. Подменённое окружение для `supabase/functions/check-homework-ai/index.ts`.
 *
 * `index.ts` живёт в Deno и в vitest сам не запускается: ему нужны
 * `Deno.serve`, `Deno.env`, `jsr:@supabase/supabase-js` и сеть. Здесь всё это
 * подменено записывающими заглушками, и обработчик запроса можно вызвать как
 * обычную функцию. Каждое обращение к базе, хранилищу и модели ложится в
 * `state` — по нему тесты проверяют, ЧТО функция сделала (боевой путь: заявка,
 * ai_jobs, находки; замер: ни одного из них, только ai_benchmark_results).
 *
 * Клиент `jsr:@supabase/supabase-js@2` подменён алиасом vitest.config.ts
 * (src/test/jsrSupabaseStub.ts → `fakeCreateClient`). Пример — src/lib/__tests__/checkHomeworkAiHandler.test.ts.
 */

export interface DbCall {
  /** Каким ключом создан клиент: service (сервисный) или user (от имени пользователя). */
  client: 'service' | 'user'
  kind: 'from' | 'rpc' | 'storage'
  target: string
  ops: unknown[][]
}

export interface FetchCall {
  url: string
  headers: Record<string, string>
  body: unknown
  hasSignal: boolean
}

export interface HarnessState {
  env: Record<string, string | undefined>
  rpc: { data: unknown; error: { message: string } | null }
  /** Что отдаёт select по таблице (single/maybeSingle — объект, иначе массив). */
  tables: Record<string, unknown>
  /** Ошибка записи по таблице (insert/update/upsert). */
  writeErrors: Record<string, { message: string } | undefined>
  /** Ответ модели на /chat/completions. */
  model: { status: number; body: unknown } | { throws: Error }
  db: DbCall[]
  fetches: FetchCall[]
}

export const SERVICE_KEY = 'service-key-for-tests'

export const state: HarnessState = freshState()

function freshState(): HarnessState {
  return {
    env: {},
    rpc: { data: null, error: null },
    tables: {},
    writeErrors: {},
    model: { status: 200, body: {} },
    db: [],
    fetches: [],
  }
}

/** Сбросить состояние к умолчаниям и наложить своё. */
export function resetHarness(patch: Partial<HarnessState> = {}): HarnessState {
  Object.assign(state, freshState(), patch)
  return state
}

type Result = { data: unknown; error: { message: string } | null }

function resultOf(call: DbCall): Result {
  const first = call.ops[0]?.[0]
  if (first === 'insert' || first === 'update' || first === 'upsert' || first === 'delete') {
    return { data: null, error: state.writeErrors[call.target] ?? null }
  }
  const data = state.tables[call.target]
  const one = call.ops.some(op => op[0] === 'single' || op[0] === 'maybeSingle')
  if (one) return { data: Array.isArray(data) ? (data[0] ?? null) : (data ?? null), error: null }
  return { data: data ?? [], error: null }
}

const CHAIN_OPS = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'single', 'maybeSingle'] as const

function queryBuilder(call: DbCall): Record<string, unknown> {
  const builder: Record<string, unknown> = {}
  for (const op of CHAIN_OPS) {
    builder[op] = (...args: unknown[]) => {
      call.ops.push([op, ...args])
      return builder
    }
  }
  builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resultOf(call)).then(resolve, reject)
  return builder
}

/** Заглушка `createClient`: сервисный клиент — по ключу SERVICE_KEY, остальные — «от пользователя». */
export function fakeCreateClient(_url: string, key: string) {
  const client: DbCall['client'] = key === SERVICE_KEY ? 'service' : 'user'
  return {
    from(table: string) {
      const call: DbCall = { client, kind: 'from', target: table, ops: [] }
      state.db.push(call)
      return queryBuilder(call)
    },
    rpc(name: string, args: unknown) {
      state.db.push({ client, kind: 'rpc', target: name, ops: [['call', args]] })
      return Promise.resolve(state.rpc)
    },
    storage: {
      from(bucket: string) {
        return {
          download(path: string) {
            state.db.push({ client, kind: 'storage', target: bucket, ops: [['download', path]] })
            return Promise.resolve({ data: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])]), error: null })
          },
        }
      },
    },
  }
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const h = init?.headers
  if (h && typeof h === 'object' && !Array.isArray(h) && !(h instanceof Headers)) {
    for (const [k, v] of Object.entries(h as Record<string, string>)) out[k] = v
  }
  return out
}

/** Заглушка `fetch`: пишет запрос и отдаёт `state.model`. */
export async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)
  const raw = typeof init?.body === 'string' ? init.body : null
  state.fetches.push({ url, headers: headersOf(init), body: raw ? JSON.parse(raw) : null, hasSignal: !!init?.signal })
  if ('throws' in state.model) throw state.model.throws
  return new Response(JSON.stringify(state.model.body), {
    status: state.model.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export type Handler = (req: Request) => Promise<Response>

/**
 * Поставить глобальные `Deno` и `fetch` и импортировать модуль функции.
 * Путь передаётся строкой: tsc -b не должен уходить в Deno-код index.ts.
 */
export async function loadHandler(importModule: () => Promise<unknown>): Promise<Handler> {
  let handler: Handler | null = null
  const g = globalThis as Record<string, unknown>
  g.Deno = {
    env: { get: (name: string) => state.env[name] },
    serve: (fn: Handler) => { handler = fn },
  }
  g.fetch = fakeFetch
  await importModule()
  if (!handler) throw new Error('Deno.serve не был вызван')
  return handler
}

/** Типовые данные работы: две фотографии, ДЗ по пятибалльной, материалов темы нет. */
export const ATTEMPT_ID = '6f1c2b0e-8a44-4c1e-9d7a-2b9d4f0a1c33'

export function workTables(): Record<string, unknown> {
  return {
    topic_homework_attempts: {
      id: ATTEMPT_ID,
      homework_id: 'hw-1',
      homework: { id: 'hw-1', title: 'Логарифмы', instructions: '', grade_scale: 'five', topic_id: 'topic-1' },
    },
    topic_material_items: [],
    topic_homework_attempt_files: [
      { id: 'file-1', storage_path: `${ATTEMPT_ID}/1.jpg`, file_name: '1.jpg', mime_type: 'image/jpeg', position: 0 },
      { id: 'file-2', storage_path: `${ATTEMPT_ID}/2.jpg`, file_name: '2.jpg', mime_type: 'image/jpeg', position: 1 },
    ],
  }
}

/** Ответ модели: таблица с выдумкой (wrong при равных ответах), ошибкой и верным; три находки, одна с кривой рамкой. */
export function modelAnswer(extra: Record<string, unknown> = {}): unknown {
  const content = {
    readable: true,
    summary: 'Разбор для учителя',
    tasks: [
      { no: '1', verdict: 'wrong', student_answer: '0,78', expected_answer: '0.78', note: 'должно быть 0,78, а не 0,78' },
      { no: '2', verdict: 'wrong', student_answer: '12', expected_answer: '30', note: 'ошибка в знаке' },
      { no: '3', verdict: 'correct', student_answer: '5', expected_answer: '5', note: '' },
    ],
    suggested_score: 4,
    confidence: 'high',
    findings: [
      { task: '2', page_index: 1, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, category: 'calc', text: 'Потерян знак' },
      { task: '1', page_index: 2, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, category: 'calc', text: 'должно быть 0,78, а не 0,78' },
      { task: '3', page_index: 9, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, category: 'comment', text: 'не та страница' },
    ],
  }
  return {
    model: 'served-model',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 1200, completion_tokens: 340 },
    ...extra,
  }
}
