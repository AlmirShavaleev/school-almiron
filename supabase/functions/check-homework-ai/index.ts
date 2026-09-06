// Черновик ИИ-проверки домашней работы.
//
// См. PROJECT_STATE §§32-33, 45: права проверяет база через
// topic_homework_ai_request_check, дальше работаем сервисным ключом;
// результат — ЧЕРНОВИК, ученик его не видит; ошибки кладём в
// job.last_error, потому что только оттуда преподаватель узнает причину.
//
// ПРОВАЙДЕР. Запрос идёт в OpenAI-совместимый /chat/completions. Модель здесь
// расходник: сменить её — AI_MODEL, сменить поставщика — AI_BASE_URL, ни то
// ни другое не требует передеплоя. По умолчанию Qwen3-VL через OpenRouter.
//
// Координаты рамок — доли страницы (0..1), начало отсчёта в левом верхнем
// углу. Так их ждёт и аннотатор (MIN_REGION_SIZE = 0.015), и CHECK-ограничения
// в topic_homework_ai_findings. Пиксели сюда класть нельзя: страницы
// масштабируются под ширину экрана.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  MAX_REFERENCE_BYTES,
  extractAnnotationText,
  isParseUsable,
  nextEngine,
  referencePromptBlock,
  truncateReference,
  type ParseEngine,
  type ReferenceState,
} from './reference.ts'

const ATTEMPTS_BUCKET = 'topic-homework-attempts'
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'qwen/qwen3-vl-235b-a22b-instruct'
const MAX_INLINE_BYTES = 15 * 1024 * 1024
const MAX_FINDINGS = 12
const CATEGORIES = ['comment', 'calc', 'logic', 'format', 'praise'] as const
const IMAGE_MIME = /^image\/(png|jpe?g|webp|heic|heif)$/i
const PDF_MIME = /^application\/pdf$/i
/** Страниц на ВСЮ работу за одну проверку; остаток — текстом в разбор. */
const MAX_PAGES = 10
/** 150 DPI: рукописный текст читается уверенно, страница остаётся ~200 кБ. */
const RENDER_DPI = 150
const MAX_RENDER_WIDTH = 1600
const JPEG_QUALITY = 80
/**
 * Потолок по ПРОЦЕССОРНОМУ времени, а не по страницам. У edge-функции жёсткий
 * лимит 2 с CPU на запрос, за ним воркер убивают с кодом 546 — задача осталась
 * бы висеть в `processing`, а преподаватель смотрел бы на вечный спиннер.
 * Замер на настоящих работах (машина разработчика): страница A4 при 150 DPI —
 * около 80 мс на рендер плюс 140 мс на JPEG. В проде дороже: с бюджетом 1500 мс
 * работа на 41 страницу всё равно ложилась в 546. Отсюда 700 мс — это примерно
 * три-четыре страницы плотного скана, и остаётся запас на base64, который тоже
 * считает процессор. Недобранные страницы честно уезжают в приписку к разбору.
 *
 * Число подобрано замером, а не из общих соображений: если менять — проверять
 * на pub_4656538.pdf (41 страница), это самая тяжёлая работа из известных.
 */
const RENDER_BUDGET_MS = 1100

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

/**
 * Страница, уходящая модели. Ключевое поле — `page`: у фотографии всегда 1, у
 * PDF это НАСТОЯЩИЙ номер страницы внутри файла. Аннотатор рисует каждую
 * страницу PDF отдельным слоем и ищет пометки по паре (файл, страница), так что
 * рамка ложится туда же, где модель её увидела, без пересчёта координат.
 */
interface PageImage {
  file: AttemptFile
  page: number
  mime: string
  bytes: Uint8Array
  label: string
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

