// Черновик ИИ-проверки домашней работы.
//
// Что здесь происходит и почему именно так:
//
//  1. Права проверяет БАЗА, а не эта функция. Мы вызываем
//     topic_homework_ai_request_check от имени вызвавшего преподавателя —
//     внутри стоит topic_homework_attempt_can_review. Своей проверки роли тут
//     нет специально: две независимые проверки прав неминуемо разъезжаются.
//  2. Дальше работаем сервисным ключом: писать в topic_homework_ai_* клиенту
//     нельзя ни политикой, ни грантом, и это правильно — иначе «предложение
//     ИИ» можно было бы подделать из браузера.
//  3. Результат — ЧЕРНОВИК. Ни балл, ни рамки, ни текст ученик не видит, пока
//     преподаватель их не принял. Поэтому функция ничего не пишет ни в
//     topic_homework_attempts, ни в аннотации.
//  4. Ошибки не глотаем, а кладём в job.last_error: панель показывает их
//     преподавателю через aiErrorMessage(), и по тексту видно, чинить ключ,
//     квоту или файлы.
//
// ПРОВАЙДЕР. Запрос идёт в OpenAI-совместимый /chat/completions, а не в
// собственный формат конкретной компании. Это сознательно: модель здесь
// расходник. Сменить её — переменная AI_MODEL, сменить поставщика —
// AI_BASE_URL, и ни то ни другое не требует передеплоя. По умолчанию
// Qwen3-VL через OpenRouter.
//
// Координаты рамок — доли страницы (0..1), начало отсчёта в левом верхнем
// углу. Так их ждёт и аннотатор (MIN_REGION_SIZE = 0.015), и CHECK-ограничения
// в topic_homework_ai_findings. Пиксели сюда класть нельзя: страницы
// масштабируются под ширину экрана.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ATTEMPTS_BUCKET = 'topic-homework-attempts'
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'qwen/qwen3-vl-235b-a22b-instruct'
const MAX_INLINE_BYTES = 15 * 1024 * 1024
const MAX_FINDINGS = 12
const CATEGORIES = ['comment', 'calc', 'logic', 'format', 'praise'] as const
// Только картинки: в OpenAI-совместимом протоколе PDF не передашь как
// image_url, а разбор PDF в текст убил бы координаты — рамку стало бы некуда
// ставить. Работы с одним лишь PDF отклоняем с внятным текстом.
const IMAGE_MIME = /^image\/(png|jpe?g|webp|heic|heif)$/i

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Category = typeof CATEGORIES[number]

interface AttemptFile {
  id: string
  storage_path: string
  file_name: string | null
  mime_type: string | null
  position: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''

  const admin = createClient(url, serviceKey)
  let jobId: string | null = null

  try {
    const body = await req.json().catch(() => ({}))
    const attemptId = String(body?.attempt_id ?? '').trim()
    if (!attemptId) return fail(400, 'Не передан идентификатор работы')

    // Шаг 1. Права и заявка — одним вызовом, от имени преподавателя.
    const asUser = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: newJobId, error: rpcError } = await asUser.rpc('topic_homework_ai_request_check', {
      p_attempt_id: attemptId,
    })
    if (rpcError) return fail(403, rpcError.message)
    jobId = String(newJobId)

    await admin.from('topic_homework_ai_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', jobId)

