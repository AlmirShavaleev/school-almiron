/**
 * §247. Обработчик check-homework-ai целиком, на подменённом окружении
 * (`src/test/checkHomeworkAiHarness.ts`): боевой путь делает то же, что до
 * §247, а замер не касается ни заявки, ни ai_jobs, ни находок.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ATTEMPT_ID,
  SERVICE_KEY,
  loadHandler,
  modelAnswer,
  resetHarness,
  state,
  workTables,
  type DbCall,
  type Handler,
} from '../../test/checkHomeworkAiHarness'

// `jsr:@supabase/supabase-js@2` подменён алиасом vitest.config.ts → src/test/jsrSupabaseStub.ts.

// Строкой, чтобы tsc -b не уходил в Deno-код функции.
const INDEX_PATH = '../../../supabase/functions/check-homework-ai/index.ts'

const ENV = {
  SUPABASE_URL: 'https://harness.invalid',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_ANON_KEY: 'anon-key-for-tests',
  AI_API_KEY: 'ai-key-for-tests',
  CRON_SECRET: 'cron-secret-for-tests',
}

let handler: Handler

beforeAll(async () => {
  handler = await loadHandler(() => import(/* @vite-ignore */ INDEX_PATH))
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T10:00:00Z'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  resetHarness({
    env: { ...ENV },
    rpc: { data: 'job-1', error: null },
    tables: workTables(),
    model: { status: 200, body: modelAnswer() },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://harness.invalid/functions/v1/check-homework-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-jwt', ...headers },
    body: JSON.stringify(body),
  })
}

const touched = (target: string) => state.db.filter(c => c.target === target)
const firstOp = (c: DbCall) => c.ops[0]?.[0]
const writes = () => state.db.filter(c => ['insert', 'update', 'upsert', 'delete'].includes(String(firstOp(c))))

const BENCH = { benchmark: true, attempt_id: ATTEMPT_ID, model: 'google/gemini-3.8-flash', run_id: 'run-1' }
const SECRET = { 'X-Cron-Secret': ENV.CRON_SECRET }