    // Эталон. До §135 здесь стояло `.eq('kind','text')`, а на проде ВСЕ 844
    // решения рубрики `solution` — PDF-файлы: эталон не доезжал до модели ни
    // разу, и она сверяла ученика со своим же решением.
    // Любой сбой эталона — это «проверим без эталона», а не падение всей
    // проверки: за всё время было восемь попыток, ещё одна причина падать нам
    // не нужна (требование владельца 16.08).
    let reference: ReferenceResult
    try {
      reference = await loadReference(admin, topicId, { apiKey, baseUrl })
    } catch (err) {
      reference = {
        text: '', truncated: false, state: 'failed', engine: null, cached: false,
        error: `Эталон не получен: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      }
    }
    const solutionText = reference.text

    // Шаг 3. Страницы работы.
    const { data: rawFiles } = await admin
      .from('topic_homework_attempt_files')
      .select('id, storage_path, file_name, mime_type, position')
      .eq('attempt_id', attemptId)
      .order('position', { ascending: true })

    const all = (rawFiles ?? []) as AttemptFile[]
    if (all.length === 0) throw new Error('В работе нет файлов')

    const usable = all.filter(f => {
      const mime = f.mime_type ?? guessMime(f)
      return IMAGE_MIME.test(mime) || PDF_MIME.test(mime)
    })
    if (usable.length === 0) {
      throw new Error('В работе нет ни фотографий, ни PDF — проверять нечего')
    }

    const { pages: sent, skipped } = await collectPages(admin, usable)
    // Причину НЕЛЬЗЯ терять: без неё в панели остаётся «ИИ не смог» без единого
    // слова о том, что чинить. Один раз уже наступили — три работы упали, а
    // почему, пришлось выяснять запросами к базе.
    if (sent.length === 0) {
      throw new Error(skipped.length > 0
        ? `Не удалось прочитать ни одной страницы: ${skipped.join('; ')}`
        : 'Не удалось прочитать ни одной страницы работы')
    }

    const content: Record<string, unknown>[] = []
    for (const [index, item] of sent.entries()) {
      content.push({ type: 'text', text: `Страница #${index + 1}: ${item.label}` })
      content.push({ type: 'image_url', image_url: { url: `data:${item.mime};base64,${base64(item.bytes)}` } })
    }

    // Шаг 4. Запрос к модели.
    const prompt = buildPrompt({
      title: homework?.title ?? 'Домашнее задание',
      instructions: homework?.instructions ?? '',
      solutionText,
      referenceTruncated: reference.truncated,
      gradeScale,
      pageCount: sent.length,
    })

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
      const target = sent[Number.isFinite(index) ? index - 1 : -1]
      if (!target) continue

      const rect = raw?.rect ?? {}
      const x = clamp01(rect.x)
      const y = clamp01(rect.y)
      let w = clamp01(rect.w)
      let h = clamp01(rect.h)
      if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) continue
      w = Math.min(w, 1 - x)
      h = Math.min(h, 1 - y)
      if (w <= 0 || h <= 0) continue

      const note = String(raw?.text ?? '').trim().slice(0, 2000)
      if (!note) continue

      const category: Category = CATEGORIES.includes(raw?.category) ? raw.category : 'comment'

