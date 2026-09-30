import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_MODELS,
  BENCHMARK_MODEL_TIMEOUT_MS,
  COMBAT_MAX_TOKENS,
  DEFAULT_AI_MODEL,
  THINKING_MAX_TOKENS,
  benchmarkMaxTokens,
  benchmarkRequestBody,
  benchmarkResultRow,
  benchmarkTasks,
  chatRequestBody,
  checkCronSecret,
  describeBenchmarkError,
  finishReasonOf,
  isBenchmarkModel,
  isBenchmarkRequest,
  parseBenchmarkRequest,
  parseUsage,
  safeEqual,
  seededTaskVerdict,
  servedModelOf,
  type BenchmarkRequest,
} from '../../../supabase/functions/check-homework-ai/benchmark.ts'
import { filterFindings, parseTasks, type TaskRow } from '../../../supabase/functions/check-homework-ai/findings.ts'
import { seededVerdict } from '../reviewTriage'

const ATTEMPT = '6f1c2b0e-8a44-4c1e-9d7a-2b9d4f0a1c33'
const MESSAGES = [{ role: 'user', content: [{ type: 'text', text: 'промпт' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } }] }]

describe('§247 тело запроса к модели', () => {
  it('боевое тело — побайтно то, что index.ts отправлял до §247', () => {
    // Литерал — дословно JSON.stringify({ model, messages, response_format, max_tokens: 6000 })
    // из index.ts на 38eb8aa. Порядок ключей тоже часть «побайтно».
    const expected = '{"model":"qwen/qwen3-vl-235b-a22b-instruct","messages":[{"role":"user","content":[{"type":"text","text":"промпт"},{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,AA=="}}]}],"response_format":{"type":"json_object"},"max_tokens":6000}'
    expect(JSON.stringify(chatRequestBody(DEFAULT_AI_MODEL, MESSAGES))).toBe(expected)
    expect(DEFAULT_AI_MODEL).toBe('qwen/qwen3-vl-235b-a22b-instruct')
    expect(COMBAT_MAX_TOKENS).toBe(6000)
  })

  it('боевое тело берёт любую модель из AI_MODEL как есть, без профилей замера', () => {
    const body = chatRequestBody('google/gemini-3.8-flash', MESSAGES)
    expect(body).toEqual({ model: 'google/gemini-3.8-flash', messages: MESSAGES, response_format: { type: 'json_object' }, max_tokens: 6000 })
    expect(body).not.toHaveProperty('usage')
  })

  it('замер Qwen: те же сообщения и response_format, потолок боевой, плюс usage.include', () => {
    const body = benchmarkRequestBody(DEFAULT_AI_MODEL, MESSAGES)
    expect(body.messages).toBe(MESSAGES)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBe(6000)
    expect(body.usage).toEqual({ include: true })
    expect(body).not.toHaveProperty('reasoning')
  })

  it('замер Gemini: потолок под рассуждение, режим рассуждения не трогаем', () => {
    for (const model of ['google/gemini-3.8-flash', 'google/gemini-3.1-pro-preview']) {
      const body = benchmarkRequestBody(model, MESSAGES)
      expect(body.max_tokens).toBe(THINKING_MAX_TOKENS)
      expect(body.model).toBe(model)
      expect(body).not.toHaveProperty('reasoning')
    }
    expect(benchmarkMaxTokens('anthropic/claude-sonnet-5.5')).toBe(6000)
  })

  it('ручной max_tokens из тела запроса побеждает профиль', () => {
    expect(benchmarkRequestBody('google/gemini-3.8-flash', MESSAGES, { maxTokens: 24000 }).max_tokens).toBe(24000)
    expect(benchmarkRequestBody(DEFAULT_AI_MODEL, MESSAGES, { maxTokens: null }).max_tokens).toBe(6000)
  })
})

