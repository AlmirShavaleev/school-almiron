/**
 * import-bunny-videos.mjs — развешивает видео Bunny Stream на темы курса ссылками.
 *
 * Файлы никуда не заливаются: материал темы вида `kind = 'video'`, адрес в
 * `url`. Идентификатор видео живёт в хвосте адреса
 * (`…/embed/726880/<VideoId>`) — отдельной колонки под него нет и не будет:
 * CHECK `course_lesson_materials_payload_chk` требует у видео `content = NULL`.
 *
 * Работа в два захода, между ними — человек:
 *
 *   1) РАЗБОР (по умолчанию). Читает выгрузку Bunny, подбирает темы, пишет
 *      `scripts/out/bunny_match_<курс>.csv` (строка на тему) и
 *      `scripts/out/bunny_unused_<курс>.csv` (видео, никуда не предложенные).
 *   2) Владелец правит колонку РЕШЕНИЕ в первом файле: VideoId или «нет».
 *   3) ПРИМЕНЕНИЕ (`--apply --decisions <файл>`). Пишет только строки с
 *      заполненным решением, всё остальное пропускает с причиной.
 *
 * Примеры:
 *   npm run import-videos -- --course <uuid>
 *   npm run import-videos -- --course <uuid> --reuse scripts/out/bunny_match_shablon.csv
 *   npm run import-videos -- --course <uuid> --decisions scripts/out/bunny_match_shablon.csv --apply
 *
 * Ключ доступа берётся из `.env.import.local` и никуда не печатается.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, basename } from 'path'

// ── Куда какая коллекция ─────────────────────────────────────────────────────
//
// Коллекции Bunny — это номера заданий ЕГЭ. Модуль курса опознаётся по числу в
// начале названия («№17», «№4-5 Теория вероятности» → 17 и 4). Соответствие
// задано таблицей, а не догадкой: ошибка здесь развесила бы планиметрию на
// неравенства, и заметил бы это только ученик.
//
// «1 часть» — одна коллекция на девять модулей первой части, поэтому у неё
// список номеров. «Оформление» отсутствует сознательно (решение владельца от
// 2026-08-13): эти шесть видео уходят в отчёт неиспользованными.

const COLLECTION_MODULES = {
  '1 часть': [2, 3, 4, 6, 8, 9, 10, 11, 12],
  '№13': [13],
  '№14': [14],
  '№15': [15],
  '№16': [16],
  '№17': [17],
  '№18 Алгебра': [18],
  '№18 Графика': [18],
  '№18 Функции': [18],
  '№18 без категории': [18],
  '№19': [19],
}

/** Профиль владельца: под сервисным ключом `auth.uid()` пуст (урок §101). */
const OWNER_PROFILE_ID = '4972e1a0-4e4b-489b-8f84-5f735b597c11'

/**
 * Порог и отрыв.
 *
 * SCORE_MIN — ниже этого предложения нет вовсе. MARGIN — насколько лучший
 * кандидат обязан оторваться от второго, чтобы предложение считалось
 * однозначным. Мелкий отрыв означает «двойники» (в №17 «Красота прямоугольного
 * треугольника» есть Вебинаром 10 и Вебинаром 11 с тем же названием): в таком
 * случае предложение НЕ делается, оба уходят в колонку альтернатив. Пустая
 * строка честнее уверенного промаха.
 */
const SCORE_MIN = 0.45
const MARGIN = 0.10

/** Числа и диапазоны различают темы гораздо надёжнее слов — отсюда вес. */
const NUMBER_WEIGHT = 5
const WORD_WEIGHT = 1

const OUT_DIR = 'scripts/out'

// ── Аргументы ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const getArg = name => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const FLAGS = {
  course:    getArg('--course'),
  csv:       getArg('--csv') ?? 'scripts/bunny_videos.csv',
  out:       getArg('--out') ?? OUT_DIR,
  apply:     argv.includes('--apply'),
  decisions: getArg('--decisions'),
  reuse:     getArg('--reuse'),
}

const APPLY = FLAGS.apply

function die(message) {
  console.error(`\n  ОСТАНОВ: ${message}\n`)
  process.exit(1)
}

if (!FLAGS.course) die('не указан --course <uuid>')
if (!existsSync(FLAGS.csv)) die(`выгрузка Bunny не найдена: ${FLAGS.csv}`)
if (APPLY && !FLAGS.decisions) die('--apply без --decisions <файл с решениями> ничего не значит')
if (FLAGS.decisions && !existsSync(FLAGS.decisions)) die(`файл решений не найден: ${FLAGS.decisions}`)