      rows.push({
        job_id: jobId,
        file_id: target.file.id,
        // Настоящий номер страницы: у фотографии 1, у PDF — та страница,
        // картинку которой мы отрисовали и показали модели.
        page: target.page,
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
      // Без эталона потолок доверия — medium: модель сверяла работу со своим
      // собственным решением, а не с авторским.
      confidence: capConfidence(parsed.confidence, reference.state),
      reference_state: reference.state,
      reference_chars: reference.text.length || null,
      // Пропущенные страницы дописываем в разбор: преподаватель должен видеть,
      // что модель смотрела не всю работу, иначе «замечаний нет» соврёт.
      summary: withReferenceNote(
        withSkipNote(String(parsed.summary ?? ''), skipped),
        reference,
      ).slice(0, 8000) || null,
      // Причина «эталона нет» не теряется: преподаватель видит её в разборе,
      // диагностика — здесь. Проверка при этом прошла, статус done.
      last_error: reference.error,
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
 * Страницы работы в том виде, в каком их понимает модель, — картинками.
 *
 * Фотография проходит как есть. PDF рендерится здесь же, на сервере: в
 * OpenAI-совместимом протоколе PDF не передашь как image_url, а разбор его в
 * текст убил бы координаты — рамку стало бы некуда ставить. Рендерим PDFium
 * (WASM), кодируем в JPEG.
 *
 * Почему на сервере, а не при загрузке учеником: так чинятся и уже сданные
 * работы, телефон ученика ничего не считает, и — главное — не появляется
 * второй копии работы, которая может разъехаться с оригиналом.
 */
async function collectPages(
  admin: ReturnType<typeof createClient>,
  files: AttemptFile[],
): Promise<{ pages: PageImage[]; skipped: string[] }> {
  const pages: PageImage[] = []
  const skipped: string[] = []
  let total = 0

  const budgetLeft = () => MAX_PAGES - pages.length

  for (const file of files) {
    if (budgetLeft() <= 0) {
      skipped.push(`${nameOf(file)} — не поместился в лимит ${MAX_PAGES} страниц`)
      continue
    }

    const { data: blob, error: dlError } = await admin.storage.from(ATTEMPTS_BUCKET).download(file.storage_path)
    if (dlError || !blob) {
      skipped.push(`${nameOf(file)} — файл не скачался`)
      continue
    }
    const raw = new Uint8Array(await blob.arrayBuffer())
    const mime = file.mime_type ?? guessMime(file)

    if (!PDF_MIME.test(mime)) {
      if (total + raw.length > MAX_INLINE_BYTES) {
        skipped.push(`${nameOf(file)} — слишком большой файл`)
        continue
      }
      total += raw.length
      pages.push({ file, page: 1, mime, bytes: raw, label: nameOf(file) })
      continue
    }

    try {
      const rendered = await renderPdfPages(raw, budgetLeft())
      if (rendered.total > rendered.images.length) {
        skipped.push(`${nameOf(file)} — взяты страницы 1–${rendered.images.length} из ${rendered.total}`)
      }
      for (const image of rendered.images) {
        if (total + image.bytes.length > MAX_INLINE_BYTES) {
          skipped.push(`${nameOf(file)}, стр. ${image.page} — не поместилась в лимит размера`)
          break
        }
        total += image.bytes.length
        pages.push({
          file,
          page: image.page,
          mime: 'image/jpeg',
          bytes: image.bytes,
          label: `${nameOf(file)}, стр. ${image.page}`,
        })
      }
    } catch (err) {
      // Один битый PDF не должен отменять проверку остальных страниц.
      skipped.push(`${nameOf(file)} — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { pages, skipped }
}

/**
 * PDF → JPEG постранично. PDFium отдаёт сырой BGRA, кодировщик ждёт RGBA —
 * поэтому байты переставляются на месте, без выделения второго буфера
 * (страница A4 при 150 DPI — это ~8 МБ пикселей, лишняя копия тут дорога).
 *
 * Импорт динамический: работа из одних фотографий не должна платить за
 * загрузку WASM-движка.
 */
async function renderPdfPages(
  bytes: Uint8Array,
  limit: number,
): Promise<{ images: { page: number; bytes: Uint8Array }[]; total: number }> {
  // Импорт и инициализацию разделяем: «пакет не подтянулся» и «wasm не завёлся»
  // чинятся по-разному, и в last_error должно быть видно, что именно случилось.
  //
  // Специферы ЛИТЕРАЛЬНЫЕ и только такие. Supabase собирает функцию в eszip на
  // этапе деплоя, статически обходя импорты; import(переменная) он не разбирает,
  // и пакет просто не попадает в сборку — а в рантайме тянуть его уже неоткуда.
  // Ровно на этом сгорели три работы: `Module not found` вместо рендера.
  //
  // Кодировщик — jpeg-js, и это не вопрос вкуса. imagescript при загрузке
  // требует нативный аддон (`codecs/node/<arch>-<platform>.node`), а wasm-ветка
  // у него заглушена `throw new Error('todo!')`. В Deno на машине разработчика
  // napi есть, и локальная проверка проходит; в Edge Runtime его нет, и работа
  // падает с «unsupported arch/platform: Not supported». jpeg-js — чистый JS
  // без зависимостей: платим процессором (см. RENDER_BUDGET_MS), зато он
  // заведётся везде.
  let pdfium: { PDFiumLibrary: { init: (o?: Record<string, unknown>) => Promise<any> } }
  let encodeJpeg: (image: { data: Uint8Array; width: number; height: number }, quality: number)
    => { data: Uint8Array }
  try {
    const [a, b] = await Promise.all([
      import('npm:@hyzyla/pdfium@2.1.13'),
      import('npm:jpeg-js@0.4.4'),
    ])
    pdfium = a as any
    encodeJpeg = ((b as any).default ?? b).encode
  } catch (err) {
    throw new Error(`не подтянулись пакеты для рендера PDF: ${err instanceof Error ? err.message : String(err)}`)
  }

  const library = await initPdfium(pdfium.PDFiumLibrary)
  let document: Awaited<ReturnType<typeof library.loadDocument>> | null = null
  try {
    document = await library.loadDocument(bytes)
    const total = document.getPageCount()
    const images: { page: number; bytes: Uint8Array }[] = []

    const startedAt = Date.now()
    let index = 0
    for (const page of document.pages()) {
      if (images.length >= limit) break
      // Хотя бы одна страница должна уехать модели, даже если бюджет уже вышел:
      // разбор по первой странице полезнее, чем «ИИ не смог».
      if (images.length > 0 && Date.now() - startedAt > RENDER_BUDGET_MS) break
      index += 1
      const { originalWidth } = page.getOriginalSize()
      const scale = Math.min(RENDER_DPI / 72, MAX_RENDER_WIDTH / Math.max(1, originalWidth))
      const result = await page.render({ scale, render: 'bitmap' })

      const data = result.data
      for (let p = 0; p < data.length; p += 4) {
        const blue = data[p]
        data[p] = data[p + 2]
        data[p + 2] = blue
      }

      const encoded = encodeJpeg({ data, width: result.width, height: result.height }, JPEG_QUALITY)
      images.push({ page: index, bytes: new Uint8Array(encoded.data) })
    }

    return { images, total }
  } finally {
    document?.destroy()
    library.destroy()
  }
}

/**
 * Движок PDFium сам находит свой .wasm рядом с пакетом — это работает, когда в
 * рантайме файлы npm-пакета лежат на диске. Если сборка функции их не донесла,
 * тянем бинарник с CDN и держим в памяти инстанса: 4 МБ на холодный старт один
 * раз, а не на каждую проверку. Порядок именно такой — сначала бесплатный путь.
 */
let wasmBinary: Uint8Array | null = null
const PDFIUM_WASM_URL = 'https://cdn.jsdelivr.net/npm/@hyzyla/pdfium@2.1.13/dist/pdfium.wasm'

async function initPdfium(PDFiumLibrary: { init: (o?: Record<string, unknown>) => Promise<any> }) {
  let localError = ''
  if (!wasmBinary) {
    try {
      return await PDFiumLibrary.init()
    } catch (err) {
      localError = String(err).slice(0, 150)
      console.log('pdfium: локальный wasm недоступен, беру с CDN —', localError)
      const response = await fetch(PDFIUM_WASM_URL)
      if (!response.ok) throw new Error(`движок PDF не скачался (HTTP ${response.status}); локально: ${localError}`)
      wasmBinary = new Uint8Array(await response.arrayBuffer())
    }
  }
  try {
    return await PDFiumLibrary.init({ wasmBinary, disableBase64Warning: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`движок PDF не запустился: ${message}${localError ? ` (локально: ${localError})` : ''}`)
  }
}

function nameOf(file: AttemptFile): string {
  return file.file_name ?? file.storage_path.split('/').pop() ?? 'без имени'
}

/**
 * Приписка про эталон. Преподаватель обязан понимать, чему верит: проверка без
 * авторского решения — другой уровень доверия, и молчать об этом нельзя.
 */
function withReferenceNote(summary: string, reference: ReferenceResult): string {
  if (reference.state === 'used') return summary
  const note = reference.state === 'failed'
    ? `Проверено без эталона: ${reference.error ?? 'авторское решение не удалось прочитать'}.`
    : 'Проверено без эталона: у темы нет авторского решения.'
  return summary ? `${summary}\n\n${note}` : note
}

/** Приписка о непроверенных страницах — в конец разбора, отдельным абзацем. */
function withSkipNote(summary: string, skipped: string[]): string {
  if (skipped.length === 0) return summary
  const note = ['Проверено не всё:', ...skipped.map(s => `— ${s}`)].join('\n')
  return summary ? `${summary}\n\n${note}` : note
}

/** Материалы решения лежат в приватном бакете тем; у старых — в легаси-бакете. */
const MATERIAL_BUCKETS = ['topic-materials', 'course-materials'] as const

/**
 * Модель для РАЗБОРА PDF. Нам от неё не нужно ни слова: текст приходит в
 * `file_annotations`, поэтому просим `max_tokens: 1`. Отдельная переменная
 * позволяет владельцу поставить самую дешёвую текстовую модель, не трогая
 * модель проверки и не передеплоивая функцию.
 */
const parseModelOf = () => Deno.env.get('AI_PARSE_MODEL') || Deno.env.get('AI_MODEL') || DEFAULT_MODEL

interface ReferenceResult {
  text: string
  truncated: boolean
  state: ReferenceState
  /** Причина, по которой эталона нет. Уходит в разбор и в last_error. */
  error: string | null
  engine: ParseEngine | null
  /** Взяли из кэша, а не разбирали заново. */
  cached: boolean
}

const NO_REFERENCE = (state: ReferenceState, error: string | null = null): ReferenceResult =>
  ({ text: '', truncated: false, state, error, engine: null, cached: false })

/**
 * Авторское решение темы для промпта.
 *
 * Берём ТОЛЬКО рубрику `solution` — это решение домашней работы. `task_solution`
 * (решения задач урока) не трогаем: подсунуть разбор урока вместо разбора ДЗ
 * хуже, чем не дать ничего.
 *
 * Провал разбора НЕ валит проверку: возвращаем `state: 'failed'`, работа
 * проверяется без эталона. Ещё одна причина падать нам не нужна — за всё время
 * было восемь попыток проверки.
 */
async function loadReference(
  admin: ReturnType<typeof createClient>,
  topicId: string | null,
  ai: { apiKey: string; baseUrl: string },
): Promise<ReferenceResult> {
  if (!topicId) return NO_REFERENCE('missing')

  const { data: materials } = await admin
    .from('topic_material_items')
    .select('id, title, content, kind, storage_path, size_bytes, mime_type')
    .eq('topic_id', topicId)
    .eq('section', 'solution')
    .order('position', { ascending: true })

  const rows = (materials ?? []) as Record<string, any>[]
  if (rows.length === 0) return NO_REFERENCE('missing')

  // Текстовые материалы, если они когда-нибудь появятся, — самый дешёвый путь.
  const textual = rows
    .filter(m => m.kind === 'text')
    .map(m => [m.title, m.content].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (textual) {
    const block = truncateReference(textual)
    return { ...block, state: 'used', error: null, engine: null, cached: true }
  }

  const pdf = rows.find(m => m.storage_path && (m.mime_type === 'application/pdf'
    || String(m.storage_path).toLowerCase().endsWith('.pdf')))
  if (!pdf) return NO_REFERENCE('missing')

  // 1. Кэш. Файл могли заменить, оставив ту же строку материала, — сверяем
  // путь и размер.
  const { data: cached } = await admin
    .from('topic_material_text_cache')
    .select('text, storage_path, size_bytes, engine')
    .eq('material_id', pdf.id)
    .maybeSingle()

  if (
    cached
    && cached.storage_path === pdf.storage_path
    && Number(cached.size_bytes ?? 0) === Number(pdf.size_bytes ?? 0)
  ) {
    const block = truncateReference(String(cached.text ?? ''))
    return { ...block, state: 'used', error: null, engine: cached.engine as ParseEngine, cached: true }
  }

  if (Number(pdf.size_bytes ?? 0) > MAX_REFERENCE_BYTES) {
    return NO_REFERENCE(
      'failed',
      `Авторское решение больше ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)} МБ — не разбирали`,
    )
  }

  // 2. Файл из приватного бакета.
  let bytes: Uint8Array | null = null
  for (const bucket of MATERIAL_BUCKETS) {
    const { data } = await admin.storage.from(bucket).download(pdf.storage_path)
    if (data) { bytes = new Uint8Array(await data.arrayBuffer()); break }
  }
  if (!bytes) return NO_REFERENCE('failed', 'Файл авторского решения не скачался из хранилища')

  // 3. Разбор: сначала бесплатный движок, платный — только если тот не смог.
  const dataUrl = `data:application/pdf;base64,${base64(bytes)}`
  const fileName = String(pdf.storage_path).split('/').pop() || 'solution.pdf'
  let engine = nextEngine(null)
  let lastReason = 'разбор PDF не дал текста'

  while (engine) {
    try {
      const parsed = await parsePdf(ai, { dataUrl, fileName, engine })
      if (parsed.text && isParseUsable(parsed.text, parsed.pages)) {
        await admin.from('topic_material_text_cache').upsert({
          material_id: pdf.id,
          storage_path: pdf.storage_path,
          size_bytes: pdf.size_bytes ?? null,
          engine,
          text: parsed.text,
          chars: parsed.text.length,
          created_at: new Date().toISOString(),
        })
        const block = truncateReference(parsed.text)
        return { ...block, state: 'used', error: null, engine, cached: false }
      }
      // Молча принятый мусор — единственный способ этой работой сделать хуже,
      // чем было: каша легла бы в кэш как эталон, и модель валила бы ученика
      // за расхождение с ней.
      lastReason = `движок ${engine} вернул слишком мало текста`
    } catch (err) {
      lastReason = `движок ${engine}: ${err instanceof Error ? err.message : String(err)}`
    }
    engine = nextEngine(engine)
  }

  return NO_REFERENCE('failed', `Не удалось распознать авторское решение: ${lastReason}`)
}

/**
 * Один запрос к поставщику ради РАЗБОРА файла.
 *
 * Текст берём из `file_annotations` ответа — это дословно разобранное
 * содержимое. Пересказ модели брать нельзя: она сокращает и «поправляет»
 * формулы, а эталон обязан совпадать с тем, что написал учитель. Аннотации
 * приходят и в ветке ошибки инференса, поэтому даже отказ модели отдаёт текст.
 */
async function parsePdf(
  ai: { apiKey: string; baseUrl: string },
  file: { dataUrl: string; fileName: string; engine: ParseEngine },
): Promise<{ text: string; pages: number }> {
  const response = await fetch(`${ai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ai.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://alminion.ru',
      'X-Title': 'School Almiron',
    },
    body: JSON.stringify({
      model: parseModelOf(),
      // Ответ модели не нужен вовсе — платим только за разбор и вход.
      max_tokens: 1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'file', file: { filename: file.fileName, file_data: file.dataUrl } },
        ],
      }],
      // Умолчание у поставщика — ПЛАТНЫЙ mistral-ocr, поэтому движок всегда
      // указываем явно.
      plugins: [{ id: 'file-parser', pdf: { engine: file.engine } }],
    }),
  })

  const payload = await response.json().catch(() => null)
  const parsed = extractAnnotationText(payload)
  if (parsed.text) return parsed
  if (!response.ok) {
    const detail = payload?.error?.message ?? `HTTP ${response.status}`
    throw new Error(String(detail).slice(0, 200))
  }
  return parsed
}