describe('§247 доступ к замеру', () => {
  it('safeEqual: совпадение, другое значение той же длины, другая длина', () => {
    expect(safeEqual('s3cret-value', 's3cret-value')).toBe(true)
    expect(safeEqual('s3cret-valuf', 's3cret-value')).toBe(false)
    expect(safeEqual('s3cret', 's3cret-value')).toBe(false)
  })

  it('без секрета в проекте не пускает никого, даже с пустым заголовком', () => {
    expect(checkCronSecret('', undefined)).toBe(false)
    expect(checkCronSecret(null, '')).toBe(false)
    expect(checkCronSecret('anything', undefined)).toBe(false)
  })

  it('пускает только верный секрет', () => {
    expect(checkCronSecret('abc', 'abc')).toBe(true)
    expect(checkCronSecret('abd', 'abc')).toBe(false)
    expect(checkCronSecret(null, 'abc')).toBe(false)
  })

  it('боевое тело клиента в замер не уходит; любое значение benchmark, кроме false/null, — уходит (и там нужен секрет)', () => {
    expect(isBenchmarkRequest({ attempt_id: ATTEMPT })).toBe(false)
    expect(isBenchmarkRequest({})).toBe(false)
    expect(isBenchmarkRequest(null)).toBe(false)
    expect(isBenchmarkRequest('benchmark')).toBe(false)
    expect(isBenchmarkRequest({ attempt_id: ATTEMPT, benchmark: false })).toBe(false)
    expect(isBenchmarkRequest({ attempt_id: ATTEMPT, benchmark: null })).toBe(false)
    expect(isBenchmarkRequest({ benchmark: true })).toBe(true)
    expect(isBenchmarkRequest({ benchmark: 'true' })).toBe(true)
    expect(isBenchmarkRequest({ benchmark: 0 })).toBe(true)
  })
})

describe('§247 разбор тела замера', () => {
  const good = { benchmark: true, attempt_id: ATTEMPT, model: 'google/gemini-3.8-flash', run_id: '2026-10-01-a' }

  it('верное тело', () => {
    expect(parseBenchmarkRequest(good, DEFAULT_AI_MODEL)).toEqual({
      ok: true,
      value: { attemptId: ATTEMPT, model: 'google/gemini-3.8-flash', runId: '2026-10-01-a', maxTokens: null },
    })
  })

  it('все четыре модели списка проходят, остальные — отказ с перечнем допустимых', () => {
    for (const model of BENCHMARK_MODELS) {
      expect(parseBenchmarkRequest({ ...good, model }).ok).toBe(true)
    }
    expect(BENCHMARK_MODELS).toEqual([
      'qwen/qwen3-vl-235b-a22b-instruct',
      'google/gemini-3.8-flash',
      'google/gemini-3.1-pro-preview',
      'anthropic/claude-sonnet-5.5',
    ])
    const bad = parseBenchmarkRequest({ ...good, model: '~google/gemini-flash-latest' }, DEFAULT_AI_MODEL)
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toContain('~google/gemini-flash-latest')
      expect(bad.error).toContain('google/gemini-3.8-flash')
    }
    expect(parseBenchmarkRequest({ ...good, model: 'openai/gpt-9' }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, model: '' }).ok).toBe(false)
  })

  it('текущая боевая модель (AI_MODEL) допускается, даже если её нет в списке', () => {
    expect(isBenchmarkModel('qwen/qwen3.5-vl', 'qwen/qwen3.5-vl')).toBe(true)
    expect(isBenchmarkModel('qwen/qwen3.5-vl', DEFAULT_AI_MODEL)).toBe(false)
    expect(parseBenchmarkRequest({ ...good, model: 'qwen/qwen3.5-vl' }, 'qwen/qwen3.5-vl').ok).toBe(true)
  })

  it('кривые поля — отказ', () => {
    expect(parseBenchmarkRequest({ ...good, benchmark: 'true' }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, attempt_id: 'abc' }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, attempt_id: undefined }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, run_id: '   ' }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, run_id: 42 }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, run_id: 'x'.repeat(101) }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, max_tokens: 500 }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, max_tokens: 99999 }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, max_tokens: '8000' }).ok).toBe(false)
    expect(parseBenchmarkRequest({ ...good, max_tokens: 8000.5 }).ok).toBe(false)
    expect(parseBenchmarkRequest(null).ok).toBe(false)
  })

  it('max_tokens и пробелы по краям; uuid в нижний регистр (ключ уникальности)', () => {
    const r = parseBenchmarkRequest({ ...good, attempt_id: ` ${ATTEMPT.toUpperCase()} `, run_id: ' r1 ', max_tokens: 20000 })
    expect(r).toEqual({ ok: true, value: { attemptId: ATTEMPT, model: 'google/gemini-3.8-flash', runId: 'r1', maxTokens: 20000 } })
  })
})

