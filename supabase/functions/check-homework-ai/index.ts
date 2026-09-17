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
  REFERENCE_CHAR_LIMIT,
  WORKSHEET_CHAR_LIMIT,
  WORKSHEET_SECTION,
  describeParseFailure,
  extractAnnotationText,
  isParseUsable,
  nextEngine,
  referencePromptBlock,
  tooLittleTextReason,
  truncateReference,
  worksheetPromptBlock,
  type ParseEngine,
  type ReferenceState,
} from './reference.ts'
import {
  CATEGORIES,
  MAX_FINDINGS,
  MAX_FORMAT_FINDINGS,
  MAX_PRAISE_FINDINGS,
  computeScore,
  deriveConfidence,
  filterFindings,
  isPartialCheck,
  parseTasks,
  planRenderFile,
  renderDensityFor,
  renderPageCostMs,
  withLoweredNote,
  withUncheckedNote,
  type Category,
  type FindingDraft,
} from './findings.ts'

const ATTEMPTS_BUCKET = 'topic-homework-attempts'
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'qwen/qwen3-vl-235b-a22b-instruct'
const MAX_INLINE_BYTES = 15 * 1024 * 1024
const IMAGE_MIME = /^image\/(png|jpe?g|webp|heic|heif)$/i
const PDF_MIME = /^application\/pdf$/i
/**
 * Страниц на ВСЮ работу за одну проверку; остаток — текстом в разбор и, с
 * §189, гашением балла.
 *
 * Было 10 и резало обычные работы: рабочий лист на 11–16 страниц — норма, а
 * первый живой прогон v17 дошёл до модели восемью страницами из одиннадцати.
 * Потолок поднят до 20 (вход растёт примерно втрое — см. отчёт board/042).
 *
 * ВАЖНО: для PDF этот потолок редко срабатывает первым — раньше него
 * упирается RENDER_BUDGET_MS (процессорное время, ниже). Работа из фотографий
 * рендера не требует, и для неё 20 — настоящий предел.
 *
 * §193: с пониженной плотностью для длинных работ бюджет отдаёт около
 * 18 страниц, так что эти два предела наконец сошлись почти вплотную.
 */
const MAX_PAGES = 20
const JPEG_QUALITY = 80
/**
 * Потолок по ПРОЦЕССОРНОМУ времени, а не по страницам. У edge-функции жёсткий
 * лимит 2 с CPU на запрос, за ним воркер убивают с кодом 546 — задача осталась
 * бы висеть в `processing`, а преподаватель смотрел бы на вечный спиннер.
 * Недобранные страницы честно уезжают в приписку к разбору.
 *
 * История числа. 1500 уже стояло здесь и было опущено до 1100: работа на
 * 41 страницу всё равно ложилась в 546. §189, замер на проде: при 1100 мс
 * работа из 11 страниц дала 8 — около 140 мс на страницу при 150 DPI, и
 * 11 страниц потребовали бы ~1550 мс. ИМЕННО этот бюджет, а не MAX_PAGES,
 * обрезал первые живые прогоны.
 *
 * §193, почему 1500 теперь можно. Бюджет ограничивает не только сумму, но и
 * ПЕРЕБОР: проверка стоит перед страницей, поэтому цикл выходит за бюджет на
 * одну целую страницу. Раньше это была страница за 220 мс (150 DPI всегда),
 * теперь длинные работы рендерятся на 120/100 DPI (`renderDensityFor`), и
 * перебор стоит 90–110 мс, а суммарный base64 всех страниц стал меньше при
 * большем их числе. Худший случай по времени вырос с ~1260 до ~1580 мс, зато
 * работа из 11 страниц укладывается целиком (~1200 мс при 120 DPI).
 *
 * §196. Это бюджет на ВСЮ РАБОТУ, а не на файл. До §196 он отсчитывался заново
 * внутри `renderPdfPages`, то есть на каждый PDF: работа из трёх файлов стоила
 * до трёх бюджетов (4,5 с) при пределе 2 с CPU — гарантированный код 546 и
 * задача, навсегда зависшая в `processing`. Теперь бюджет делится между файлами
 * (`planRenderFile`): каждому достаётся остаток минус резерв на гарантийные
 * первые страницы следующих, а файл, которому не хватило и на одну страницу, не
 * открывается вовсе и честно называется в разборе. Худший случай перестал
 * зависеть от числа файлов: бюджет плюс одна страница перебора, ~1720 мс.
 *
 * ЧТО ПРОВЕРЯТЬ при следующем изменении — три вещи, в этом порядке:
 *  1) самая длинная известная работа (pub_4656538.pdf, 41 страница) не даёт
 *     код 546 и не виснет в `processing`;
 *  2) работа из НЕСКОЛЬКИХ PDF: каждый открытый файл отдал хотя бы одну
 *     страницу, непроверенные файлы названы в разборе, общее время рендера не
 *     выросло по сравнению с однофайловой работой;
 *  3) 11-страничная работа доезжает всеми 11 страницами (приписки
 *     «взяты страницы 1–N из M» в разборе быть не должно).
 */