    // Ключ проверяем ПОСЛЕ создания задачи: так преподаватель увидит причину в
    // панели, а не молчаливый отказ на кнопке.
    const apiKey = Deno.env.get('AI_API_KEY') ?? Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) throw new Error('Переменная AI_API_KEY не настроена в проекте')
    const model = Deno.env.get('AI_MODEL') || DEFAULT_MODEL
    const baseUrl = (Deno.env.get('AI_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '')

    // Шаг 2. Условие задания и решение из материалов темы — контекст для модели.
    const { data: attempt } = await admin
      .from('topic_homework_attempts')
      .select('id, homework_id, homework:topic_homework!inner(id, title, instructions, grade_scale, topic_id)')
      .eq('id', attemptId)
      .single()

    const homework = (attempt as Record<string, any> | null)?.homework
    const topicId: string | null = homework?.topic_id ?? null
    const gradeScale: string | null = homework?.grade_scale ?? null

    let solutionText = ''
    if (topicId) {
      const { data: solution } = await admin
        .from('topic_material_items')
        .select('title, content, kind, section')
        .eq('topic_id', topicId)
        .eq('section', 'solution')
        .eq('kind', 'text')
        .order('position', { ascending: true })
      solutionText = (solution ?? [])
        .map((m: Record<string, any>) => [m.title, m.content].filter(Boolean).join('\n'))
        .join('\n\n')
        .slice(0, 8000)
    }

    // Шаг 3. Страницы работы.
    const { data: rawFiles } = await admin
      .from('topic_homework_attempt_files')
      .select('id, storage_path, file_name, mime_type, position')
      .eq('attempt_id', attemptId)
      .order('position', { ascending: true })

    const all = (rawFiles ?? []) as AttemptFile[]
    const images = all.filter(f => IMAGE_MIME.test(f.mime_type ?? guessMime(f)))
    if (images.length === 0) {
      throw new Error(all.length === 0
        ? 'В работе нет файлов'
        : 'В работе нет фотографий — модель проверяет только изображения, PDF пока не читает')
    }

    const content: Record<string, unknown>[] = []
    const sent: AttemptFile[] = []
    let total = 0

    for (const file of images) {
      const { data: blob, error: dlError } = await admin.storage.from(ATTEMPTS_BUCKET).download(file.storage_path)
      if (dlError || !blob) continue
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (total + bytes.length > MAX_INLINE_BYTES) break
      total += bytes.length
      sent.push(file)
      const mime = file.mime_type ?? guessMime(file)
      content.push({ type: 'text', text: `Страница #${sent.length}: ${file.file_name ?? 'без имени'}` })
      content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64(bytes)}` } })
    }

    if (sent.length === 0) throw new Error('Файлы работы слишком большие для проверки')

    // Шаг 4. Запрос к модели.
    const prompt = buildPrompt({
      title: homework?.title ?? 'Домашнее задание',
      instructions: homework?.instructions ?? '',
      solutionText,
      gradeScale,
      pageCount: sent.length,
    })

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter показывает их в статистике; другим поставщикам безвредны.
        'HTTP-Referer': 'https://alminion.ru',
        'X-Title': 'School Almiron',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...content] }],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      }),
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = payload?.error?.message ?? `HTTP ${response.status}`
      throw new Error(`Модель отказала: ${response.status} ${detail}`)
    }

    const text = extractText(payload)
    if (!text) throw new Error('Модель вернула пустой ответ')

    const parsed = parseJson(text)
    if (!parsed) throw new Error(`Не удалось разобрать ответ модели: ${text.slice(0, 200)}`)

    // Шаг 5. Находки. Кривые выбрасываем поштучно: одна плохая рамка не должна
    // отменять весь разбор — остальные всё равно полезны.
    const findings = Array.isArray(parsed.findings) ? parsed.findings : []
    const rows: Record<string, unknown>[] = []
    for (const raw of findings.slice(0, MAX_FINDINGS)) {
      const index = Number(raw?.page_index ?? raw?.file_index)
      const file = sent[Number.isFinite(index) ? index - 1 : -1]
      if (!file) continue

      const rect = raw?.rect ?? {}
      const x = clamp01(rect.x)
      const y = clamp01(rect.y)
      let w = clamp01(rect.w)
      let h = clamp01(rect.h)
      if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) continue
      // База требует, чтобы рамка не вылезала за страницу.
      w = Math.min(w, 1 - x)
      h = Math.min(h, 1 - y)
      if (w <= 0 || h <= 0) continue

      const note = String(raw?.text ?? '').trim().slice(0, 2000)
      if (!note) continue

      const category: Category = CATEGORIES.includes(raw?.category) ? raw.category : 'comment'

      rows.push({
        job_id: jobId,
        file_id: file.id,
        // Каждая фотография — одна страница; многостраничных файлов сюда не
        // попадает, поэтому page всегда 1.
        page: 1,
        position: rows.length,
        rect_x: x, rect_y: y, rect_w: w, rect_h: h,
        category,
        text: note,
      })
    }

    if (rows.length > 0) {
      const { error: insertError } = await admin.from('topic_homework_ai_findings').insert(rows)
      if (insertError) throw new Error(`Не удалось сохранить находки: ${insertError.message}`)
    }

    const usage = payload?.usage ?? {}
    await admin.from('topic_homework_ai_jobs').update({
      status: 'done',
      provider: providerOf(baseUrl),
      model,
      readable: parsed.readable !== false,
      suggested_score: numberOrNull(parsed.suggested_score),
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : null,
      summary: String(parsed.summary ?? '').slice(0, 8000) || null,
      last_error: null,
      completed_at: new Date().toISOString(),
      input_tokens: numberOrNull(usage.prompt_tokens),
      output_tokens: numberOrNull(usage.completion_tokens),
    }).eq('id', jobId)

    return json({ job_id: jobId, findings: rows.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (jobId) {
      await admin.from('topic_homework_ai_jobs').update({
        status: 'failed',
        last_error: message.slice(0, 1000),
        completed_at: new Date().toISOString(),
      }).eq('id', jobId)
    }
    return fail(200, message, jobId)
  }
})

/**
 * Промпт. Две вещи в нём важнее формулировок:
 *  — модель сначала решает задачу САМА и только потом сверяет. Иначе она
 *    соглашается с ходом ученика и подтверждает его же ошибку;
 *  — координаты просим долями страницы и повторяем это дважды, потому что
 *    пиксели — самый частый способ промахнуться мимо строки.
 */
function buildPrompt(ctx: {
  title: string
  instructions: string
  solutionText: string
  gradeScale: string | null
  pageCount: number
}): string {
  const scale = ctx.gradeScale === 'five'
    ? 'Оценка по пятибалльной шкале: целое число от 2 до 5.'
    : ctx.gradeScale === 'hundred'
      ? 'Оценка по стобалльной шкале: целое число от 0 до 100.'
      : 'Шкала оценки не задана — предложи балл от 0 до 100.'

  return [
    'Ты опытный учитель физики и математики. Проверяешь рукописную работу ученика по фотографиям.',
    '',
    `ЗАДАНИЕ: ${ctx.title}`,
    ctx.instructions ? `УСЛОВИЕ: ${ctx.instructions}` : '',
    ctx.solutionText ? `АВТОРСКОЕ РЕШЕНИЕ УЧИТЕЛЯ (используй как эталон):\n${ctx.solutionText}` : '',
    '',
    'ПОРЯДОК РАБОТЫ:',
    '1. Сначала реши задачу сам, не подглядывая в ход ученика.',
    '2. Потом прочитай работу ученика и сравни со своим решением.',
    '3. Отметь конкретные места: ошибки в вычислениях, логике, оформлении — и удачные ходы.',
    '',
    `Тебе передано страниц: ${ctx.pageCount}. Перед каждой идёт строка «Страница #N: имя».`,
    '',
    'ОТВЕТЬ СТРОГО ОДНИМ JSON-объектом, без пояснений и без markdown:',
    '{',
    '  "readable": true,',
    '  "summary": "разбор для учителя на русском: что верно, что нет, на что обратить внимание",',
    '  "suggested_score": 4,',
    '  "confidence": "high",',
    '  "findings": [',
    '    {"page_index": 1, "rect": {"x": 0.12, "y": 0.34, "w": 0.4, "h": 0.06},',
    '     "category": "calc", "text": "Здесь потерян знак минус при переносе"}',
    '  ]',
    '}',
    '',
    'ПРАВИЛА:',
    `- ${scale}`,
    '- confidence: "high" — работа читается уверенно и решение однозначно; "medium" — есть сомнения; "low" — почерк плохо разбирается или задание непонятно.',
    '- Если работу невозможно прочитать: "readable": false, "findings": [], "confidence": "low".',
    '- page_index — номер страницы из строки «Страница #N», начиная с 1.',
    '- КООРДИНАТЫ — ДОЛИ СТРАНИЦЫ ОТ 0 ДО 1, начало отсчёта в левом верхнем углу. Не пиксели.',
    '- x + w не больше 1, y + h не больше 1. Рамка должна плотно охватывать нужные строки, а не всю страницу.',
    `- Не больше ${MAX_FINDINGS} находок. Лучше меньше, но по делу.`,
    '- category: "calc" — арифметика и знаки, "logic" — неверный ход решения, "format" — оформление и единицы измерения, "praise" — удачный ход, "comment" — всё остальное.',
    '- text — по-русски, обращение к ученику на «ты», одно-два предложения, без общих слов.',
  ].filter(Boolean).join('\n')
}

