/**
 * §222b. Обработчик check-mock-exam-ai целиком на подменённом окружении
 * (`src/test/checkHomeworkAiHarness.ts`, как у check-homework-ai §247):
 * права — заявкой от имени пользователя, дальше сервисный ключ; один запрос к
 * модели на ученика; предложения — upsert, ошибки — в last_error; в баллы
 * (mock_exam_task_scores) ничего не пишется.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVICE_KEY, loadHandler, resetHarness, state, type DbCall, type Handler } from '../../test/checkHomeworkAiHarness'

const INDEX_PATH = '../../../supabase/functions/check-mock-exam-ai/index.ts'

const ENV = {
  SUPABASE_URL: 'https://harness.invalid',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  SUPABASE_ANON_KEY: 'anon-key-for-tests',
  AI_API_KEY: 'ai-key-for-tests',
}
const EX = '50000000-0000-0000-0000-000000000006'
const S1 = '20000000-0000-0000-0000-000000000051'
const S2 = '20000000-0000-0000-0000-000000000052'
const MAX = [1, 1, 1, 2, 3]

function tables(): Record<string, unknown> {
  return {
    mock_exams: { id: EX, title: 'Пробник №6', solution_path: `${EX}/solution/old.pdf`, mock_exam_templates: { max_points: MAX, part1_last: 3 } },
    mock_exam_variants: [
      { id: 'v2', position: 2, label: null, solution_path: `${EX}/v2/solution/1_s.pdf`, criteria_path: null },
      { id: 'v1', position: 1, label: null, solution_path: `${EX}/v1/solution/1_s.pdf`, criteria_path: `${EX}/v1/criteria/1_c.pdf` },
    ],
    mock_exam_variant_students: [{ student_id: S1, variant_id: 'v2' }],
    mock_exam_photos: [
      { id: 'ph1', student_id: S1, storage_path: `${EX}/photos/${S1}/1_p.jpg`, file_name: 'p.jpg', mime_type: 'image/jpeg', position: 0 },
      { id: 'ph2', student_id: S1, storage_path: `${EX}/photos/${S1}/2_p.jpg`, file_name: 'p2.jpg', mime_type: 'image/jpeg', position: 1 },
    ],
    // Заглушка хранилища отдаёт 7 байт на любой путь — кэш с тем же размером
    // отвечает за разбор PDF, и к поставщику уходит только сама проверка.
    mock_exam_file_text_cache: { text: 'Вариант 2. 4) x = 1. 5) ответ 7', size_bytes: 7 },
  }
}

function modelAnswer(tasks: unknown[]): unknown {
  return {
    choices: [{ message: { content: JSON.stringify({ tasks }) } }],
    usage: { prompt_tokens: 900, completion_tokens: 120 },
  }
}

let handler: Handler

beforeAll(async () => {
  handler = await loadHandler(() => import(/* @vite-ignore */ INDEX_PATH))
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  resetHarness({
    env: { ...ENV },
    rpc: { data: [{ student_id: S1, outcome: 'queued' }], error: null },
    tables: tables(),
    model: {
      status: 200, body: modelAnswer([
        { task: 4, points: 1, confidence: 'medium', comment: 'Нет обоснования', regions: [{ page_index: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }] },
        { task: 5, points: 9, confidence: 'high' },
      ]),
    },
  })
})

afterEach(() => vi.restoreAllMocks())

function post(body: unknown): Request {
  return new Request('https://harness.invalid/functions/v1/check-mock-exam-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer teacher-jwt' },
    body: JSON.stringify(body),
  })
}
const touched = (t: string) => state.db.filter(c => c.target === t)
const firstOp = (c: DbCall) => c.ops[0]?.[0]
const argOf = (c: DbCall) => c.ops[0][1] as Record<string, unknown>