const RENDER_BUDGET_MS = 1500

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
      reference = await loadMaterialText(admin, topicId, { apiKey, baseUrl }, SOLUTION_SPEC)
    } catch (err) {
      reference = {
        text: '', truncated: false, state: 'failed', engine: null, cached: false,
        error: `Эталон не получен: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      }
    }
    const solutionText = reference.text

    // §149.1. Условие ДЗ — рабочий лист. Поле `instructions` пустое почти везде,
    // и до этого модель узнавала состав заданий из решения, с обратной стороны.
    // Тот же путь и те же правила, что у эталона: разбор бесплатным движком,
    // кэш по материалу, провал — «проверим без условия», а не падение.
    let worksheet: ReferenceResult
    try {
      worksheet = await loadMaterialText(admin, topicId, { apiKey, baseUrl }, WORKSHEET_SPEC)
    } catch (err) {
      worksheet = {
        text: '', truncated: false, state: 'failed', engine: null, cached: false,
        error: `Условие не получено: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      }
    }

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
      worksheetText: worksheet.text,
      worksheetTruncated: worksheet.truncated,
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
        // §180. Таблица по заданиям удлиняет ответ: 20 строк — это ещё ~1,5 тыс.
        // токенов сверх находок. В выгрузке 15.09 выход был до 1,7 тыс.
        max_tokens: 6000,
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

    // Шаг 5. Таблица заданий и находки (§180).
    //
    // Балл считает КОД из таблицы, а не модель: в выгрузке 15.09 «ошибка в
    // одной задаче из шести» давала 5 из 5, а две ошибки из 16 — 94. Число из
    // ответа модели в базу не идёт (кроме случая, когда таблицы нет вовсе —
    // тогда оно сохраняется с confidence low, и панель его не показывает).
    const tasksRaw = parseTasks(parsed.tasks)

    // Рамки проверяем ДО фильтра по таблице: если первую находку строки
    // отбросить после лимита «одна на задание», строка останется без находки,
    // хотя у второй рамка была годной. Кривые выбрасываем поштучно: одна
    // плохая рамка не должна отменять весь разбор.
    const findings = Array.isArray(parsed.findings) ? parsed.findings : []
    let badRects = 0
    const drafts: (FindingDraft & { target: PageImage; rect: { x: number; y: number; w: number; h: number } })[] = []
    for (const raw of findings) {
      const index = Number(raw?.page_index ?? raw?.file_index)
      const target = sent[Number.isFinite(index) ? index - 1 : -1]
      if (!target) { badRects += 1; continue }

      const rect = raw?.rect ?? {}
      const x = clamp01(rect.x)
      const y = clamp01(rect.y)
      let w = clamp01(rect.w)
      let h = clamp01(rect.h)
      if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) { badRects += 1; continue }
      w = Math.min(w, 1 - x)
      h = Math.min(h, 1 - y)
      if (w <= 0 || h <= 0) { badRects += 1; continue }

      const note = String(raw?.text ?? '').trim().slice(0, 2000)
      if (!note) { badRects += 1; continue }

      const category: Category = (CATEGORIES as readonly string[]).includes(raw?.category) ? raw.category : 'comment'
      drafts.push({
        category,
        text: note,
        task: String(raw?.task ?? raw?.task_no ?? '').trim().slice(0, 16),
        target,
        rect: { x, y, w, h },
      })
    }

    // Самопротиворечия («должно быть 0,78, а не 0,78»), находки по верным
    // строкам, лимиты praise/format, потолок — всё здесь, в проверяемом тестом
    // модуле. Счётчик отброшенных — в лог и в столбец dropped_findings.
    const filtered = filterFindings(drafts, tasksRaw)
    const tasks = filtered.tasks
    const droppedFindings = filtered.dropped + badRects
    if (droppedFindings > 0) {
      console.log(`findings: отброшено ${droppedFindings} —`, { ...filtered.droppedBy, badRect: badRects, model, jobId })
    }
    // §189. Понижения вердикта считаем ОТДЕЛЬНО от dropped_findings: там мера
    // выдумок модели, а это правка кода по числам, и её видно в summary.
    if (filtered.lowered.length > 0) {
      console.log(`tasks: понижено вердиктов ${filtered.lowered.length} —`, { tasks: filtered.lowered, model, jobId })
    }

    const rows: Record<string, unknown>[] = filtered.kept.map((f, position) => ({
      job_id: jobId,
      file_id: f.target.file.id,
      // Настоящий номер страницы: у фотографии 1, у PDF — та страница,
      // картинку которой мы отрисовали и показали модели.
      page: f.target.page,
      position,
      rect_x: f.rect.x, rect_y: f.rect.y, rect_w: f.rect.w, rect_h: f.rect.h,
      category: f.category,
      text: f.text,
      // §192. Номер задания уже посчитан фильтром (`filterFindings` сверяет его
      // с таблицей и держит лимит «одна находка на задание») — сохраняем его,
      // чтобы панель связывала строку с находкой по данным, а не угадывала
      // номер из текста. Пусто — модель номера не назвала, так и пишем null.
      task: f.task || null,
    }))

    if (rows.length > 0) {
      const { error: insertError } = await admin.from('topic_homework_ai_findings').insert(rows)
      if (insertError) throw new Error(`Не удалось сохранить находки: ${insertError.message}`)
    }

    const readable = parsed.readable !== false
    const score = computeScore(tasks, gradeScale)
    // Таблицы нет — модель не выполнила формат. Её свободное число сохраняем
    // для истории, но с confidence low: панель такой балл не показывает
    // (shouldShowScore), а в сравнении версий он виден.
    const modelScore = numberOrNull(parsed.suggested_score)
    // §189. Работа прочитана не целиком — балла не будет ни своего, ни
    // модельного. Балл по двум третям работы выглядит как результат проверки и
    // принимается не глядя; «балл не выводится» заставляет открыть работу.
    const pagesSkipped = skipped.length > 0
    const partialCheck = isPartialCheck({ tasks, pagesSkipped })
    const suggestedScore = partialCheck
      ? null
      : tasks.length > 0
        ? score.score
        : (readable && modelScore !== null ? Math.max(0, Math.round(modelScore)) : null)
    const confidence = tasks.length > 0 || !readable
      ? deriveConfidence(parsed.confidence, { tasks, readable, referenceState: reference.state, pagesSkipped })
      : 'low'

    const usage = payload?.usage ?? {}
    const { error: doneError } = await admin.from('topic_homework_ai_jobs').update({
      status: 'done',
      provider: providerOf(baseUrl),
      model,
      readable,
      suggested_score: suggestedScore,
      confidence,
      // §180. Таблица по заданиям — преподавателю и для сравнения версий.
      tasks,
      dropped_findings: droppedFindings,
      reference_state: reference.state,
      reference_chars: reference.text.length || null,
      // §149.1. След в базе, что условие дошло: без него не отличить «модель
      // не поняла» от «лист не распознался».
      worksheet_state: worksheet.state,
      worksheet_chars: worksheet.text.length || null,
      // Пропущенные страницы и несверенные задания дописываем в разбор:
      // преподаватель должен видеть, что модель смотрела не всю работу и что
      // не вошло в балл, иначе «замечаний нет» соврёт.
      summary: withWorksheetNote(
        withReferenceNote(
          withSkipNote(
            // §189. Понижения вердикта — отдельной строкой сразу после
            // несверенных: преподаватель должен видеть, что балл поправила
            // система, а не модель.
            withLoweredNote(withUncheckedNote(String(parsed.summary ?? ''), tasks), filtered.lowered),
            skipped,
          ),
          reference,
        ),
        worksheet,
      ).slice(0, 8000) || null,
      // Причина «эталона нет» / «условия нет» не теряется: преподаватель видит
      // её в разборе, диагностика — здесь. Проверка при этом прошла, статус done.
      last_error: [reference.error, worksheet.error].filter(Boolean).join(' | ') || null,
      completed_at: new Date().toISOString(),
      input_tokens: numberOrNull(usage.prompt_tokens),
      output_tokens: numberOrNull(usage.completion_tokens),
    }).eq('id', jobId)
    // Раньше результат этой записи не проверялся: при неизвестном столбце
    // (миграция не применена до деплоя) задача молча зависала в processing.
    if (doneError) throw new Error(`Не удалось сохранить результат проверки: ${doneError.message}`)

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

  // §196. Бюджет рендера один на всю работу, и делится он здесь.
  //
  // Фотографии в счёт не идут — они не рендерятся. Цена страницы берётся по
  // самой дорогой ступени §193: сколько в файле страниц, до его открытия
  // неизвестно, а занизить резерв опаснее, чем завысить.
  const mimeOf = (file: AttemptFile) => file.mime_type ?? guessMime(file)
  const pdfPageCost = renderPageCostMs()
  const pdfTotal = files.filter(f => PDF_MIME.test(mimeOf(f))).length
  let pdfSeen = 0
  let pdfOpened = 0
  let renderSpent = 0

  for (const file of files) {
    const mime = mimeOf(file)
    const isPdf = PDF_MIME.test(mime)
    if (isPdf) pdfSeen += 1

    if (budgetLeft() <= 0) {
      skipped.push(`${nameOf(file)} — не поместился в лимит ${MAX_PAGES} страниц`)
      continue
    }

    // §196. Доля общего бюджета этому файлу — и решение, открывать ли его
    // вообще. Файлов может быть больше, чем помещается в бюджет даже по одной
    // странице на файл; такой файл не скачивается и не открывается, но молчать
    // о нём нельзя: без строки в разборе работа выглядит так, будто файла не
    // было, и преподаватель поверит разбору без половины решения.
    const plan = isPdf
      ? planRenderFile({
        budgetMs: RENDER_BUDGET_MS,
        budgetLeftMs: RENDER_BUDGET_MS - renderSpent,
        filesAfter: pdfTotal - pdfSeen,
        pageCostMs: pdfPageCost,
        opened: pdfOpened,
      })
      : { open: true, sliceMs: 0 }
    if (!plan.open) {
      skipped.push(`${nameOf(file)} — файл не проверен: не хватило времени рендера`)
      continue
    }

    const { data: blob, error: dlError } = await admin.storage.from(ATTEMPTS_BUCKET).download(file.storage_path)
    if (dlError || !blob) {
      skipped.push(`${nameOf(file)} — файл не скачался`)
      continue
    }
    const raw = new Uint8Array(await blob.arrayBuffer())

    if (!isPdf) {
      if (total + raw.length > MAX_INLINE_BYTES) {
        skipped.push(`${nameOf(file)} — слишком большой файл`)
        continue
      }
      total += raw.length
      pages.push({ file, page: 1, mime, bytes: raw, label: nameOf(file) })
      continue
    }

    const renderStartedAt = Date.now()
    pdfOpened += 1
    try {
      const rendered = await renderPdfPages(raw, budgetLeft(), plan.sliceMs)
      renderSpent += rendered.spentMs
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
      // §196. Время, съеденное упавшим файлом, всё равно списываем с общего
      // бюджета: иначе PDF, сломавшийся на середине рендера, вернёт следующему
      // файлу полный бюджет — и работа снова будет стоить несколько бюджетов.
      renderSpent += Date.now() - renderStartedAt
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
 * §193. Плотность выбирается ОДИН РАЗ на файл, по числу его страниц, до цикла:
 * менять её по ходу нельзя — страницы одной работы должны быть одного масштаба,
 * иначе преподаватель увидит рядом крупную и мелкую половину одной работы.
 *
 * §196. `budgetMs` — не собственный бюджет файла, а доля общего бюджета работы,
 * посчитанная в `collectPages`; сюда же возвращается `spentMs`, чтобы следующий
 * файл получил остаток. Отсчёт начинается ПЕРЕД циклом страниц, как и до §196:
 * скачивание файла и запуск WASM-движка процессорного времени страниц не
 * тратят, и если начать считать раньше, холодный старт съест бюджет у первого
 * же файла — ровно та потеря страниц, против которой §193.
 *
 * Импорт динамический: работа из одних фотографий не должна платить за
 * загрузку WASM-движка.
 */
async function renderPdfPages(
  bytes: Uint8Array,
  limit: number,
  budgetMs: number,
): Promise<{ images: { page: number; bytes: Uint8Array }[]; total: number; spentMs: number }> {
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

    // §193. Цена страницы почти линейна по числу пикселей, а пиксели задаём мы.
    // Длинная работа рендерится мельче — и потому доезжает целиком.
    const { dpi, maxWidth } = renderDensityFor(total)
    if (dpi !== 150) console.log(`render: ${total} стр. → ${dpi} DPI, потолок ширины ${maxWidth}`)

    const startedAt = Date.now()
    const deadline = startedAt + budgetMs
    let index = 0
    for (const page of document.pages()) {
      if (images.length >= limit) break
      // Хотя бы одна страница должна уехать модели, даже если бюджет уже вышел:
      // разбор по первой странице полезнее, чем «ИИ не смог». С §196 это ещё и
      // единственная гарантия, что второй файл работы вообще существует для
      // модели: общий дедлайн к его очереди может быть уже позади.
      if (images.length > 0 && Date.now() > deadline) break
      index += 1
      const { originalWidth } = page.getOriginalSize()
      const scale = Math.min(dpi / 72, maxWidth / Math.max(1, originalWidth))
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

    return { images, total, spentMs: Date.now() - startedAt }
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

/**
 * Приписка про условие (§149.1) — по тому же принципу: преподаватель обязан
 * видеть, что модель составила представление о заданиях без рабочего листа.
 */
function withWorksheetNote(summary: string, worksheet: ReferenceResult): string {
  if (worksheet.state === 'used') return summary
  const note = worksheet.state === 'failed'
    ? `Проверено без условия: ${worksheet.error ?? 'рабочий лист не удалось прочитать'}.`
    : 'Проверено без условия: у темы нет рабочего листа ДЗ.'
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
 * Что именно грузим из материалов темы. Две рубрики идут одним путём (§149.1):
 * эталон — `solution`, условие — рабочий лист `worksheet_homework`. У каждой
 * СВОЙ потолок: при общем длинное решение вытеснило бы условие или наоборот.
 */
interface MaterialSpec {
  section: string
  limit: number
  /** Как называть материал в причинах отказа и в приписках. */
  label: string
  fallbackName: string
}

const SOLUTION_SPEC: MaterialSpec = {
  section: 'solution', limit: REFERENCE_CHAR_LIMIT, label: 'авторское решение', fallbackName: 'solution.pdf',
}
const WORKSHEET_SPEC: MaterialSpec = {
  section: WORKSHEET_SECTION, limit: WORKSHEET_CHAR_LIMIT, label: 'рабочий лист ДЗ', fallbackName: 'worksheet.pdf',
}

/**
 * Текст материала темы для промпта: авторское решение или рабочий лист.
 *
 * Для эталона берём ТОЛЬКО рубрику `solution` — это решение домашней работы.
 * `task_solution` (решения задач урока) не трогаем: подсунуть разбор урока
 * вместо разбора ДЗ хуже, чем не дать ничего.
 *
 * Провал разбора НЕ валит проверку: возвращаем `state: 'failed'`, работа
 * проверяется без этого материала. Ещё одна причина падать нам не нужна — за
 * всё время было восемь попыток проверки.
 */
async function loadMaterialText(
  admin: ReturnType<typeof createClient>,
  topicId: string | null,
  ai: { apiKey: string; baseUrl: string },
  spec: MaterialSpec,
): Promise<ReferenceResult> {
  if (!topicId) return NO_REFERENCE('missing')

  const { data: materials } = await admin
    .from('topic_material_items')
    .select('id, title, content, kind, storage_path, size_bytes, mime_type')
    .eq('topic_id', topicId)
    .eq('section', spec.section)
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
    const block = truncateReference(textual, spec.limit)
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
    const block = truncateReference(String(cached.text ?? ''), spec.limit)
    return { ...block, state: 'used', error: null, engine: cached.engine as ParseEngine, cached: true }
  }

  if (Number(pdf.size_bytes ?? 0) > MAX_REFERENCE_BYTES) {
    return NO_REFERENCE(
      'failed',
      `${capitalize(spec.label)} больше ${Math.round(MAX_REFERENCE_BYTES / 1024 / 1024)} МБ — не разбирали`,
    )
  }

  // 2. Файл из приватного бакета.
  let bytes: Uint8Array | null = null
  for (const bucket of MATERIAL_BUCKETS) {
    const { data } = await admin.storage.from(bucket).download(pdf.storage_path)
    if (data) { bytes = new Uint8Array(await data.arrayBuffer()); break }
  }
  if (!bytes) return NO_REFERENCE('failed', `Файл (${spec.label}) не скачался из хранилища`)

  // 3. Разбор: сначала бесплатный движок, платный — только если тот не смог.
  const dataUrl = `data:application/pdf;base64,${base64(bytes)}`
  const fileName = String(pdf.storage_path).split('/').pop() || spec.fallbackName
  let engine = nextEngine(null)
  // §149. Причины собираем по КАЖДОМУ движку, а не держим последнюю: пять
  // прогонов подряд (06–10.09) в last_error лежал только отказ платного
  // mistral-ocr по балансу, и что случилось с бесплатным cloudflare-ai, который
  // шёл первым, узнать было неоткуда.
  const reasons: string[] = []

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
        const block = truncateReference(parsed.text, spec.limit)
        return { ...block, state: 'used', error: null, engine, cached: false }
      }
      // Молча принятый мусор — единственный способ этой работой сделать хуже,
      // чем было: каша легла бы в кэш как эталон, и модель валила бы ученика
      // за расхождение с ней.
      // «Мало» без числа неотличимо от «пусто» — даём символы и страницы.
      reasons.push(tooLittleTextReason(engine, parsed.text, parsed.pages))
    } catch (err) {
      reasons.push(`движок ${engine}: ${err instanceof Error ? err.message : String(err)}`)
    }
    engine = nextEngine(engine)
  }

  return NO_REFERENCE('failed', describeParseFailure(reasons, spec.label))
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text
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

/**
 * Промпт. Три вещи в нём важнее формулировок:
 *  — модель сначала решает задачу САМА и только потом сверяет. Иначе она
 *    соглашается с ходом ученика и подтверждает его же ошибку;
 *  — координаты просим долями страницы и повторяем это дважды, потому что
 *    пиксели — самый частый способ промахнуться мимо строки;
 *  — с v17 (§180) модель отдаёт ТАБЛИЦУ по заданиям, а балл считает код
 *    (`findings.ts`): свободное число модели не следовало из её же разбора.
 */
function buildPrompt(ctx: {
  title: string
  instructions: string
  /** Рабочий лист ДЗ, распознанный текст; пусто — условия нет (§149.1). */
  worksheetText: string
  worksheetTruncated: boolean
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
    // §149.1. Порядок: условие → решение → работа. Рабочий лист идёт первым,
    // чтобы модель знала состав заданий и что в каждом требуется, ДО того как
    // увидит эталон и работу. Без листа — честно сказать, а не додумывать.
    ctx.worksheetText
      ? worksheetPromptBlock({ text: ctx.worksheetText, truncated: ctx.worksheetTruncated })
      : (ctx.instructions
        ? ''
        : 'УСЛОВИЯ ДЗ НЕТ: состав заданий восстанавливай по авторскому решению и работе ученика; не считай задание ответным, если этого не видно из решения.'),
    '',
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
    // §180. Сначала таблица по заданиям, потом находки только по неверным.
    // Прежний шаг «отметь удачные ходы» убран: он и породил поток praise —
    // 39 % находок в выгрузке 15.09, по одной похвале на каждую верную задачу.
    '4. Составь ТАБЛИЦУ ПО ЗАДАНИЯМ — по одной строке на каждое задание работы. Список заданий бери из условия (рабочего листа); если условия нет — из того, что нашёл в работе. В строке: номер, вердикт, ответ ученика КАК ТЫ ЕГО ПРОЧИТАЛ, ожидаемый ответ (по эталону или своему решению), короткая заметка.',
    '5. Находки — ТОЛЬКО по строкам таблицы с вердиктом wrong или partial: не больше одной на задание, с рамкой ровно на месте ошибки. По верным заданиям находок не пиши.',
    '',
    `Тебе передано страниц: ${ctx.pageCount}. Перед каждой идёт строка «Страница #N: имя». Многостраничный PDF разложен на страницы, у каждой свой номер.`,
    '',
    'ОТВЕТЬ СТРОГО ОДНИМ JSON-объектом, без пояснений и без markdown:',
    '{',
    '  "readable": true,',
    '  "summary": "разбор для учителя на русском: что верно, что нет, на что обратить внимание",',
    '  "tasks": [',
    '    {"no": "3", "verdict": "wrong", "student_answer": "0,82", "expected_answer": "0,78", "note": "потерян знак при переносе"},',
    '    {"no": "4", "verdict": "correct", "student_answer": "12", "expected_answer": "12", "note": ""}',
    '  ],',
    '  "suggested_score": 4,',
    '  "confidence": "high",',
    '  "findings": [',
    '    {"task": "3", "page_index": 1, "rect": {"x": 0.12, "y": 0.34, "w": 0.4, "h": 0.06},',
    '     "category": "calc", "text": "Здесь потерян знак минус при переносе"}',
    '  ]',
    '}',
    '',
    'ПРАВИЛА:',
    `- ${scale}`,
    '- verdict: "correct" — верный результат и верный ход (или верный ответ там, где условие требует только ответа); "partial" — ответ верный, но ход с изъяном или его нет там, где условие требует развёрнутого решения, либо верный ход с арифметическим сбоем в конце; "wrong" — неверный результат или неверный ход; "unchecked" — сверить нельзя (не прочитать, страницы нет, проверить не по чему).',
    // §180. Балл из таблицы считает код; своё число модель может написать для
    // самопроверки, но в базу оно не идёт. Правило названо в промпте, чтобы
    // модель заполняла таблицу, понимая, во что она превращается.
    '- БАЛЛ считает система по таблице: (correct + 0,5·partial) / (все задания, кроме unchecked). По стобалльной — в процентах; по пятибалльной — 5 от 90 %, 4 от 70 %, 3 от 50 %, иначе 2. Своё suggested_score напиши для самопроверки — оно будет пересчитано по таблице.',
    '- Если ответ ученика совпадает с ожидаемым, вердикт НЕ может быть wrong, и находки об ошибке быть не должно. Никогда не пиши «должно быть X, а не X» или «X вместо X» с одинаковыми значениями — такая находка отбрасывается.',
    // §189. Обратное направление того же правила. В живой таблице стояло
    // «student_answer 12, expected_answer 30, note: ответ неверен: должно быть
    // 30» — и вердикт correct. Система теперь такую строку понижает сама, но
    // сказать об этом модели дешевле, чем править за ней.
    '- И наоборот: если ответ ученика НЕ совпадает с ожидаемым, вердикт НЕ может быть correct — это wrong (или partial, если ход верен, а сбой арифметический). Система сверяет эти два поля числами и вердикт correct с разошедшимися ответами понижает сама.',
    '- Задание с верным результатом и верным ходом — "correct" ПОЛНОСТЬЮ, даже если запись неаккуратна.',
    '- Замечания по оформлению (category "format") на вердикт НЕ влияют: это советы. Вердикт снижают только неверный результат и неверный ход.',
    // §149. Правило «нет хода решения — ноль» модель выдумала сама: разборы
    // 10.09 на 0 и 3 балла («все задания засчитаны как неверные из-за
    // отсутствия хода решения», «нет решения, только ответы») — при том, что в
    // рабочем листе ученик по условию и пишет только ответы. Ограничитель
    // обязателен: полный балл вслепую за верный ответ без выкладок там, где
    // условие требует развёрнутого решения (вторая часть ЕГЭ), — ошибка того
    // же сорта, что и ноль вслепую.
    '- Отсутствие развёрнутого решения само по себе НЕ ошибка. Смотри на УСЛОВИЕ: если задание требует только ответа (рабочий лист, тест, «запиши ответ»), оценивай по ответам — верный ответ засчитывается "correct". Если условие требует развёрнутого решения, отсутствие хода при верном ответе — "partial" с заметкой, а не "wrong".',
    '- Если все задания верны — findings пустой, summary: «Все верно» и одна-две фразы по делу. Похвалу отдельными находками не пиши.',
    `- Похвала ("praise") — не больше ${MAX_PRAISE_FINDINGS} на работу и только если есть хотя бы одна ошибка. Замечаний по оформлению ("format") — не больше ${MAX_FORMAT_FINDINGS}.`,
    '- Другой верный способ решения — не ошибка. Пришёл к верному результату верным рассуждением — "correct".',
    '- Не разобрал почерк — не ошибка: строке дай "unchecked", находку "comment" с текстом «проверьте вручную», понизь confidence.',
    // §149. Прогон 11.09 («Теория», балл 89 при справедливых 100): модель
    // прочитала рукописную «1» как «7» в задании с тремя вариантами, написала
    // «почерк читаем» и с высокой уверенностью засчитала ошибку. Это не предел
    // зрения, а отсутствие правила на случай конфликта прочитанного с эталоном.
    '- КОНФЛИКТ С ЭТАЛОНОМ: если прочитанный ответ ученика расходится с эталоном, но похож на него по написанию (1/7, 4/9, 0/6, 5/6, 3/8) или невозможен по условию (нет такого варианта, не та размерность) — это вероятная ошибка РАСПОЗНАВАНИЯ, а не ученика. Ошибку не засчитывай ("unchecked" или "correct"), понизь confidence и напиши в заметке «проверьте вручную».',
    '- В спорном случае решай в пользу ученика: твой разбор — предложение, вердикт всё равно ставит преподаватель.',
    '- confidence: "high" — работа читается уверенно и решение однозначно; "medium" — есть сомнения; "low" — почерк плохо разбирается или задание непонятно.',
    // §149. Без эталона модель всё равно ставила балл — и ставила ноль: пять
    // прогонов 06–10.09 с reference_state='failed' дали 50, 3, 83, 0, 0. Ноль,
    // выставленный вслепую, для преподавателя хуже отсутствия балла: он
    // выглядит как результат проверки. Честный выход — не занижать, а сказать.
    ctx.solutionText
      ? ''
      : '- Авторского решения нет: не считай ответ неверным лишь потому, что не с чем сверить. Засчитывай то, что проверил сам. Если ответ проверить нельзя — строке "unchecked", не "wrong"; confidence "low"; в summary прямо перечисли, какие задания остались не сверены.',
    '- Если работу невозможно прочитать: "readable": false, "tasks": [], "findings": [], "confidence": "low".',
    '- task в находке — номер строки таблицы (поле "no"), к которой она относится.',
    '- page_index — номер страницы из строки «Страница #N», начиная с 1.',
    '- КООРДИНАТЫ — ДОЛИ СТРАНИЦЫ ОТ 0 ДО 1, начало отсчёта в левом верхнем углу. Не пиксели.',
    '- Координаты считай относительно ТОЙ страницы, на которую ставишь рамку, а не всей работы.',
    '- x + w не больше 1, y + h не больше 1. Рамка должна плотно охватывать нужные строки, а не всю страницу.',
    `- Не больше ${MAX_FINDINGS} находок. Лучше меньше, но по делу.`,
    '- category: "calc" — арифметика и знаки, "logic" — неверный ход решения, "format" — оформление и единицы измерения, "praise" — удачный ход, "comment" — всё остальное (в том числе «не разобрать»).',
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