/** Ответ OpenAI-совместимого API. Запасные ветки — на случай другого поставщика. */
function extractText(payload: unknown): string {
  const p = payload as Record<string, any> | null
  const message = p?.choices?.[0]?.message
  if (typeof message?.content === 'string' && message.content.trim()) return message.content.trim()
  if (Array.isArray(message?.content)) {
    const joined = message.content.map((x: Record<string, any>) => x?.text ?? '').join('').trim()
    if (joined) return joined
  }
  const alt = p?.candidates?.[0]?.content?.parts?.[0]?.text ?? p?.text
  return typeof alt === 'string' ? alt.trim() : ''
}

/** Модель иногда оборачивает JSON в ```json — вытаскиваем объект по скобкам. */
function parseJson(text: string): Record<string, any> | null {
  const direct = tryParse(text)
  if (direct) return direct
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  return tryParse(text.slice(start, end + 1))
}

function tryParse(text: string): Record<string, any> | null {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value as Record<string, any> : null
  } catch {
    return null
  }
}

function clamp01(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function providerOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^api\./, '')
  } catch {
    return 'unknown'
  }
}

function guessMime(file: { storage_path: string; file_name: string | null }): string {
  const name = (file.file_name ?? file.storage_path).toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.heic')) return 'image/heic'
  if (name.endsWith('.heif')) return 'image/heif'
  return 'image/jpeg'
}

/** base64 без разворота всего массива в аргументы: у больших файлов стек кончается. */
function base64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * Отказ отдаём кодом 200, когда задача уже создана: supabase-js превращает
 * не-2xx в FunctionsHttpError без тела, и панель показала бы «Edge Function
 * returned a non-2xx status code» вместо настоящей причины. Причина при этом
 * лежит и в job.last_error — панель читает именно её.
 */
function fail(status: number, message: string, jobId?: string | null): Response {
  return json({ error: message, job_id: jobId ?? null }, jobId ? 200 : status)
}