describe('check-mock-exam-ai', () => {
  it('заявка от пользователя, модель один раз, предложения — upsert, статус running → done', async () => {
    const res = await handler(post({ mock_exam_id: EX, student_ids: [S1] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checked: 1, failed: 0, results: [{ student_id: S1, status: 'done', suggestions: 1 }], skipped: [] })

    const rpc = state.db.filter(c => c.kind === 'rpc')
    expect(rpc).toEqual([{ client: 'user', kind: 'rpc', target: 'mock_exam_ai_request_check', ops: [['call', { p_mock_exam_id: EX, p_student_ids: [S1] }]] }])
    // Всё остальное — сервисным ключом.
    expect(state.db.filter(c => c.kind !== 'rpc').every(c => c.client === 'service')).toBe(true)

    expect(state.fetches).toHaveLength(1)
    const call = state.fetches[0]
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(call.hasSignal).toBe(true)
    const body = call.body as { model: string; messages: { content: { type: string; text?: string }[] }[] }
    expect(body.model).toBe('google/gemini-3.8-flash')
    const parts = body.messages[0].content
    expect(parts.filter(p => p.type === 'image_url')).toHaveLength(2)
    // Вариант ученика — выданный (№2), его решение; номера второй части — с максимумами шаблона.
    expect(parts[0].text).toContain('ВАРИАНТ УЧЕНИКА: вариант №2.')
    expect(parts[0].text).toContain('ПРОВЕРЯЙ ТОЛЬКО номера 4–5: №4 (максимум 2), №5 (максимум 3).')
    expect(parts[0].text).toContain('Вариант 2. 4) x = 1')
    expect(state.db.filter(c => c.kind === 'storage').map(c => c.ops[0][1])).toContain(`${EX}/v2/solution/1_s.pdf`)

    const sug = touched('mock_exam_ai_suggestions')
    const upsert = sug.find(c => firstOp(c) === 'upsert')!
    expect(upsert.ops[0][1]).toEqual([expect.objectContaining({
      mock_exam_id: EX, student_id: S1, task_number: 4, points: 1, max_points: 2, confidence: 'medium',
      comment: 'Нет обоснования', regions: [{ photo_id: 'ph2', page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }],
      model: 'google/gemini-3.8-flash',
    })])
    expect(upsert.ops[0][2]).toEqual({ onConflict: 'mock_exam_id,student_id,task_number' })
    // Прошлые предложения по номерам, которых в ответе нет, убраны.
    const del = sug.find(c => firstOp(c) === 'delete')!
    expect(del.ops).toContainEqual(['not', 'task_number', 'in', '(4)'])

    const runs = touched('mock_exam_ai_runs').map(argOf)
    expect(runs.map(r => r.status)).toEqual(['running', 'done'])
    expect(runs[1]).toMatchObject({ last_error: null, input_tokens: 900, output_tokens: 120 })
    expect(String(runs[1].note)).toContain('Без предложения: №5 — поставьте сами.')
    expect(String(runs[1].note)).toContain('№5 — балл 9 вне 0…3')

    // ИИ никогда не пишет баллы.
    expect(touched('mock_exam_task_scores')).toHaveLength(0)
    expect(touched('mock_exam_results')).toHaveLength(0)
  })

  it('нет прав — 403, ни модели, ни записей', async () => {
    state.rpc = { data: null, error: { message: 'Нет доступа к этому пробнику' } }
    const res = await handler(post({ mock_exam_id: EX, student_ids: [S1] }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Нет доступа к этому пробнику' })
    expect(state.fetches).toHaveLength(0)
    expect(state.db.filter(c => c.kind !== 'rpc')).toHaveLength(0)
  })

  it('кривое тело — 400 без обращения к базе', async () => {
    const res = await handler(post({ mock_exam_id: 'x' }))
    expect(res.status).toBe(400)
    expect(state.db).toHaveLength(0)
  })

  it('некого проверять (идёт, без фото) — без модели, с перечнем', async () => {
    state.rpc = { data: [{ student_id: S1, outcome: 'running' }, { student_id: S2, outcome: 'no_photos' }], error: null }
    const res = await handler(post({ mock_exam_id: EX, student_ids: [S1, S2] }))
    expect(await res.json()).toEqual({ checked: 0, failed: 0, results: [], skipped: [{ student_id: S1, outcome: 'running' }, { student_id: S2, outcome: 'no_photos' }] })
    expect(state.fetches).toHaveLength(0)
  })

  it('провал модели — error с причиной в last_error, предложения не тронуты', async () => {
    state.model = { status: 502, body: { error: { message: 'upstream down' } } }
    const res = await handler(post({ mock_exam_id: EX, student_ids: [S1] }))
    expect(await res.json()).toMatchObject({ checked: 0, failed: 1, results: [{ student_id: S1, status: 'error', error: 'Модель отказала: 502 upstream down' }] })
    const last = touched('mock_exam_ai_runs').map(argOf).at(-1)!
    expect(last).toMatchObject({ status: 'error', last_error: 'Модель отказала: 502 upstream down' })
    expect(touched('mock_exam_ai_suggestions')).toHaveLength(0)
  })

  it('ответ не JSON с таблицей — ошибка, а не «пустая проверка», старые предложения целы', async () => {
    state.model = { status: 200, body: { choices: [{ message: { content: 'Извините, не могу' } }] } }
    await handler(post({ mock_exam_id: EX, student_ids: [S1] }))
    expect(touched('mock_exam_ai_runs').map(argOf).at(-1)).toMatchObject({ status: 'error', last_error: 'Не удалось разобрать ответ модели: Извините, не могу' })
    expect(touched('mock_exam_ai_suggestions')).toHaveLength(0)
  })

  it('нет ключа ИИ — у поставленных ошибка словами', async () => {
    delete state.env.AI_API_KEY
    const res = await handler(post({ mock_exam_id: EX, student_ids: [S1] }))
    expect(await res.json()).toMatchObject({ error: 'Переменная AI_API_KEY не настроена в проекте', failed: 1 })
    const upd = touched('mock_exam_ai_runs')[0]
    expect(argOf(upd)).toMatchObject({ status: 'error', last_error: 'Переменная AI_API_KEY не настроена в проекте' })
    expect(upd.ops).toContainEqual(['in', 'student_id', [S1]])
    expect(state.fetches).toHaveLength(0)
  })

  it('«у всех» — student_ids null уходит в базу как есть; ученики без выдачи берут первый вариант', async () => {
    state.rpc = { data: [{ student_id: S2, outcome: 'queued' }], error: null }
    ;(state.tables.mock_exam_photos as unknown[]).push({ id: 'ph9', student_id: S2, storage_path: `${EX}/photos/${S2}/1.jpg`, file_name: '1.jpg', mime_type: 'image/jpeg', position: 0 })
    await handler(post({ mock_exam_id: EX }))
    expect(state.db.find(c => c.kind === 'rpc')!.ops[0][1]).toEqual({ p_mock_exam_id: EX, p_student_ids: null })
    const prompt = (state.fetches[0].body as { messages: { content: { text?: string }[] }[] }).messages[0].content[0].text!
    expect(prompt).toContain('ВАРИАНТ УЧЕНИКА: вариант №1.')
    // Критерии варианта 1 — тоже в промпте.
    expect(prompt).toContain('КРИТЕРИИ ОЦЕНИВАНИЯ')
  })

  it('§222b.1: у варианта без PDF критериев — критерии текстом из кэша по ключу criteria-text:<вариант>', async () => {
    await handler(post({ mock_exam_id: EX, student_ids: [S1] }))
    const cacheReads = touched('mock_exam_file_text_cache').filter(c => firstOp(c) === 'select')
    expect(cacheReads.some(c => c.ops.some(op => op[0] === 'eq' && op[1] === 'storage_path' && op[2] === 'criteria-text:v2'))).toBe(true)
    const prompt = (state.fetches[0].body as { messages: { content: { text?: string }[] }[] }).messages[0].content[0].text!
    expect(prompt).toContain('КРИТЕРИИ ОЦЕНИВАНИЯ')
  })
})
