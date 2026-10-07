// §222b. ИИ-проверка второй части пробника: предложение балла по каждому
// номеру с уверенностью, комментарием и рамками на фото.
//
// Устройство — как у check-homework-ai (§32–§48): права проверяет база —
// функция первым делом зовёт mock_exam_ai_request_check ОТ ИМЕНИ
// преподавателя (его JWT), дальше работает сервисным ключом. Результат —
// ЧЕРНОВИК в mock_exam_ai_suggestions: в mock_exam_task_scores ИИ не пишет
// никогда, балл ставит человек кнопкой «Принять» и обычным сохранением.
// Ошибки — в mock_exam_ai_runs.last_error: только оттуда преподаватель узнает,
// что чинить. Ученик не видит ничего (RLS, 20261007171207_mock_exam_ai_222b.sql).
//
// Вход: POST { mock_exam_id, student_ids?: uuid[] } с Authorization: Bearer <JWT>.
// student_ids нет — «у всех»: база выберет учеников с фото и без предложений.
// Экран шлёт по одному ученику на вызов (три вызова сразу): у вызова свой
// бюджет CPU (2 с) и свой потолок по стене (400 с); внутри одного вызова —
// тоже не больше трёх учеников одновременно (CONCURRENCY).
//
// На ученика — ОДИН запрос к модели: фото второй части + текст решения и
// критериев ЕГО варианта (PDF → текст тем же движком и с тем же порядком
// бесплатный → платный, что у ДЗ; кэш — mock_exam_file_text_cache по пути
// файла). Один PDF решений часто содержит все варианты — номер варианта
// ученика и номера второй части с максимумами шаблона названы в промпте явно.
//
// Окружение — то же, что у check-homework-ai: AI_API_KEY (запасное имя
// OPENROUTER_API_KEY), AI_BASE_URL, AI_MODEL, AI_PARSE_MODEL; SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY — их даёт платформа.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  MAX_REFERENCE_BYTES,
  describeParseFailure,
  isParseUsable,
  nextEngine,
  tooLittleTextReason,
  truncateReference,
  type ParseEngine,
  type ReferenceState,
} from '../check-homework-ai/reference.ts'
import { DEFAULT_AI_MODEL, PARSE_DEFAULT_MODEL, chatRequestBody } from '../check-homework-ai/benchmark.ts'
import { base64, parsePdf, renderPdfPages } from '../check-homework-ai/pdf.ts'
import {
  CONCURRENCY,
  CRITERIA_LIMIT,
  MAX_INLINE_BYTES,
  MAX_PAGES,
  MODEL_TIMEOUT_MS,
  RENDER_BUDGET_MS,
  SOLUTION_LIMIT,
  buildPrompt,
  extractText,
  parseCheckRequest,
  parseJson,
  parseSuggestions,
  part2Tasks,
  runNote,
  runPool,
  type Part2Task,
  type SentPage,
} from './logic.ts'

const BUCKET = 'mock-exams'
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const IMAGE_MIME = /^image\/(png|jpe?g|webp|heic|heif)$/i
const PDF_MIME = /^application\/pdf$/i
const JPEG_QUALITY = 80

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Admin = ReturnType<typeof createClient>

interface Photo {
  id: string
  student_id: string
  storage_path: string
  file_name: string | null
  mime_type: string | null
  position: number
}

interface Variant {
  id: string
  position: number
  label: string | null
  solution_path: string | null
  criteria_path: string | null
}

interface FileText {
  text: string
  truncated: boolean
  state: ReferenceState
  error: string | null
}

interface StudentResult {
  student_id: string
  status: 'done' | 'error'
  suggestions?: number
  error?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''

  const body = await req.json().catch(() => ({}))
  const request = parseCheckRequest(body)
  if (!request.ok) return json({ error: request.error }, 400)
  const examId = request.mockExamId