describe('§247 ответ поставщика', () => {
  const payload = {
    model: 'google/gemini-3.8-flash-20260901',
    choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    usage: { prompt_tokens: 41234, completion_tokens: 2210, completion_tokens_details: { reasoning_tokens: 900 }, cost: 0.01873 },
  }

  it('токены, рассуждение и стоимость', () => {
    expect(parseUsage(payload)).toEqual({ inputTokens: 41234, outputTokens: 2210, reasoningTokens: 900, costUsd: 0.01873 })
  })

  it('нет usage или поля не числа — null, а не ноль', () => {
    expect(parseUsage(null)).toEqual({ inputTokens: null, outputTokens: null, reasoningTokens: null, costUsd: null })
    expect(parseUsage({ usage: { prompt_tokens: 'n/a', completion_tokens: -1 } }))
      .toEqual({ inputTokens: null, outputTokens: null, reasoningTokens: null, costUsd: null })
    expect(parseUsage({ usage: { prompt_tokens: '120', completion_tokens: 30, cost: 0 } }))
      .toEqual({ inputTokens: 120, outputTokens: 30, reasoningTokens: null, costUsd: 0 })
  })

  it('finish_reason и настоящая модель ответа', () => {
    expect(finishReasonOf(payload)).toBe('stop')
    expect(finishReasonOf({ choices: [{ native_finish_reason: 'MAX_TOKENS' }] })).toBe('MAX_TOKENS')
    expect(finishReasonOf({})).toBeNull()
    expect(servedModelOf(payload)).toBe('google/gemini-3.8-flash-20260901')
    expect(servedModelOf(null)).toBeNull()
  })

  it('причина провала: обрезка по max_tokens названа с числами', () => {
    const cut = { choices: [{ finish_reason: 'length' }], usage: { completion_tokens: 16000, completion_tokens_details: { reasoning_tokens: 12500 } } }
    const text = describeBenchmarkError(new Error('Не удалось разобрать ответ модели: {"readable": true, "tasks": [{"no'), cut)
    expect(text).toMatch(/^Ответ обрезан по max_tokens \(выход 16000, из них рассуждение 12500\)\. Не удалось разобрать ответ модели/)
  })

  it('причина провала: поставщик ответил 200 с полем error; таймаут; длина ограничена', () => {
    const text = describeBenchmarkError(new Error('Модель вернула пустой ответ'), { error: { message: 'Provider returned error' } })
    expect(text).toBe('Поставщик: Provider returned error. Модель вернула пустой ответ')
    // Отказ по HTTP уже содержит текст поставщика — второй раз не пишем.
    expect(describeBenchmarkError(new Error('Модель отказала: 429 Rate limit'), { error: { message: 'Rate limit' } }))
      .toBe('Модель отказала: 429 Rate limit')
    const timeout = Object.assign(new Error('Signal timed out.'), { name: 'TimeoutError' })
    expect(describeBenchmarkError(timeout)).toBe(`Модель не ответила за ${BENCHMARK_MODEL_TIMEOUT_MS / 1000} с`)
    expect(describeBenchmarkError('x'.repeat(5000)).length).toBe(1000)
  })
})

describe('§247 вердикт «после заполнения» совпадает с правилом §238 на клиенте', () => {
  const cases: TaskRow[] = [
    { no: '1', verdict: 'partial', student_answer: '0,78', expected_answer: '0.78', note: 'не оформлен отбор' },
    { no: '2', verdict: 'partial', student_answer: 'в 144 раза', expected_answer: '144', note: '' },
    { no: '3', verdict: 'partial', student_answer: '12', expected_answer: '30', note: 'арифметика' },
    { no: '4', verdict: 'partial', student_answer: '', expected_answer: '', note: '' },
    { no: '5', verdict: 'correct', student_answer: '5', expected_answer: '5', note: '' },
    { no: '6', verdict: 'wrong', student_answer: '-2', expected_answer: '2', note: '' },
    { no: '7', verdict: 'unchecked', student_answer: '?', expected_answer: '3', note: '' },
    { no: '8', verdict: 'partial', student_answer: 'x ∈ (1; 2]', expected_answer: 'x ∈ (1; 2]', note: '' },
  ]

  it.each(cases)('задание $no ($verdict: «$student_answer» / «$expected_answer»)', task => {
    expect(seededTaskVerdict(task)).toBe(seededVerdict(task).verdict)
  })

  it('benchmarkTasks добавляет seeded_verdict и не трогает остальное', () => {
    const out = benchmarkTasks(cases.slice(0, 3))
    expect(out.map(t => [t.no, t.verdict, t.seeded_verdict])).toEqual([
      ['1', 'partial', 'correct'], ['2', 'partial', 'correct'], ['3', 'partial', 'partial'],
    ])
    expect(out[0].note).toBe('не оформлен отбор')
  })
})