/** Без эталона доверие не может быть высоким — модель сверяла работу с собой. */
function capConfidence(raw: unknown, state: ReferenceState): string | null {
  const value = ['high', 'medium', 'low'].includes(raw as string) ? (raw as string) : null
  if (!value) return null
  if (state === 'used') return value
  return value === 'high' ? 'medium' : value
}

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
  /** Эталон показан не целиком — модель обязана знать об этом. */
  referenceTruncated: boolean
  gradeScale: string | null
  pageCount: number
}): string {
  const scale = ctx.gradeScale === 'five'
    ? 'Оценка по пятибалльной шкале: целое число от 2 до 5.'
    : ctx.gradeScale === 'hundred'
      ? 'Оценка по стобалльной шкале: целое число от 0 до 100.'
      : 'Шкала оценки не задана — предложи балл от 0 до 100.'

  return [
    'Ты опытный учитель физики и математики. Проверяешь рукописную работу ученика по фотографиям и сканам.',
    '',
    `ЗАДАНИЕ: ${ctx.title}`,
    ctx.instructions ? `УСЛОВИЕ: ${ctx.instructions}` : '',
    ctx.solutionText
      ? referencePromptBlock({ text: ctx.solutionText, truncated: ctx.referenceTruncated })
      : 'АВТОРСКОГО РЕШЕНИЯ НЕТ: сверять не с чем, оценивай по существу и не завышай уверенность.',
    '',
    'ПОРЯДОК РАБОТЫ:',
    '1. Сначала реши задачу сам, не подглядывая в ход ученика.',
    '2. Потом прочитай работу ученика и сравни со своим решением.',
    // Ради этой строки всё и затевалось: без неё модель считает эталоном
    // СВОЁ решение и снижает балл за любое расхождение с ним.
    ctx.solutionText
      ? '3. Если твой ответ расходится с авторским решением — прав автор, а не ты. Считай своё решение ошибочным и перепроверь.'
      : '',
    '4. Отметь конкретные места: ошибки в вычислениях, логике — и удачные ходы.',
    '',
    `Тебе передано страниц: ${ctx.pageCount}. Перед каждой идёт строка «Страница #N: имя». Многостраничный PDF разложен на страницы, у каждой свой номер.`,
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
    // Балл раньше брался из воздуха: методики в промпте не было вовсе, и
    // модель ставила 68 там, где сама насчитала 8 верных заданий из 18.
    // Теперь способ подсчёта задан явно.
    '- КАК СЧИТАТЬ БАЛЛ: посчитай, сколько заданий решено верно, и раздели на общее число заданий.',
    '- Эта доля и есть балл: по стобалльной шкале — доля в процентах; по пятибалльной — та же доля, округлённая ВВЕРХ до целого от 2 до 5.',
    '- Задание с верным результатом и верным ходом засчитывается ПОЛНОСТЬЮ, даже если запись неаккуратна.',
    '- Замечания по оформлению (category "format") на балл НЕ влияют: это советы. Балл снижают только неверный результат и неверный ход.',
    '- Если все задания решены верно, а замечания только по оформлению — ставь высший балл.',
    '- Другой верный способ решения — не ошибка. Пришёл к верному результату верным рассуждением — полный зачёт, а красивый ход отметь как "praise".',
    '- Не разобрал почерк — не ошибка: дай "comment" и понизь confidence, но не считай решение неверным.',
    '- В спорном случае решай в пользу ученика: твой разбор — предложение, вердикт всё равно ставит преподаватель.',
    '- confidence: "high" — работа читается уверенно и решение однозначно; "medium" — есть сомнения; "low" — почерк плохо разбирается или задание непонятно.',
    '- Если работу невозможно прочитать: "readable": false, "findings": [], "confidence": "low".',
    '- page_index — номер страницы из строки «Страница #N», начиная с 1.',
    '- КООРДИНАТЫ — ДОЛИ СТРАНИЦЫ ОТ 0 ДО 1, начало отсчёта в левом верхнем углу. Не пиксели.',
    '- Координаты считай относительно ТОЙ страницы, на которую ставишь рамку, а не всей работы.',
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