describe('боевой путь (без benchmark)', () => {
  it('заявка от имени пользователя, processing → done, находки; тело модели — боевое', async () => {
    const res = await handler(post({ attempt_id: ATTEMPT_ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ job_id: 'job-1', findings: 1 })

    const rpc = state.db.filter(c => c.kind === 'rpc')
    expect(rpc).toEqual([{ client: 'user', kind: 'rpc', target: 'topic_homework_ai_request_check', ops: [['call', { p_attempt_id: ATTEMPT_ID }]] }])

    const jobs = touched('topic_homework_ai_jobs')
    expect(jobs.map(c => (c.ops[0][1] as Record<string, unknown>).status)).toEqual(['processing', 'done'])
    const done = jobs[1].ops[0][1] as Record<string, unknown>
    expect(done).toMatchObject({
      status: 'done', provider: 'openrouter.ai', model: 'qwen/qwen3-vl-235b-a22b-instruct',
      readable: true, suggested_score: 3, dropped_findings: 2, input_tokens: 1200, output_tokens: 340,
      reference_state: 'missing', worksheet_state: 'missing',
    })
    expect((done.tasks as { no: string; verdict: string }[]).map(t => [t.no, t.verdict]))
      .toEqual([['1', 'correct'], ['2', 'wrong'], ['3', 'correct']])
    // В боевой ai_jobs вердикта «после заполнения» нет — это поле только замера.
    expect(done.tasks as object[]).not.toContainEqual(expect.objectContaining({ seeded_verdict: expect.anything() }))

    const findings = touched('topic_homework_ai_findings')
    expect(findings).toHaveLength(1)
    expect(findings[0].ops[0][1]).toEqual([expect.objectContaining({ job_id: 'job-1', file_id: 'file-1', page: 1, task: '2', category: 'calc' })])

    expect(touched('ai_benchmark_results')).toHaveLength(0)
    expect(state.fetches).toHaveLength(1)
    const call = state.fetches[0]
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(call.hasSignal).toBe(false)
    expect(call.headers.Authorization).toBe(`Bearer ${ENV.AI_API_KEY}`)
    expect(Object.keys(call.body as object)).toEqual(['model', 'messages', 'response_format', 'max_tokens'])
    expect(call.body).toMatchObject({ model: 'qwen/qwen3-vl-235b-a22b-instruct', response_format: { type: 'json_object' }, max_tokens: 6000 })
  })

  it('AI_MODEL проекта идёт в бой как есть', async () => {
    state.env.AI_MODEL = 'some/other-model'
    await handler(post({ attempt_id: ATTEMPT_ID }))
    expect(state.fetches[0].body).toMatchObject({ model: 'some/other-model', max_tokens: 6000 })
  })

  it('нет прав — 403 без модели и без записей', async () => {
    state.rpc = { data: null, error: { message: 'Нет прав на проверку' } }
    const res = await handler(post({ attempt_id: ATTEMPT_ID }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Нет прав на проверку', job_id: null })
    expect(state.fetches).toHaveLength(0)
    expect(writes()).toHaveLength(0)
  })

  it('провал модели — задача failed с причиной, ответ 200', async () => {
    state.model = { status: 502, body: { error: { message: 'upstream down' } } }
    const res = await handler(post({ attempt_id: ATTEMPT_ID }))
    expect(await res.json()).toEqual({ error: 'Модель отказала: 502 upstream down', job_id: 'job-1' })
    const last = touched('topic_homework_ai_jobs').at(-1)!.ops[0][1]
    expect(last).toMatchObject({ status: 'failed', last_error: 'Модель отказала: 502 upstream down' })
  })
})

describe('замер §247: доступ', () => {
  it('без заголовка — 401, ни базы, ни модели', async () => {
    const res = await handler(post(BENCH))
    expect(res.status).toBe(401)
    expect(state.db).toHaveLength(0)
    expect(state.fetches).toHaveLength(0)
  })

  it('неверный секрет — 401', async () => {
    const res = await handler(post(BENCH, { 'X-Cron-Secret': 'cron-secret-for-testz' }))
    expect(res.status).toBe(401)
    expect(state.db).toHaveLength(0)
  })

  it('CRON_SECRET в проекте не задан — 401 даже с пустым заголовком', async () => {
    delete state.env.CRON_SECRET
    const res = await handler(post(BENCH, { 'X-Cron-Secret': '' }))
    expect(res.status).toBe(401)
    expect(state.db).toHaveLength(0)
  })

  it('benchmark строкой без секрета — 401, а НЕ боевой путь с заявкой', async () => {
    const res = await handler(post({ ...BENCH, benchmark: 'true' }))
    expect(res.status).toBe(401)
    expect(state.db.filter(c => c.kind === 'rpc')).toHaveLength(0)
  })

  it('модель не из списка — 400 без модели и без записей', async () => {
    const res = await handler(post({ ...BENCH, model: 'openai/gpt-9' }, SECRET))
    expect(res.status).toBe(400)
    expect(state.fetches).toHaveLength(0)
    expect(state.db).toHaveLength(0)
  })

  it('работы нет — 404, строка не пишется', async () => {
    delete state.tables.topic_homework_attempts
    const res = await handler(post(BENCH, SECRET))
    expect(res.status).toBe(404)
    expect(writes()).toHaveLength(0)
    expect(state.fetches).toHaveLength(0)
  })
})

describe('замер §247: прогон', () => {
  it('строка в ai_benchmark_results; ни заявки, ни ai_jobs, ни находок', async () => {
    const res = await handler(post(BENCH, SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', model: 'google/gemini-3.8-flash', tasks: 3, suggested_score: 3, error: null })

    expect(state.db.filter(c => c.kind === 'rpc')).toHaveLength(0)
    expect(touched('topic_homework_ai_jobs')).toHaveLength(0)
    expect(touched('topic_homework_ai_findings')).toHaveLength(0)
    expect(touched('topic_homework_review_tasks')).toHaveLength(0)
    expect(state.db.every(c => c.client === 'service')).toBe(true)
    expect(writes().map(c => c.target)).toEqual(['ai_benchmark_results'])

    const [upsert] = touched('ai_benchmark_results')
    expect(upsert.ops[0][0]).toBe('upsert')
    expect(upsert.ops[0][2]).toEqual({ onConflict: 'run_id,attempt_id,model' })
    const row = upsert.ops[0][1] as Record<string, any>
    expect(row).toMatchObject({
      run_id: 'run-1', attempt_id: ATTEMPT_ID, model: 'google/gemini-3.8-flash', status: 'ok',
      suggested_score: 3, readable: true, input_tokens: 1200, output_tokens: 340, error: null,
    })
    // Та же таблица, что легла бы в бою (фильтр findings.ts), плюс seeded_verdict.
    expect(row.tasks.map((t: any) => [t.no, t.verdict, t.seeded_verdict]))
      .toEqual([['1', 'correct', 'correct'], ['2', 'wrong', 'wrong'], ['3', 'correct', 'correct']])
    expect(row.meta).toMatchObject({ pages_sent: 2, reference_state: 'missing', max_tokens: 16000, served_model: 'served-model', dropped_findings: 2 })

    const call = state.fetches[0]
    expect(call.hasSignal).toBe(true)
    expect(call.body).toMatchObject({ model: 'google/gemini-3.8-flash', max_tokens: 16000, usage: { include: true }, response_format: { type: 'json_object' } })
  })

  it('промпт и страницы замера — дословно боевые', async () => {
    await handler(post({ attempt_id: ATTEMPT_ID }))
    const combat = state.fetches[0].body as Record<string, unknown>
    resetHarness({ env: { ...ENV }, rpc: { data: 'job-1', error: null }, tables: workTables(), model: { status: 200, body: modelAnswer() } })
    await handler(post({ ...BENCH, model: 'qwen/qwen3-vl-235b-a22b-instruct' }, SECRET))
    const bench = state.fetches[0].body as Record<string, unknown>
    expect(bench.messages).toEqual(combat.messages)
    expect(bench.max_tokens).toBe(combat.max_tokens)
  })

  it('отказ модели — строка error с причиной, HTTP 200', async () => {
    state.model = { status: 429, body: { error: { message: 'Rate limit exceeded' } } }
    const res = await handler(post(BENCH, SECRET))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'error', error: 'Модель отказала: 429 Rate limit exceeded' })
    const row = touched('ai_benchmark_results')[0].ops[0][1] as Record<string, unknown>
    expect(row).toMatchObject({ status: 'error', tasks: null, suggested_score: null })
    expect(touched('topic_homework_ai_jobs')).toHaveLength(0)
  })

  it('JSON оборван по max_tokens — строка error с этой причиной и оплаченными токенами', async () => {
    state.model = {
      status: 200,
      body: {
        choices: [{ finish_reason: 'length', message: { content: '{"readable": true, "tasks": [{"no": "1", "verd' } }],
        usage: { prompt_tokens: 50000, completion_tokens: 16000, completion_tokens_details: { reasoning_tokens: 15000 }, cost: 0.03 },
      },
    }
    await handler(post(BENCH, SECRET))
    const row = touched('ai_benchmark_results')[0].ops[0][1] as Record<string, any>
    expect(row.status).toBe('error')
    expect(row.error).toMatch(/^Ответ обрезан по max_tokens \(выход 16000, из них рассуждение 15000\)\. Не удалось разобрать ответ модели/)
    expect(row).toMatchObject({ input_tokens: 50000, output_tokens: 16000, cost_usd: 0.03 })
  })

  it('в работе нет файлов — строка error, модель не зовётся', async () => {
    state.tables.topic_homework_attempt_files = []
    await handler(post(BENCH, SECRET))
    const row = touched('ai_benchmark_results')[0].ops[0][1] as Record<string, unknown>
    expect(row).toMatchObject({ status: 'error', error: 'В работе нет файлов', latency_ms: null })
    expect(state.fetches).toHaveLength(0)
  })

  it('ручной max_tokens уходит в тело', async () => {
    await handler(post({ ...BENCH, max_tokens: 24000 }, SECRET))
    expect(state.fetches[0].body).toMatchObject({ max_tokens: 24000 })
  })
})