describe('§247 строка ai_benchmark_results', () => {
  const req: BenchmarkRequest = { attemptId: ATTEMPT, model: 'google/gemini-3.8-flash', runId: 'r1', maxTokens: null }
  const now = new Date('2026-10-01T10:00:00Z')

  it('удачный прогон: таблица ПОСЛЕ фильтра findings.ts, токены, стоимость, время', () => {
    // Модель отдала «wrong» при совпавших ответах — боевой фильтр делает «correct».
    const raw = parseTasks([
      { no: '1', verdict: 'wrong', student_answer: '0,78', expected_answer: '0.78', note: 'должно быть 0,78, а не 0,78' },
      { no: '2', verdict: 'correct', student_answer: '12', expected_answer: '30', note: '' },
      { no: '3', verdict: 'partial', student_answer: '5', expected_answer: '5', note: 'нет отбора' },
    ])
    const { tasks } = filterFindings([], raw)
    const row = benchmarkResultRow(req, {
      tasks,
      suggestedScore: 3,
      readable: true,
      error: null,
      payload: { model: 'google/gemini-3.8-flash', choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.002 } },
      latencyMs: 15234.6,
      meta: { pages_sent: 4 },
    }, now)
    expect(row).toMatchObject({
      run_id: 'r1', attempt_id: ATTEMPT, model: 'google/gemini-3.8-flash', status: 'ok',
      suggested_score: 3, readable: true, input_tokens: 100, output_tokens: 20, cost_usd: 0.002,
      latency_ms: 15235, error: null, created_at: '2026-10-01T10:00:00.000Z',
    })
    expect(row.tasks?.map(t => [t.no, t.verdict, t.seeded_verdict])).toEqual([
      ['1', 'correct', 'correct'], ['2', 'wrong', 'wrong'], ['3', 'partial', 'correct'],
    ])
    expect(row.meta).toEqual({ pages_sent: 4, finish_reason: 'stop', reasoning_tokens: null, served_model: 'google/gemini-3.8-flash' })
  })

  it('провал: строка со status error, причиной и оплаченными токенами, без таблицы и балла', () => {
    const row = benchmarkResultRow(req, {
      tasks: [{ no: '1', verdict: 'correct', student_answer: '1', expected_answer: '1', note: '' }],
      suggestedScore: 5,
      readable: true,
      error: 'Ответ обрезан по max_tokens. Не удалось разобрать ответ модели: {',
      payload: { choices: [{ finish_reason: 'length' }], usage: { prompt_tokens: 50000, completion_tokens: 16000 } },
      latencyMs: 90000,
    }, now)
    expect(row).toMatchObject({
      status: 'error', tasks: null, suggested_score: null, readable: null,
      input_tokens: 50000, output_tokens: 16000, cost_usd: null, latency_ms: 90000,
    })
    expect(row.error).toContain('обрезан')
    expect(row.meta.finish_reason).toBe('length')
  })

  it('провал до модели: ни токенов, ни времени', () => {
    const row = benchmarkResultRow(req, { tasks: null, suggestedScore: null, readable: null, error: 'В работе нет файлов', payload: undefined, latencyMs: null }, now)
    expect(row).toMatchObject({ status: 'error', error: 'В работе нет файлов', input_tokens: null, output_tokens: null, latency_ms: null })
  })

  it('нечитаемая работа — это удачный прогон с readable=false и пустой таблицей', () => {
    const row = benchmarkResultRow(req, { tasks: [], suggestedScore: null, readable: false, error: null, payload: {}, latencyMs: 1000 }, now)
    expect(row).toMatchObject({ status: 'ok', readable: false, tasks: [], suggested_score: null })
  })
})
