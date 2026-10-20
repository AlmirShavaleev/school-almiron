// Рендер PDF в JPEG и разбор PDF в текст — вынесены из index.ts в §222b без
// изменения поведения: ими же пользуется проверка второй части пробника
// (supabase/functions/check-mock-exam-ai). Всё, что сказано в index.ts про
// бюджет рендера (RENDER_BUDGET_MS, §189/§193/§196) и движки разбора (§137,
// §149), относится и сюда. Спецификаторы динамических импортов — ЛИТЕРАЛЬНЫЕ:
// иначе сборщик функции не положит пакеты в eszip.
//
// Модель разбора (`parseModel`) передаёт вызывающий: у каждой функции своё
// чтение окружения (AI_PARSE_MODEL), модуль Deno.env не трогает. То же с
// секретом ретранслятора: `ai.env` передаёт вызывающий (письмо 20.10).

import { aiChatFetch } from './aiFetch.ts'
import { renderDensityFor } from './findings.ts'
import { extractAnnotationText, type ParseEngine } from './reference.ts'

/** Разбор PDF-эталона: меньше общего таймаута модели (см. parsePdf). */
export const PDF_PARSE_TIMEOUT_MS = 60_000

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
export async function renderPdfPages(
  bytes: Uint8Array,
  limit: number,
  budgetMs: number,
  jpegQuality = 80,
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

      const encoded = encodeJpeg({ data, width: result.width, height: result.height }, jpegQuality)
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

/**
 * Один запрос к поставщику ради РАЗБОРА файла.
 *
 * Текст берём из `file_annotations` ответа — это дословно разобранное
 * содержимое. Пересказ модели брать нельзя: она сокращает и «поправляет»
 * формулы, а эталон обязан совпадать с тем, что написал учитель. Аннотации
 * приходят и в ветке ошибки инференса, поэтому даже отказ модели отдаёт текст.
 */
export async function parsePdf(
  ai: { apiKey: string; baseUrl: string; parseModel: string; env?: (name: string) => string | undefined },
  file: { dataUrl: string; fileName: string; engine: ParseEngine },
): Promise<{ text: string; pages: number }> {
  // Разбор PDF — 60 с: в том же запросе после него ещё идёт модель (120 с), а
  // воркер живёт 150 с. Обрыв — ошибкой движка, следующий движок попробует.
  const response = await aiChatFetch(ai.baseUrl, ai.apiKey, ({
      model: ai.parseModel,
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
    }), ai.env ?? (() => undefined), { 'HTTP-Referer': 'https://alminion.ru', 'X-Title': 'School Almiron' }, PDF_PARSE_TIMEOUT_MS)

  const payload = await response.json().catch(() => null)
  const parsed = extractAnnotationText(payload)
  if (parsed.text) return parsed
  if (!response.ok) {
    const detail = payload?.error?.message ?? `HTTP ${response.status}`
    throw new Error(String(detail).slice(0, 200))
  }
  return parsed
}

/** base64 без разворота всего массива в аргументы: у больших файлов стек кончается. */
export function base64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