  // Шаг 1. Права и очередь — одним вызовом, от имени преподавателя.
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: outcomes, error: rpcError } = await asUser.rpc('mock_exam_ai_request_check', {
    p_mock_exam_id: examId,
    p_student_ids: request.studentIds,
  })
  if (rpcError) return json({ error: rpcError.message }, 403)

  const list = (Array.isArray(outcomes) ? outcomes : []) as { student_id: string; outcome: string }[]
  const queued = list.filter(o => o.outcome === 'queued').map(o => o.student_id)
  const skipped = list.filter(o => o.outcome !== 'queued')
  if (queued.length === 0) return json({ checked: 0, failed: 0, results: [], skipped })

  const admin = createClient(url, serviceKey)
  const markError = (ids: string[], message: string) => admin.from('mock_exam_ai_runs').update({
    status: 'error', last_error: message.slice(0, 1000), finished_at: new Date().toISOString(),
  }).eq('mock_exam_id', examId).in('student_id', ids)

  // Ключ проверяем ПОСЛЕ постановки в очередь: преподаватель увидит причину в
  // статусе, а не молчаливый отказ кнопки.
  const apiKey = Deno.env.get('AI_API_KEY') ?? Deno.env.get('OPENROUTER_API_KEY')
  if (!apiKey) {
    const message = 'Переменная AI_API_KEY не настроена в проекте'
    await markError(queued, message)
    return json({ error: message, checked: 0, failed: queued.length, results: queued.map(id => ({ student_id: id, status: 'error', error: message })), skipped })
  }
  const model = Deno.env.get('AI_MODEL') || DEFAULT_AI_MODEL
  const baseUrl = (Deno.env.get('AI_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const parseModel = Deno.env.get('AI_PARSE_MODEL') || PARSE_DEFAULT_MODEL
  const ai = { apiKey, baseUrl, model, parseModel }

  try {
    // Шаг 2. Пробник, шаблон, варианты, выдача, фото — сервисным ключом.
    const { data: exam, error: examError } = await admin
      .from('mock_exams')
      .select('id, title, solution_path, mock_exam_templates(max_points, part1_last)')
      .eq('id', examId)
      .single()
    if (examError || !exam) throw new Error('Пробник не найден')
    const e = exam as unknown as {
      title: string | null
      solution_path: string | null
      mock_exam_templates: { max_points: number[] | null; part1_last: number | null } | null
    }
    const tpl = e.mock_exam_templates
    if (!tpl) throw new Error('У пробника нет шаблона — номеров второй части нет')
    const tasks = part2Tasks((tpl.max_points ?? []).map(Number), Number(tpl.part1_last ?? 0))
    if (tasks.length === 0) throw new Error('Во второй части шаблона нет номеров — проверять нечего')

    const [{ data: vRows }, { data: aRows }, { data: pRows }] = await Promise.all([
      admin.from('mock_exam_variants').select('id, position, label, solution_path, criteria_path').eq('mock_exam_id', examId),
      admin.from('mock_exam_variant_students').select('student_id, variant_id').eq('mock_exam_id', examId).in('student_id', queued),
      admin.from('mock_exam_photos').select('id, student_id, storage_path, file_name, mime_type, position')
        .eq('mock_exam_id', examId).in('student_id', queued).order('position', { ascending: true }),
    ])
    const variants = ((vRows ?? []) as Variant[]).slice().sort((a, b) => a.position - b.position)
    const assigned = new Map(((aRows ?? []) as { student_id: string; variant_id: string }[]).map(r => [r.student_id, r.variant_id]))
    const photosOf = new Map<string, Photo[]>()
    for (const p of (pRows ?? []) as Photo[]) {
      const arr = photosOf.get(p.student_id) ?? []
      arr.push(p)
      photosOf.set(p.student_id, arr)
    }

    // Текст PDF — один раз на файл за вызов: у трёх учеников одного варианта
    // решение одно и то же.
    const texts = new Map<string, Promise<FileText>>()
    const textOf = (path: string | null, label: string, limit: number) => {
      if (!path) return Promise.resolve<FileText>({ text: '', truncated: false, state: 'missing', error: null })
      const k = `${limit}:${path}`
      if (!texts.has(k)) texts.set(k, loadFileText(admin, ai, path, label, limit).catch(err => ({
        text: '', truncated: false, state: 'failed' as const,
        error: `${label}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      })))
      return texts.get(k)!
    }

    // Бюджет рендера PDF — общий на вызов (2 с CPU на запрос).
    const render = { left: RENDER_BUDGET_MS }

    const results = await runPool<string, StudentResult>(queued, CONCURRENCY, async (studentId) => {
      await admin.from('mock_exam_ai_runs').update({ status: 'running', started_at: new Date().toISOString(), model })
        .eq('mock_exam_id', examId).eq('student_id', studentId)
      try {
        // Вариант ученика: выданный, без выдачи — первый по номеру (как mock_exam_student_variant).
        const variant = variants.find(v => v.id === assigned.get(studentId)) ?? variants[0] ?? null
        const solutionPath = variant ? variant.solution_path : (e.solution_path ?? null)
        const criteriaPath = variant ? variant.criteria_path : null
        const [solution, criteria] = await Promise.all([
          textOf(solutionPath, 'решение', SOLUTION_LIMIT),
          criteriaPath
            ? textOf(criteriaPath, 'критерии', CRITERIA_LIMIT)
            : criteriaTextOf(admin, variant?.id ?? null, CRITERIA_LIMIT),
        ])
        const outcome = await checkStudent(admin, ai, {
          examId, studentId, title: String(e.title ?? 'Пробник'), tasks,
          variant, variantCount: variants.length, solution, criteria,
          photos: photosOf.get(studentId) ?? [], render,
        })
        return outcome
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await markError([studentId], message)
        return { student_id: studentId, status: 'error', error: message.slice(0, 1000) }
      }
    })

    return json({
      checked: results.filter(r => r.status === 'done').length,
      failed: results.filter(r => r.status === 'error').length,
      results,
      skipped,
    })
  } catch (err) {
    // Сбой до учеников (пробник, шаблон) — у всех поставленных одна причина.
    const message = err instanceof Error ? err.message : String(err)
    await markError(queued, message)
    return json({ error: message, checked: 0, failed: queued.length, results: queued.map(id => ({ student_id: id, status: 'error', error: message })), skipped })
  }
})

/** Один ученик: страницы, промпт, модель, проверка ответа, запись. */
async function checkStudent(
  admin: Admin,
  ai: { apiKey: string; baseUrl: string; model: string },
  ctx: {
    examId: string
    studentId: string
    title: string
    tasks: Part2Task[]
    variant: Variant | null
    variantCount: number
    solution: FileText
    criteria: FileText
    photos: Photo[]
    render: { left: number }
  },
): Promise<StudentResult> {
  const { pages, skipped } = await collectPages(admin, ctx.photos, ctx.render)
  if (pages.length === 0) {
    throw new Error(skipped.length > 0
      ? `Не удалось прочитать ни одной страницы: ${skipped.join('; ')}`
      : 'Фото второй части нет — проверять нечего')
  }

  const prompt = buildPrompt({
    examTitle: ctx.title,
    variantPosition: ctx.variant?.position ?? null,
    variantLabel: ctx.variant?.label ?? null,
    variantCount: ctx.variantCount,
    tasks: ctx.tasks,
    solutionText: ctx.solution.text,
    solutionTruncated: ctx.solution.truncated,
    criteriaText: ctx.criteria.text,
    criteriaTruncated: ctx.criteria.truncated,
    pageCount: pages.length,
  })
  const content: Record<string, unknown>[] = [{ type: 'text', text: prompt }]
  for (const [index, item] of pages.entries()) {
    content.push({ type: 'text', text: `Страница #${index + 1}: ${item.label}` })
    content.push({ type: 'image_url', image_url: { url: `data:${item.mime};base64,${base64(item.bytes)}` } })
  }

  let response: Response
  try {
    response = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ai.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://alminion.ru',
        'X-Title': 'School Almiron',
      },
      body: JSON.stringify(chatRequestBody(ai.model, [{ role: 'user', content }])),
      signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`Модель не ответила за ${Math.round(MODEL_TIMEOUT_MS / 1000)} с — запустите проверку ещё раз`, { cause: err })
    }
    throw new Error(`Модель недоступна: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload?.error?.message ?? `HTTP ${response.status}`
    throw new Error(`Модель отказала: ${response.status} ${detail}`)
  }
  const text = extractText(payload)
  if (!text) throw new Error('Модель вернула пустой ответ')
  const parsed = parseJson(text)
  if (!parsed || !(Array.isArray(parsed.tasks) || Array.isArray(parsed.suggestions))) {
    throw new Error(`Не удалось разобрать ответ модели: ${text.slice(0, 200)}`)
  }

  const sentPages: SentPage[] = pages.map(p => ({ photo_id: p.photo.id, page: p.page, label: p.label }))
  const { rows, missing, dropped } = parseSuggestions(parsed, ctx.tasks, sentPages)
  if (dropped.length) console.log(`suggestions: отброшено ${dropped.length} —`, { dropped, exam: ctx.examId, student: ctx.studentId })

  const now = new Date().toISOString()
  if (rows.length > 0) {
    const { error } = await admin.from('mock_exam_ai_suggestions').upsert(
      rows.map(r => ({ ...r, mock_exam_id: ctx.examId, student_id: ctx.studentId, model: ai.model, created_at: now })),
      { onConflict: 'mock_exam_id,student_id,task_number' },
    )
    if (error) throw new Error(`Не удалось сохранить предложения: ${error.message}`)
  }
  // Предложения прошлой проверки по номерам, которых в новом ответе нет, —
  // убираем: на экране должен стоять один, последний ответ модели.
  const stale = admin.from('mock_exam_ai_suggestions').delete().eq('mock_exam_id', ctx.examId).eq('student_id', ctx.studentId)
  const { error: staleError } = rows.length > 0
    ? await stale.not('task_number', 'in', `(${rows.map(r => r.task_number).join(',')})`)
    : await stale
  if (staleError) console.log('suggestions: старые не убраны —', staleError.message)

  const usage = payload?.usage ?? {}
  const { error: doneError } = await admin.from('mock_exam_ai_runs').update({
    status: 'done',
    last_error: null,
    note: runNote({
      solution: ctx.solution.state, criteria: ctx.criteria.state,
      solutionError: ctx.solution.error, criteriaError: ctx.criteria.error,
      skipped, missing, dropped,
    }),
    model: ai.model,
    finished_at: new Date().toISOString(),
    input_tokens: intOrNull(usage.prompt_tokens),
    output_tokens: intOrNull(usage.completion_tokens),
  }).eq('mock_exam_id', ctx.examId).eq('student_id', ctx.studentId)
  if (doneError) throw new Error(`Не удалось сохранить результат проверки: ${doneError.message}`)

  return { student_id: ctx.studentId, status: 'done', suggestions: rows.length }
}

interface PageImage {
  photo: Photo
  page: number
  mime: string
  bytes: Uint8Array
  label: string
}

/** Фото и PDF ученика → страницы модели. Пропущенное — словами, в приписку. */
async function collectPages(admin: Admin, photos: Photo[], render: { left: number }): Promise<{ pages: PageImage[]; skipped: string[] }> {
  const pages: PageImage[] = []
  const skipped: string[] = []
  let total = 0
  for (const [i, photo] of photos.entries()) {
    const name = `Фото ${i + 1}`
    const mime = photo.mime_type ?? guessMime(photo)
    const isPdf = PDF_MIME.test(mime)
    if (!isPdf && !IMAGE_MIME.test(mime)) { skipped.push(`${name} — не фото и не PDF`); continue }
    if (pages.length >= MAX_PAGES) { skipped.push(`${name} — не поместилось в лимит ${MAX_PAGES} страниц`); continue }
    if (isPdf && render.left <= 0) { skipped.push(`${name} (PDF) — не хватило времени рендера`); continue }

    const { data: blob, error } = await admin.storage.from(BUCKET).download(photo.storage_path)
    if (error || !blob) { skipped.push(`${name} — файл не скачался`); continue }
    const raw = new Uint8Array(await blob.arrayBuffer())

    if (!isPdf) {
      if (total + raw.length > MAX_INLINE_BYTES) { skipped.push(`${name} — слишком большой файл`); continue }
      total += raw.length
      pages.push({ photo, page: 1, mime, bytes: raw, label: name })
      continue
    }
    const startedAt = Date.now()
    try {
      const rendered = await renderPdfPages(raw, MAX_PAGES - pages.length, render.left, JPEG_QUALITY)
      render.left -= rendered.spentMs
      if (rendered.total > rendered.images.length) skipped.push(`${name} (PDF) — взяты страницы 1–${rendered.images.length} из ${rendered.total}`)
      for (const image of rendered.images) {
        if (total + image.bytes.length > MAX_INLINE_BYTES) { skipped.push(`${name}, стр. ${image.page} — не поместилась в лимит размера`); break }
        total += image.bytes.length
        pages.push({ photo, page: image.page, mime: 'image/jpeg', bytes: image.bytes, label: `${name}, стр. ${image.page}` })
      }
    } catch (err) {
      render.left -= Date.now() - startedAt
      skipped.push(`${name} (PDF) — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { pages, skipped }
}

/**
 * Текст PDF (решение или критерии варианта) для промпта: кэш по пути и
 * размеру → бесплатный движок → платный, как loadMaterialText в
 * check-homework-ai. Провал — «проверим без него», а не падение проверки.
 */
async function loadFileText(
  admin: Admin,
  ai: { apiKey: string; baseUrl: string; parseModel: string },
  path: string,
  label: string,
  limit: number,
): Promise<FileText> {
  const failed = (error: string): FileText => ({ text: '', truncated: false, state: 'failed', error })
  if (!path.toLowerCase().endsWith('.pdf')) return failed(`${label}: файл не PDF — текст не разбирали`)

  const { data: blob } = await admin.storage.from(BUCKET).download(path)
  if (!blob) return failed(`${label}: файл не скачался из хранилища`)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length > MAX_REFERENCE_BYTES) {
    return failed(`${label}: файл больше ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)} МБ — не разбирали`)
  }

  const { data: cached } = await admin.from('mock_exam_file_text_cache')
    .select('text, size_bytes').eq('storage_path', path).maybeSingle()
  const c = cached as { text?: unknown; size_bytes?: unknown } | null
  if (c && Number(c.size_bytes) === bytes.length && String(c.text ?? '').trim()) {
    return { ...truncateReference(String(c.text), limit), state: 'used', error: null }
  }

  const dataUrl = `data:application/pdf;base64,${base64(bytes)}`
  const fileName = path.split('/').pop() || `${label}.pdf`
  const reasons: string[] = []
  let engine: ParseEngine | null = nextEngine(null)
  while (engine) {
    try {
      const parsed = await parsePdf(ai, { dataUrl, fileName, engine })
      if (parsed.text && isParseUsable(parsed.text, parsed.pages)) {
        await admin.from('mock_exam_file_text_cache').upsert({
          storage_path: path, size_bytes: bytes.length, engine, text: parsed.text, chars: parsed.text.length,
          created_at: new Date().toISOString(),
        })
        return { ...truncateReference(parsed.text, limit), state: 'used', error: null }
      }
      reasons.push(tooLittleTextReason(engine, parsed.text, parsed.pages))
    } catch (err) {
      reasons.push(`движок ${engine}: ${err instanceof Error ? err.message : String(err)}`)
    }
    engine = nextEngine(engine)
  }
  return failed(describeParseFailure(reasons, label))
}

/**
 * Критерии варианта ТЕКСТОМ, без PDF (§222b.1): строка кэша с ключом
 * `criteria-text:<id варианта>` в mock_exam_file_text_cache (таблица только
 * для сервисного ключа — ученик критерии не увидит). Так критерии кладёт
 * оркестратор, когда файла нет. PDF в criteria_path главнее.
 */
async function criteriaTextOf(admin: Admin, variantId: string | null, limit: number): Promise<FileText> {
  const none: FileText = { text: '', truncated: false, state: 'missing', error: null }
  if (!variantId) return none
  const { data } = await admin.from('mock_exam_file_text_cache')
    .select('text').eq('storage_path', `criteria-text:${variantId}`).maybeSingle()
  const text = String((data as { text?: unknown } | null)?.text ?? '').trim()
  if (!text) return none
  return { ...truncateReference(text, limit), state: 'used', error: null }
}

function guessMime(file:{ storage_path: string; file_name: string | null }): string {
  const name = (file.file_name ?? file.storage_path).toLowerCase()
  if (name.endsWith('.pdf')) return 'application/pdf'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.heic')) return 'image/heic'
  if (name.endsWith('.heif')) return 'image/heif'
  return 'image/jpeg'
}

function intOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