// ── Доступ ───────────────────────────────────────────────────────────────────

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[trimmed.slice(0, eq).trim()] = value
  }
  return out
}

const env = {
  ...readEnvFile(join(process.cwd(), '.env')),
  ...readEnvFile(join(process.cwd(), '.env.import.local')),
  ...process.env,
}

const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) die('в .env нет VITE_SUPABASE_URL')
if (!SERVICE_KEY) {
  die(
    'в .env.import.local нет SUPABASE_SERVICE_ROLE_KEY.\n' +
    '  Добавьте строку в файл сами — он уже в .gitignore. Присылать ключ в переписку не нужно.',
  )
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function unwrap(label, { data, error }) {
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Разбор CSV с кавычками. Выгрузка Bunny держит запятые внутри значений
 *  (дробные минуты «56,3» и запятые в названиях), поэтому split(',') не годится. */
function parseCsv(text, delimiter = ',') {
  const rows = []
  let row = [], cur = '', quoted = false
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text   // BOM от Excel

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) { row.push(cur); cur = '' }
    else if (ch === '\r') { /* пропускаем */ }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += ch
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

/**
 * Запись CSV для Excel: разделитель `;` и BOM.
 *
 * Не украшательство: в русской локали Excel открывает файл с запятыми одной
 * колонкой, а кириллицу без BOM показывает кракозябрами. Файл правит владелец
 * руками — значит он обязан открыться двойным щелчком.
 */
function writeCsv(path, header, rows) {
  const cell = v => {
    const s = String(v ?? '')
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n')
  writeFileSync(path, '﻿' + text, 'utf8')
}

function readCsvFile(path) {
  const text = readFileSync(path, 'utf8')
  // Свой отчёт пишем через `;`, выгрузка Bunny приходит через `,` — узнаём по шапке.
  const firstLine = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/)[0] ?? ''
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  const rows = parseCsv(text, delimiter)
  const header = rows[0].map(h => h.trim())
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

// ── Сравнение названий ───────────────────────────────────────────────────────

/**
 * Служебные обороты, которые есть у всех и потому ничего не различают.
 * Убираем ДО разбора на слова, чтобы «Вебинар 11» не подарил числу 11 вес 5:
 * номер вебинара — отдельный сигнал, в оценку он не входит.
 */
const NOISE = [
  /видео[-\s]?конспект/gi,
  /вебинар\s*№?\s*\d+/gi,
  /выпуск\s*№?\s*\d+/gi,
]

function normalize(title) {
  let s = (title ?? '').toLowerCase().replace(/ё/g, 'е')
  for (const re of NOISE) s = s.replace(re, ' ')
  return s
}

/** «1-12», «13 – 24» → «1-12». Диапазон — жёсткий признак, см. matchScore. */
function extractRanges(s) {
  const out = new Set()
  for (const m of s.matchAll(/(\d{1,3})\s*[-–—]\s*(\d{1,3})/g)) out.add(`${Number(m[1])}-${Number(m[2])}`)
  return out
}

/** Номера заданий: «№15», «№1,17» → {15}, {1,17}. */
function extractTaskNumbers(s) {
  const out = new Set()
  for (const m of s.matchAll(/№\s*([\d\s,]+)/g)) {
    for (const part of m[1].split(',')) {
      const n = Number(part.trim())
      if (Number.isFinite(n) && n > 0 && n <= 25) out.add(n)
    }
  }
  return out
}

function extractYears(s) {
  const out = new Set()
  for (const m of s.matchAll(/\b(20\d{2})\b/g)) out.add(m[1])
  return out
}

/** Номер вебинара — сигнал для объяснения, а не для решения (в №17 он сдвинут). */
function extractWebinarNumber(title) {
  const m = (title ?? '').match(/вебинар\s*№?\s*(\d+)/i)
  return m ? Number(m[1]) : null
}

/** Слова длиннее двух букв плюс отдельно стоящие числа. */
function tokenize(normalized) {
  const withoutRanges = normalized.replace(/(\d{1,3})\s*[-–—]\s*(\d{1,3})/g, ' ')
  const words = new Set()
  const numbers = new Set()
  for (const raw of withoutRanges.split(/[^0-9a-zа-я]+/)) {
    if (!raw) continue
    if (/^\d+$/.test(raw)) numbers.add(raw)
    else if (raw.length > 2) words.add(raw)
  }
  return { words, numbers }
}

function describe(title) {
  const normalized = normalize(title)
  const { words, numbers } = tokenize(normalized)
  return {
    words, numbers,
    ranges: extractRanges(normalized),
    tasks: extractTaskNumbers(normalized),
    years: extractYears(normalized),
    webinar: extractWebinarNumber(title),
  }
}

const intersects = (a, b) => [...a].some(x => b.has(x))
const sameSets = (a, b) => a.size === b.size && [...a].every(x => b.has(x))

/**
 * Оценка пары «тема ↔ видео» в долях единицы, плюс объяснение словами.
 *
 * Возвращает score = null, если пара отвергнута жёстким признаком: разные
 * диапазоны вариантов или непересекающиеся номера заданий. Это ровно ловушка
 * из вводной — «Варианты 1-12» и «Варианты 13-24» по общим словам почти
 * неразличимы, и без запрета скрипт уверенно предложил бы не то.
 *
 * Знаменатель — вес МЕНЬШЕЙ стороны: названия тем в базе обрезаны загрузчиком
 * папок («…показательных функц»), и штрафовать за отсутствующий хвост значило
 * бы завалить все длинные названия.
 */
function matchScore(topic, video) {
  const why = []

  if (topic.ranges.size && video.ranges.size && !sameSets(topic.ranges, video.ranges)) {
    return { score: null, why: `диапазоны разные (${[...topic.ranges]} против ${[...video.ranges]})` }
  }
  if (topic.tasks.size && video.tasks.size && !intersects(topic.tasks, video.tasks)) {
    return { score: null, why: `номера заданий разные (${[...topic.tasks]} против ${[...video.tasks]})` }
  }

  const weigh = d =>
    d.words.size * WORD_WEIGHT + (d.numbers.size + d.ranges.size) * NUMBER_WEIGHT

  let shared = 0
  for (const w of topic.words) if (video.words.has(w)) shared += WORD_WEIGHT
  for (const n of topic.numbers) if (video.numbers.has(n)) shared += NUMBER_WEIGHT
  for (const r of topic.ranges) if (video.ranges.has(r)) shared += NUMBER_WEIGHT

  // Две меры сразу, и обе нужны.
  //
  // По МЕНЬШЕЙ стороне — чтобы обрезанные названия тем («…показательных функц»)
  // не проваливались из-за отсутствующего хвоста. Но одна она переоценивает
  // короткие названия: у видео «Метод рационализации» все слова входят и в тему
  // «Метод рационализации», и в тему «Однородные неравенства и метод
  // рационализации…» — обе получают 100, и точное совпадение проигрывает
  // случайности порядка перебора.
  //
  // Поэтому четверть веса отдана СИММЕТРИЧНОЙ мере: она штрафует лишние слова
  // на длинной стороне, и точное совпадение обходит надмножество.
  const minWeight = Math.max(1, Math.min(weigh(topic), weigh(video)))
  const maxWeight = Math.max(1, weigh(topic), weigh(video))
  let score = 0.75 * (shared / minWeight) + 0.25 * (shared / maxWeight)

  if (topic.ranges.size && sameSets(topic.ranges, video.ranges)) why.push(`диапазон ${[...topic.ranges]} совпал`)
  if (intersects(topic.tasks, video.tasks)) why.push(`задание №${[...topic.tasks].filter(t => video.tasks.has(t))}`)
  if (topic.years.size && video.years.size && !intersects(topic.years, video.years)) {
    // Проверено на данных: тема №15/8 говорит «Ященко 2025», видео — «2026», а
    // диапазон 1-12 у обоих. Год расходится в источнике, поэтому он пометка, не запрет.
    why.push(`год расходится (${[...topic.years]} против ${[...video.years]})`)
    score -= 0.05
  }

  return { score: Math.max(0, score), why: why.join('; ') }
}

// ── Данные ───────────────────────────────────────────────────────────────────

const moduleNumber = title => {
  const m = (title ?? '').match(/^№\s*(\d+)/)
  return m ? Number(m[1]) : null
}

async function loadCourse(courseId) {
  const courses = unwrap('чтение курса', await db
    .from('courses').select('id, title').eq('id', courseId).limit(1))
  if (!courses.length) die(`курс ${courseId} не найден`)

  const modules = unwrap('чтение модулей', await db
    .from('modules').select('id, title, order_index').eq('course_id', courseId).order('order_index'))

  const topics = []
  for (const module of modules) {
    const rows = unwrap('чтение тем', await db
      .from('topics').select('id, title, order_index').eq('module_id', module.id).order('order_index'))
    for (const t of rows) {
      topics.push({
        ...t,
        moduleTitle: module.title,
        moduleNumber: moduleNumber(module.title),
        describe: describe(t.title),
      })
    }
  }
  return { course: courses[0], modules, topics }
}

function loadVideos(path) {
  const rows = readCsvFile(path)
  return rows.map(r => ({
    collection: r.Collection,
    title: r.Title,
    videoId: r.VideoId,
    embed: r.Embed,
    minutes: r.Minutes,
    describe: describe(r.Title),
  })).filter(v => v.videoId)
}

// ── Подбор ───────────────────────────────────────────────────────────────────

/**
 * Жадное назначение по всему курсу: пары сортируются по оценке и разбираются
 * сверху, занятые темы и видео выбывают. Так одно видео не попадёт на две темы,
 * а «почти подходящее» не перехватит чужую пару только потому, что его тема
 * встретилась в списке раньше.
 */
function buildSuggestions(topics, videos) {
  const pairs = []

  for (const video of videos) {
    const allowed = COLLECTION_MODULES[video.collection]
    if (!allowed) continue                                  // «Оформление» и прочее — мимо
    const candidates = topics.filter(t => t.moduleNumber !== null && allowed.includes(t.moduleNumber))

    for (const topic of candidates) {
      const { score, why } = matchScore(topic.describe, video.describe)
      if (score === null || score < SCORE_MIN) continue
      pairs.push({ topic, video, score, why })
    }
  }

  const byTopic = new Map()
  for (const p of pairs) {
    if (!byTopic.has(p.topic.id)) byTopic.set(p.topic.id, [])
    byTopic.get(p.topic.id).push(p)
  }
  for (const list of byTopic.values()) list.sort((a, b) => b.score - a.score)

  pairs.sort((a, b) => b.score - a.score)

  const takenTopics = new Set(), takenVideos = new Set()
  const assigned = new Map()

  for (const p of pairs) {
    if (takenTopics.has(p.topic.id) || takenVideos.has(p.video.videoId)) continue

    const list = byTopic.get(p.topic.id)
    const rival = list.find(x => x.video.videoId !== p.video.videoId && !takenVideos.has(x.video.videoId))
    if (rival && p.score - rival.score < MARGIN) {
      // Двойники: «Красота прямоугольного треугольника» — Вебинар 10 и 11.
      // Молчаливый выбор первого здесь — худшее из возможного.
      assigned.set(p.topic.id, { ambiguous: true, options: [p, rival], why: p.why })
      takenTopics.add(p.topic.id)
      continue
    }

    assigned.set(p.topic.id, { ambiguous: false, pair: p })
    takenTopics.add(p.topic.id)
    takenVideos.add(p.video.videoId)
  }

  return { assigned, byTopic, takenVideos }
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

const REPORT_HEADER = [
  'КУРС', 'МОДУЛЬ', '№ ТЕМЫ', 'ТЕМА', 'TOPIC_ID',
  'ВИДЕО (VideoId)', 'НАЗВАНИЕ ВИДЕО', 'КОЛЛЕКЦИЯ', 'УВЕРЕННОСТЬ', 'ПОЧЕМУ',
  'АЛЬТЕРНАТИВЫ', 'ИСТОЧНИК', 'РЕШЕНИЕ',
]

/**
 * Имя файла из названия курса плюс хвост его id.
 *
 * Хвост id обязателен, а не украшение: курсы-копии отличаются от шаблона
 * КОНЦОМ названия («… — Шаблон», «… — 11А», «… — Саида»), а короткое имя
 * режется по началу. Без id отчёт копии молча затирал файл решений шаблона —
 * ровно это и случилось при первом прогоне по 11А.
 */
function slug(title, id) {
  const words = title.toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim().split(/\s+/)
  const out = []
  for (const w of words) {
    if (out.join('_').length + w.length + 1 > 32) break
    out.push(w)
  }
  return `${out.join('_') || 'kurs'}_${String(id).slice(0, 8)}`
}

async function runMatch() {
  const { course, topics } = await loadCourse(FLAGS.course)
  const videos = loadVideos(FLAGS.csv)

  // Решения из прошлого отчёта (шаблон → копия). Сопоставляем ПО НАЗВАНИЮ темы:
  // в копии темы могли добавить или убрать, и перенос по номеру строки молча
  // развесил бы видео со сдвигом.
  const reused = new Map()
  if (FLAGS.reuse) {
    if (!existsSync(FLAGS.reuse)) die(`файл для переиспользования не найден: ${FLAGS.reuse}`)
    for (const row of readCsvFile(FLAGS.reuse)) {
      const decision = (row['РЕШЕНИЕ'] ?? '').trim()
      if (decision) reused.set(`${row['МОДУЛЬ']}|${row['ТЕМА']}`, decision)
    }
  }

  const { assigned, takenVideos } = buildSuggestions(topics, videos)

  const rows = []
  let suggested = 0, ambiguous = 0, empty = 0, fromTemplate = 0

  for (const topic of topics) {
    const result = assigned.get(topic.id)
    const reuseKey = `${topic.moduleTitle}|${topic.title}`
    const inherited = reused.get(reuseKey)

    let videoId = '', videoTitle = '', collection = '', confidence = '', why = '', alternatives = ''

    if (result?.ambiguous) {
      ambiguous++
      why = 'неоднозначно, выберите'
      alternatives = result.options
        .map(o => `${o.video.videoId} — ${o.video.title} (${Math.round(o.score * 100)})`)
        .join(' || ')
      collection = result.options[0].video.collection
    } else if (result) {
      suggested++
      videoId = result.pair.video.videoId
      videoTitle = result.pair.video.title
      collection = result.pair.video.collection
      confidence = String(Math.round(result.pair.score * 100))
      why = result.pair.why || 'совпали слова названия'
      const webinar = result.pair.video.describe.webinar
      if (webinar !== null) {
        why += `; вебинар ${webinar}${webinar === topic.order_index ? ' = № темы' : ` ≠ № темы ${topic.order_index}`}`
      }
    } else {
      empty++
      why = 'уверенного совпадения нет'
    }

    let source = '', decision = ''
    if (inherited) {
      fromTemplate++
      source = 'из шаблона'
      decision = inherited
    }

    rows.push([
      course.title, topic.moduleTitle, topic.order_index, topic.title, topic.id,
      videoId, videoTitle, collection, confidence, why, alternatives, source, decision,
    ])
  }

  const unusedRows = videos
    .filter(v => !takenVideos.has(v.videoId))
    .map(v => [
      v.collection, v.title, v.videoId, v.embed, v.minutes,
      COLLECTION_MODULES[v.collection] ? 'подходящей темы не нашлось' : 'коллекция не разложена по модулям',
    ])

  mkdirSync(FLAGS.out, { recursive: true })
  const tag = slug(course.title, course.id)
  const matchPath = join(FLAGS.out, `bunny_match_${tag}.csv`)
  const unusedPath = join(FLAGS.out, `bunny_unused_${tag}.csv`)

  writeCsv(matchPath, REPORT_HEADER, rows)
  writeCsv(unusedPath,
    ['КОЛЛЕКЦИЯ', 'НАЗВАНИЕ', 'VideoId', 'ССЫЛКА', 'МИНУТ', 'ПОЧЕМУ НЕ ПРЕДЛОЖЕНО'], unusedRows)

  console.log('')
  console.log(`  Курс:        ${course.title}`)
  console.log(`  Тем:         ${topics.length}`)
  console.log(`  Видео в выгрузке: ${videos.length}`)
  console.log('')
  console.log(`  Предложено:  ${suggested}`)
  console.log(`  Неоднозначно: ${ambiguous}`)
  console.log(`  Без предложения: ${empty}`)
  if (FLAGS.reuse) console.log(`  Взято из шаблона: ${fromTemplate}`)
  console.log(`  Видео без темы: ${unusedRows.length}`)
  console.log('')
  console.log(`  Отчёт:       ${matchPath}`)
  console.log(`  Лишние:      ${unusedPath}`)
  console.log('')
  console.log('  Заполните колонку РЕШЕНИЕ (VideoId или «нет») и запустите с')
  console.log(`  --decisions "${matchPath}" --apply`)
  console.log('')
}

// ── Применение ───────────────────────────────────────────────────────────────

const videoIdFromUrl = url => (url ?? '').split('/').filter(Boolean).pop() ?? ''

async function runApply() {
  const { course, topics } = await loadCourse(FLAGS.course)
  const videos = loadVideos(FLAGS.csv)
  const videoById = new Map(videos.map(v => [v.videoId, v]))
  const topicById = new Map(topics.map(t => [t.id, t]))

  const decisions = readCsvFile(FLAGS.decisions)

  // Снимок «что было до»: видео у тем этого курса. Сейчас их ноль, но снимок
  // делается всегда — он стоит секунду, а восстанавливать без него нечем.
  mkdirSync(FLAGS.out, { recursive: true })
  const existingAll = []
  for (const topic of topics) {
    const rows = unwrap('чтение материалов', await db
      .from('topic_material_items')
      .select('id, kind, title, url, position, is_visible')
      .eq('topic_id', topic.id).eq('kind', 'video'))
    for (const r of rows) existingAll.push([topic.moduleTitle, topic.order_index, topic.title, topic.id, r.id, r.title, r.url])
  }
  const snapshotPath = join(FLAGS.out, `bunny_snapshot_${slug(course.title, course.id)}.csv`)
  writeCsv(snapshotPath, ['МОДУЛЬ', '№ ТЕМЫ', 'ТЕМА', 'TOPIC_ID', 'MATERIAL_ID', 'НАЗВАНИЕ', 'ССЫЛКА'], existingAll)

  const stats = { applied: 0 }
  const skipped = {}
  const note = (reason, line) => {
    if (!skipped[reason]) skipped[reason] = []
    skipped[reason].push(line)
  }

  for (const row of decisions) {
    const topicId = (row['TOPIC_ID'] ?? '').trim()
    const decision = (row['РЕШЕНИЕ'] ?? '').trim()
    const label = `${row['МОДУЛЬ']} №${row['№ ТЕМЫ']} ${row['ТЕМА']}`

    if (!decision) { note('решение не заполнено', label); continue }
    if (/^нет$/i.test(decision)) { note('владелец отказал («нет»)', label); continue }

    const topic = topicById.get(topicId)
    if (!topic) { note('темы нет в этом курсе', `${label} (${topicId})`); continue }

    const video = videoById.get(decision)
    if (!video) { note('такого VideoId нет в выгрузке', `${label} → ${decision}`); continue }

    const existing = unwrap('чтение видео темы', await db
      .from('topic_material_items').select('id, url').eq('topic_id', topicId).eq('kind', 'video'))

    const same = existing.find(r => videoIdFromUrl(r.url) === video.videoId)
    if (same) { note('уже стоит это же видео', label); continue }
    if (existing.length) {
      note('у темы уже другое видео — не подменяю', `${label} → ${existing.map(r => videoIdFromUrl(r.url)).join(', ')}`)
      continue
    }

    stats.applied++
    if (!APPLY) continue

    unwrap('вставка видео', await db.from('topic_material_items').insert({
      topic_id: topicId,
      kind: 'video',
      title: video.title.slice(0, 300),
      url: video.embed,
      position: 0,          // видео живёт на своей вкладке, с файлами за порядок не спорит
      is_visible: true,
      created_by: OWNER_PROFILE_ID,
    }))
  }

  const verb = APPLY ? 'Добавлено' : 'Будет добавлено'
  console.log('')
  console.log(`  Курс:      ${course.title}`)
  console.log(`  Решения:   ${FLAGS.decisions}`)
  console.log(`  Снимок до: ${snapshotPath} (было видео: ${existingAll.length})`)
  console.log('')
  console.log(`  ${verb}: ${stats.applied}`)
  for (const [reason, list] of Object.entries(skipped)) {
    console.log(`  Пропущено — ${reason}: ${list.length}`)
    for (const line of list.slice(0, 5)) console.log(`      · ${line}`)
    if (list.length > 5) console.log(`      … и ещё ${list.length - 5}`)
  }
  if (!APPLY) {
    console.log('')
    console.log('  Это была проба. Чтобы записать — тот же вызов с --apply.')
  }
  console.log('')
}

// ── Точка входа ──────────────────────────────────────────────────────────────

const main = FLAGS.decisions ? runApply : runMatch

main().catch(e => {
  console.error(`\n  ОСТАНОВ: ${e.message}\n`)
  process.exit(1)
})
