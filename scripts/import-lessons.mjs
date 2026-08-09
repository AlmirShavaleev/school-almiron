/**
 * import-lessons.mjs — раскладывает папку раздела с уроками в курс.
 *
 *   раздел (`01 Механика`)              → модуль
 *   папка урока (`Урок 07 - Название`)  → тема (закрытая, is_open = false)
 *   шесть PDF внутри                    → пять рубрик-материалов + ДЗ-черновик
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ. Запись включается только флагом `--apply`.
 *
 * Примеры:
 *   npm run import-course -- --dir "D:/…/01 Механика" --new "Физика ЕГЭ 2026-2027"
 *   npm run import-course -- --dir "D:/…/01 Механика" --course <uuid> --apply --limit-lessons 1
 *   npm run import-course -- --dir "D:/…/01 Механика" --course <uuid> --apply
 *
 * Ключ доступа берётся из `.env.import.local` / `.env` / окружения и никуда не
 * печатается. Если ключа нет — скрипт останавливается и просит добавить его в
 * файл самому: пересылать сервисный ключ в переписке нельзя.
 */

import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'

// ── Раскладка файлов урока ────────────────────────────────────────────────────
//
// Ключ — название файла БЕЗ ведущего номера. Номер отвечает только за порядок
// внутри урока и в ключ не входит намеренно: у владельца две формы уроков —
// с «Решением задач урока» (7 файлов) и без него (6), и во второй форме вся
// нумерация после третьего файла сдвинута на единицу. Привязка к номеру
// означала бы, что `05` — это то рабочий лист ДЗ, то само ДЗ.
//
// `ДЗ - задачи` — единственный файл, который едет не в материалы, а в контур
// ДЗ (`topic_homework` + `topic_homework_files`). Остальные — материалы темы,
// отличаются только рубрикой (`section`).

const SECTION_BY_LABEL = {
  'Конспект':             'notes',
  'Задачи урока':         'tasks',
  'Решение задач урока':  'task_solution',
  'Рабочий лист урока':   'worksheet_tasks',
  'ДЗ - рабочий лист':    'worksheet_homework',
  'Решение ДЗ':           'solution',
}

const HOMEWORK_LABEL = 'ДЗ - задачи'

/**
 * Все рубрики, какие принимает `topic_material_items_section_check`. Список
 * шире, чем SECTION_BY_LABEL: «Теория» ни одному файлу урока не соответствует,
 * но нужна для плоских разделов (`--flat --section theory`). Разъехавшись с
 * базой, он даёт не ошибку типов, а отказ вставки — как в §95.
 */
const ALLOWED_SECTIONS = [
  'notes', 'theory', 'tasks', 'task_solution',
  'worksheet_tasks', 'worksheet_homework', 'solution',
]

/**
 * Что обязано быть в каждом уроке. «Решение задач урока» сюда не входит: в
 * 25 уроках из 53 его нет, и это не потеря, а вторая форма урока.
 */
const REQUIRED_LABELS = [
  'Конспект', 'Задачи урока', 'Рабочий лист урока',
  HOMEWORK_LABEL, 'ДЗ - рабочий лист', 'Решение ДЗ',
]

/** `03 Решение задач урока.pdf` → { order: 3, label: 'Решение задач урока' }. */
function parseLessonFileName(name) {
  const m = name.match(/^(\d+)\s+(.+)\.pdf$/i)
  return m ? { order: Number(m[1]), label: m[2].trim() } : null
}

/**
 * Имя файла без ведущего номера — им же сверяется идемпотентность.
 *
 * Сравнивать полные имена нельзя: одна и та же «Решение ДЗ» лежит в одной
 * форме уроков шестым файлом, в другой седьмым. По полному имени повторный
 * прогон принял бы её за новый файл и задвоил рубрику.
 */
function fileLabel(name) {
  return parseLessonFileName(name)?.label ?? name
}

const MATERIALS_BUCKET = 'topic-materials'
const HOMEWORK_BUCKET  = 'topic-homework'

const HOMEWORK_TITLE = 'Домашнее задание'

/** Профиль владельца (owner@almiron.ru). Под service role `auth.uid()` пуст,
 *  поэтому владельца курса и автора материалов приходится называть явно —
 *  иначе курс остался бы без owner_id, а группа (§61) без преподавателя. */
const OWNER_PROFILE_ID = '4972e1a0-4e4b-489b-8f84-5f735b597c11'

/** Значения enum `subject_type` в базе. */
const COURSE_SUBJECTS = ['physics', 'math', 'algebra', 'geometry', 'probability_statistics']
const COURSE_EXAM_TYPE = 'ege'

/** Папки, которые в этот заход не трогаем по решению владельца. */
const SKIP_DIRS = new Set([
  '99 Дополнительные материалы',
  'Теория и Шпаргалки', 'Теория и шпаргалки', '00 Пробные варианты',
])

const MAX_RETRIES  = 3
const RETRY_BASE_MS = 800

// ── Аргументы ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)

function getArg(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const FLAGS = {
  dir:          getArg('--dir'),
  course:       getArg('--course'),
  newCourse:    getArg('--new'),
  apply:        argv.includes('--apply'),
  cleanOrphans: argv.includes('--clean-orphans'),
  limitLessons: getArg('--limit-lessons') ? Number(getArg('--limit-lessons')) : undefined,
  only:         getArg('--only'),
  flat:         argv.includes('--flat'),
  section:      getArg('--section') ?? 'theory',
  subject:      getArg('--subject') ?? 'physics',
  moduleOrder:  getArg('--module-order') ? Number(getArg('--module-order')) : undefined,
}

const APPLY = FLAGS.apply

function die(message) {
  console.error(`\n  ОСТАНОВ: ${message}\n`)
  process.exit(1)
}

if (!FLAGS.dir) die('не указан --dir "<папка раздела>"')
if (!FLAGS.course && !FLAGS.newCourse) die('нужен либо --course <uuid>, либо --new "Название курса"')
if (FLAGS.course && FLAGS.newCourse) die('--course и --new вместе не имеют смысла')
if (!existsSync(FLAGS.dir)) die(`папка не найдена: ${FLAGS.dir}`)
if (!COURSE_SUBJECTS.includes(FLAGS.subject)) {
  die(`предмет «${FLAGS.subject}» не входит в enum subject_type. Допустимы: ${COURSE_SUBJECTS.join(', ')}`)
}
if (FLAGS.flat && !ALLOWED_SECTIONS.includes(FLAGS.section)) {
  die(`рубрика «${FLAGS.section}» не входит в CHECK базы. Допустимы: ${ALLOWED_SECTIONS.join(', ')}`)
}

// ── Доступ ───────────────────────────────────────────────────────────────────

/**
 * Мини-парсер .env: подключать dotenv ради трёх строк не хочется, а зависимость
 * в проде не нужна. Значения нигде не логируются.
 */
function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const env = {
  ...readEnvFile(join(process.cwd(), '.env')),
  ...readEnvFile(join(process.cwd(), '.env.import.local')),
  ...process.env,
}

const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) die('в .env нет VITE_SUPABASE_URL')
if (!SERVICE_KEY) {
  die(
    'в .env.import.local нет SUPABASE_SERVICE_ROLE_KEY.\n' +
    '  Добавьте строку `SUPABASE_SERVICE_ROLE_KEY=<ключ>` в файл сами — файл уже\n' +
    '  в .gitignore. Присылать ключ в переписку не нужно.',
  )
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── Имена ────────────────────────────────────────────────────────────────────

/**
 * Транслитерация и путь в бакете — копия `src/lib/topicMaterialItems.ts`.
 * Копия, а не импорт: скрипт на .mjs, исходник на TypeScript, тянуть сюда сборку
 * ради двух функций дороже, чем продублировать их с этой пометкой. Правило
 * одно: Storage принимает только ASCII-ключи, оригинальное имя живёт в колонке
 * `file_name` / `original_filename`.
 */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

function sanitizeStorageFileName(fileName) {
  const raw = (fileName || 'file').trim()
  const dot = raw.lastIndexOf('.')
  const base = dot > 0 ? raw.slice(0, dot) : raw
  const ext  = dot > 0 ? raw.slice(dot + 1) : ''

  const translitBase = base
    .toLowerCase()
    .split('')
    .map(ch => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
  const safeBase = translitBase.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file'
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10)
  return safeExt ? `${safeBase}.${safeExt}` : safeBase
}

function buildStoragePath(topicId, fileName) {
  return `${topicId}/${Date.now()}_${sanitizeStorageFileName(fileName)}`
}

/**
 * Имя папки раздела → заголовок модуля и его место в курсе.
 *
 *   `01 Механика`            → 1,  «Механика»          (номер служебный, в заголовок не идёт)
 *   `№13`                    → 13, «№13»               (номер задания — часть названия, остаётся)
 *   `№4-5 Теория вероятности`→ 4,  «№4-5 Теория вероятности»
 *   `МЕГАДЗ`                 → из `--module-order`, иначе 1
 *
 * Разница между первым и вторым случаем не косметическая: у физики номер папки
 * это порядок раздела, у математики — номер задания ЕГЭ, и выкинуть его из
 * заголовка значило бы превратить «№13» в пустую строку.
 */
function parseSectionName(name) {
  const cleaned = name.trim().replace(/\s{2,}/g, ' ')

  const task = cleaned.match(/^№\s*(\d+)/)
  if (task) return { order: FLAGS.moduleOrder ?? Number(task[1]), title: cleaned }

  const numbered = cleaned.match(/^(\d+)\s+(.+)$/)
  if (numbered) return { order: FLAGS.moduleOrder ?? Number(numbered[1]), title: numbered[2].trim() }

  return { order: FLAGS.moduleOrder ?? 1, title: cleaned }
}

/** `Урок 07 - Название` → { order: 7, title: 'Название' }. Не урок — null. */
function parseLessonName(name) {
  const m = name.match(/^Урок\s+(\d+)\s+-\s+(.+)$/)
  if (!m) return null
  return { order: Number(m[1]), title: m[2].trim() }
}

/**
 * Названия, испорченные чисткой имён файлов: `remove_shkolkovo.py` заменил
 * запрещённые в путях символы подчёркиванием, и «…на динамику?» стало
 * «…на динамику_». Чинить догадкой нельзя — восстановишь не тот знак и молча.
 * Поэтому только помечаем, переименует владелец в интерфейсе.
 */
function looksMangled(title) {
  return /_/.test(title) || /[,\s]$/.test(title)
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

function humanBytes(n) {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Сетевые операции спотыкаются поодиночке; три попытки с паузой дешевле, чем перезапуск на 200-м файле. */
async function withRetry(label, fn) {
  let lastError
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_MS * attempt)
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? lastError}`)
}

/** Обёртка PostgREST: ошибку превращаем в исключение, чтобы её не проглотили. */
function unwrap(label, { data, error }) {
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

// ── Отчёт ────────────────────────────────────────────────────────────────────

const stats = {
  courseCreated: false,
  modulesCreated: 0, modulesReused: 0, moduleRenamed: false,
  topicsCreated: 0, topicsExisting: 0,
  materialsCreated: 0, materialsSkipped: 0,
  homeworksCreated: 0, homeworksExisting: 0,
  homeworkFilesCreated: 0, homeworkFilesSkipped: 0,
  bytesUploaded: 0,
}

const notes = {
  mangledTitles: [],   // названия с подчёркиваниями — владельцу на переименование
  titleDrift: [],      // тема на месте, но название разошлось
  changedOnDisk: [],   // файл в базе есть, размер другой — НЕ перезаливаем
  unexpectedFiles: [], // файлы не по шаблону
  missingFiles: [],    // недостающие файлы урока
  emptyLessons: [],    // папки уроков без единого файла
  orphans: [],         // объекты в Storage, на которые не ссылается ни одна строка
  skippedDirs: [],
  failures: [],        // что упало и на чём
}

// ── Чтение диска ─────────────────────────────────────────────────────────────

function scanSection(dir) {
  const section = parseSectionName(basename(dir))
  const lessons = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      // служебные json/py/bat рядом с уроками — не наше дело
      continue
    }
    if (SKIP_DIRS.has(entry.name)) {
      notes.skippedDirs.push(entry.name)
      continue
    }
    const parsed = parseLessonName(entry.name)
    if (!parsed) {
      notes.unexpectedFiles.push(`папка не по шаблону «Урок NN - Название»: ${entry.name}`)
      continue
    }

    const lessonDir = join(dir, entry.name)
    const files = readdirSync(lessonDir, { withFileTypes: true })
      .filter(f => f.isFile())
      .map(f => f.name)

    // Пустая папка урока — не тема без материалов, а незалитый урок. Создавать
    // из неё пустую тему значит показать преподавателю пустышку, которую он
    // примет за поломку. Пропускаем и говорим об этом вслух.
    if (!files.length) {
      notes.emptyLessons.push(entry.name)
      continue
    }

    const recognised = new Map()   // label → { fileName, order }
    for (const name of files) {
      const file = parseLessonFileName(name)
      if (!file || (file.label !== HOMEWORK_LABEL && !SECTION_BY_LABEL[file.label])) {
        notes.unexpectedFiles.push(`${entry.name} / ${name}`)
        continue
      }
      if (recognised.has(file.label)) {
        notes.unexpectedFiles.push(`${entry.name} / ${name} — второй файл той же рубрики, взят первый`)
        continue
      }
      recognised.set(file.label, { fileName: name, order: file.order })
    }

    for (const label of REQUIRED_LABELS) {
      if (!recognised.has(label)) notes.missingFiles.push(`${entry.name} / нет «${label}»`)
    }

    if (looksMangled(parsed.title)) notes.mangledTitles.push(`№${parsed.order} — ${parsed.title}`)

    const materials = [...recognised.entries()]
      .filter(([label]) => label !== HOMEWORK_LABEL)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([label, file], index) => ({
        fileName: file.fileName,
        section: SECTION_BY_LABEL[label],
        path: join(lessonDir, file.fileName),
        size: statSync(join(lessonDir, file.fileName)).size,
        position: index,
      }))

    const homeworkFile = recognised.get(HOMEWORK_LABEL)
    const homework = homeworkFile
      ? {
          fileName: homeworkFile.fileName,
          path: join(lessonDir, homeworkFile.fileName),
          size: statSync(join(lessonDir, homeworkFile.fileName)).size,
        }
      : null

    lessons.push({ dirName: entry.name, order: parsed.order, title: parsed.title, materials, homework })
  }

  lessons.sort((a, b) => a.order - b.order)
  return { section, lessons }
}

/**
 * «Плоский» раздел: папок-уроков нет, лежат просто документы (`07 Оформление`).
 *
 * Тема собирается по номеру задания в имени файла: «Правила оформления №24» и
 * «Правила_оформления_№24_ЕГЭ_2026_по_физике» — два документа про одно и то же,
 * и человеку нужны они рядом, а не двумя почти одинаковыми темами. Файл без
 * номера становится темой сам по себе. ДЗ у такого раздела нет по определению.
 *
 * Возвращает тот же вид, что и `scanSection`, поэтому дальше по коду разницы
 * между плоским и обычным разделом уже нет.
 */
function scanFlatSection(dir) {
  const section = parseSectionName(basename(dir))

  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) { notes.skippedDirs.push(entry.name); continue }
        walk(join(current, entry.name))
      } else if (/\.pdf$/i.test(entry.name)) {
        files.push({ name: entry.name, path: join(current, entry.name) })
      } else {
        notes.unexpectedFiles.push(entry.name)
      }
    }
  }
  walk(dir)

  const groups = new Map()   // ключ темы → { title, files[] }
  for (const file of files) {
    const number = file.name.match(/№\s*(\d+(?:\s*[-–]\s*\d+)?)/)
    const key = number ? number[1].replace(/\s+/g, '') : file.name
    const title = number ? `${section.title} №${key}` : stripPdfExtension(file.name)
    if (!groups.has(key)) groups.set(key, { title, files: [] })
    groups.get(key).files.push(file)
  }

  const lessons = [...groups.values()]
    .sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true }))
    .map((group, index) => ({
      dirName: group.title,
      order: index + 1,
      title: group.title,
      materials: group.files
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((file, position) => ({
          fileName: file.name,
          section: FLAGS.section,
          path: file.path,
          size: statSync(file.path).size,
          position,
        })),
      homework: null,
    }))

  return { section, lessons }
}

function stripPdfExtension(name) {
  return name.replace(/\.pdf$/i, '')
}

// ── Курс и модуль ────────────────────────────────────────────────────────────

async function resolveCourse() {
  if (FLAGS.course) {
    const rows = unwrap('чтение курса', await db
      .from('courses').select('id, title').eq('id', FLAGS.course).limit(1))
    if (!rows?.length) die(`курс ${FLAGS.course} не найден`)
    return { id: rows[0].id, title: rows[0].title, createdNow: false }
  }

  if (!APPLY) return { id: null, title: FLAGS.newCourse, createdNow: true }

  const row = unwrap('создание курса', await db
    .from('courses')
    .insert({
      title: FLAGS.newCourse,
      subject: FLAGS.subject,
      exam_type: COURSE_EXAM_TYPE,
      owner_id: OWNER_PROFILE_ID,
      is_draft: false,
    })
    .select('id, title')
    .single())

  stats.courseCreated = true
  return { id: row.id, title: row.title, createdNow: true }
}

/**
 * Модуль раздела.
 *
 * Триггер `courses_default_module` кладёт в каждый новый курс пустой модуль
 * «Основной». Если курс создан этим же прогоном и модуль единственный и без
 * тем — переименовываем его, чтобы в курсе не висела пустышка первой строкой.
 * Во всех остальных случаях (импорт в существующий курс, второй раздел в тот
 * же курс) «Основной» не трогаем и заводим отдельный модуль.
 */
async function resolveModule(course, section) {
  // Курса ещё нет (проба с --new): модуль будет тем самым «Основным» после переименования
  if (!course.id) {
    stats.moduleRenamed = true
    return { id: null, createdNow: true }
  }

  const existing = unwrap('чтение модулей', await db
    .from('modules').select('id, title, order_index').eq('course_id', course.id).order('order_index'))

  const byTitle = existing.find(m => m.title === section.title)
  if (byTitle) {
    stats.modulesReused++
    return { id: byTitle.id, createdNow: false }
  }

  if (course.createdNow && existing.length === 1 && existing[0].title === 'Основной') {
    const topics = unwrap('проверка пустоты модуля', await db
      .from('topics').select('id').eq('module_id', existing[0].id).limit(1))
    if (!topics.length) {
      if (APPLY) {
        unwrap('переименование модуля', await db
          .from('modules')
          .update({ title: section.title, order_index: section.order })
          .eq('id', existing[0].id))
      }
      stats.moduleRenamed = true
      return { id: existing[0].id, createdNow: false }
    }
  }

  stats.modulesCreated++
  if (!APPLY) return { id: null, createdNow: true }

  const row = unwrap('создание модуля', await db
    .from('modules')
    .insert({ course_id: course.id, title: section.title, order_index: section.order })
    .select('id')
    .single())

  return { id: row.id, createdNow: true }
}

// ── Тема, материалы, ДЗ ──────────────────────────────────────────────────────

async function resolveTopic(moduleId, lesson) {
  if (!moduleId) {
    stats.topicsCreated++
    return null
  }

  const rows = unwrap('чтение тем', await db
    .from('topics').select('id, title').eq('module_id', moduleId).eq('order_index', lesson.order).limit(1))

  if (rows.length) {
    stats.topicsExisting++
    if (rows[0].title !== lesson.title) {
      notes.titleDrift.push(`№${lesson.order}: в базе «${rows[0].title}», на диске «${lesson.title}»`)
    }
    return rows[0].id
  }

  stats.topicsCreated++
  if (!APPLY) return null

  const row = unwrap('создание темы', await db
    .from('topics')
    .insert({ module_id: moduleId, title: lesson.title, order_index: lesson.order, is_open: false })
    .select('id')
    .single())
  return row.id
}

/**
 * Заливает файл и вставляет строку. Если вставка упала — только что залитый
 * объект убираем: иначе в бакете остаётся сирота, на которую никто не ссылается.
 */
async function uploadAndInsert({ bucket, topicId, fileName, diskPath, insert }) {
  const body = readFileSync(diskPath)
  const storagePath = buildStoragePath(topicId, fileName)

  await withRetry(`загрузка ${fileName}`, async () => {
    const { error } = await db.storage.from(bucket).upload(storagePath, body, {
      contentType: 'application/pdf',
      upsert: false,
    })
    if (error) throw error
  })

  try {
    await withRetry(`вставка ${fileName}`, async () => {
      const { error } = await insert(storagePath, body.length)
      if (error) throw error
    })
  } catch (e) {
    await db.storage.from(bucket).remove([storagePath]).catch(() => {})
    throw e
  }

  stats.bytesUploaded += body.length
  return storagePath
}

async function importMaterials(topicId, lesson) {
  let existing = []
  if (topicId) {
    existing = unwrap('чтение материалов', await db
      .from('topic_material_items')
      .select('id, section, file_name, size_bytes, position')
      .eq('topic_id', topicId))
  }

  let nextPosition = existing.reduce((max, r) => Math.max(max, r.position + 1), 0)

  for (const material of lesson.materials) {
    const already = existing.find(r =>
      r.section === material.section && fileLabel(r.file_name ?? '') === fileLabel(material.fileName))
    if (already) {
      stats.materialsSkipped++
      if (already.size_bytes != null && Number(already.size_bytes) !== material.size) {
        notes.changedOnDisk.push(
          `${lesson.dirName} / ${material.fileName}: в базе ${humanBytes(Number(already.size_bytes))}, ` +
          `на диске ${humanBytes(material.size)} — оставлено как есть`,
        )
      }
      continue
    }

    stats.materialsCreated++
    if (!APPLY || !topicId) {
      stats.bytesUploaded += material.size
      continue
    }

    const position = nextPosition++
    await uploadAndInsert({
      bucket: MATERIALS_BUCKET,
      topicId,
      fileName: material.fileName,
      diskPath: material.path,
      insert: (storagePath, size) => db.from('topic_material_items').insert({
        topic_id: topicId,
        kind: 'file',
        section: material.section,
        storage_path: storagePath,
        file_name: material.fileName,
        mime_type: 'application/pdf',
        size_bytes: size,
        position,
        is_visible: true,
        created_by: OWNER_PROFILE_ID,
      }),
    })
  }
}

async function importHomework(topicId, lesson) {
  if (!lesson.homework) return

  let homeworkId = null

  if (topicId) {
    const rows = unwrap('чтение ДЗ', await db
      .from('topic_homework').select('id').eq('topic_id', topicId).limit(1))
    if (rows.length) {
      homeworkId = rows[0].id
      stats.homeworksExisting++
    }
  }

  if (!homeworkId) {
    stats.homeworksCreated++
    if (APPLY && topicId) {
      // UNIQUE (topic_id) в базе — вторая строка ДЗ на тему невозможна в принципе
      const row = unwrap('создание ДЗ', await db
        .from('topic_homework')
        .insert({
          topic_id: topicId,
          title: HOMEWORK_TITLE,
          is_published: false,   // черновик: ученик не видит, очередь уведомлений молчит
          created_by: OWNER_PROFILE_ID,
        })
        .select('id')
        .single())
      homeworkId = row.id
    }
  }

  const existing = homeworkId
    ? unwrap('чтение файлов ДЗ', await db
        .from('topic_homework_files')
        .select('id, original_filename, size_bytes, position')
        .eq('homework_id', homeworkId))
    : []

  const already = existing.find(f => fileLabel(f.original_filename) === fileLabel(lesson.homework.fileName))
  if (already) {
    stats.homeworkFilesSkipped++
    if (already.size_bytes != null && Number(already.size_bytes) !== lesson.homework.size) {
      notes.changedOnDisk.push(
        `${lesson.dirName} / ${lesson.homework.fileName}: в базе ${humanBytes(Number(already.size_bytes))}, ` +
        `на диске ${humanBytes(lesson.homework.size)} — оставлено как есть`,
      )
    }
    return
  }

  stats.homeworkFilesCreated++
  if (!APPLY || !homeworkId || !topicId) {
    stats.bytesUploaded += lesson.homework.size
    return
  }

  const position = existing.reduce((max, f) => Math.max(max, f.position + 1), 0)
  await uploadAndInsert({
    bucket: HOMEWORK_BUCKET,
    topicId,
    fileName: lesson.homework.fileName,
    diskPath: lesson.homework.path,
    insert: (storagePath, size) => db.from('topic_homework_files').insert({
      homework_id: homeworkId,
      storage_path: storagePath,
      original_filename: lesson.homework.fileName,
      mime_type: 'application/pdf',
      size_bytes: size,
      position,
    }),
  })
}

/**
 * Сироты в Storage: объект залит, а строка на него так и не появилась.
 *
 * Такое даёт не ошибка вставки (её мы убираем сами), а жёсткий обрыв процесса
 * между загрузкой и вставкой — от него защититься нельзя, догнать можно только
 * потом. Пересчитываем содержимое папки темы в обоих бакетах и сверяем со
 * строками. По умолчанию только показываем: удаление файлов — не та операция,
 * которую импортёр делает молча. Убирает их `--clean-orphans`.
 */
async function reportOrphans(topicId) {
  if (!topicId) return

  const referenced = new Set()
  for (const row of unwrap('пути материалов', await db
    .from('topic_material_items').select('storage_path').eq('topic_id', topicId))) {
    if (row.storage_path) referenced.add(`${MATERIALS_BUCKET}|${row.storage_path}`)
  }
  const homework = unwrap('чтение ДЗ темы', await db
    .from('topic_homework').select('id').eq('topic_id', topicId).limit(1))
  if (homework.length) {
    for (const row of unwrap('пути файлов ДЗ', await db
      .from('topic_homework_files').select('storage_path').eq('homework_id', homework[0].id))) {
      referenced.add(`${HOMEWORK_BUCKET}|${row.storage_path}`)
    }
  }

  for (const bucket of [MATERIALS_BUCKET, HOMEWORK_BUCKET]) {
    const { data, error } = await db.storage.from(bucket).list(topicId, { limit: 1000 })
    if (error) throw new Error(`список бакета ${bucket}: ${error.message}`)

    const stale = (data ?? [])
      .map(o => `${topicId}/${o.name}`)
      .filter(path => !referenced.has(`${bucket}|${path}`))

    for (const path of stale) notes.orphans.push(`${bucket} / ${path}`)

    if (stale.length && APPLY && FLAGS.cleanOrphans) {
      const { error: removeError } = await db.storage.from(bucket).remove(stale)
      if (removeError) throw new Error(`уборка сирот в ${bucket}: ${removeError.message}`)
    }
  }
}

// ── Прогон ───────────────────────────────────────────────────────────────────

async function countQueue() {
  const { count, error } = await db
    .from('notification_queue').select('*', { count: 'exact', head: true })
  if (error) throw new Error(`чтение очереди уведомлений: ${error.message}`)
  return count ?? 0
}

async function main() {
  const startedAt = Date.now()

  const { section, lessons: allLessons } = FLAGS.flat
    ? scanFlatSection(FLAGS.dir)
    : scanSection(FLAGS.dir)

  let lessons = allLessons
  if (FLAGS.only) lessons = lessons.filter(l => l.dirName.includes(FLAGS.only))
  if (FLAGS.limitLessons) lessons = lessons.slice(0, FLAGS.limitLessons)

  const totalBytes = allLessons.reduce(
    (sum, l) => sum + l.materials.reduce((s, m) => s + m.size, 0) + (l.homework?.size ?? 0), 0)

  console.log('')
  console.log(`  Режим:   ${APPLY ? 'ЗАПИСЬ (--apply)' : 'ПРОБА (--dry-run по умолчанию, ничего не пишется)'}`)
  console.log(`  Папка:   ${FLAGS.dir}`)
  console.log(`  Раздел:  «${section.title}» (order_index ${section.order})`)
  console.log(`  Уроков:  ${lessons.length} из ${allLessons.length} найденных, ${humanBytes(totalBytes)} всего в разделе`)
  console.log(`  Курс:    ${FLAGS.course ? FLAGS.course : `новый «${FLAGS.newCourse}»`}`)
  console.log('')

  const queueBefore = await countQueue()
  console.log(`  notification_queue до прогона: ${queueBefore}`)

  const course = await resolveCourse()
  const module = await resolveModule(course, section)

  for (const lesson of lessons) {
    try {
      const topicId = await resolveTopic(module.id, lesson)
      await importMaterials(topicId, lesson)
      await importHomework(topicId, lesson)
      await reportOrphans(topicId)
      if (APPLY) console.log(`  ✓ №${String(lesson.order).padStart(2, '0')} ${lesson.title}`)
    } catch (e) {
      notes.failures.push(`${lesson.dirName}: ${e.message}`)
      console.error(`  ✗ №${lesson.order} ${lesson.title} — ${e.message}`)
    }
  }

  const queueAfter = await countQueue()

  // ── Итоги ──
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
  const verb = APPLY ? 'создано' : 'будет создано'

  console.log('')
  console.log('  ─────────────────────────────────────────────')
  console.log(`  Курс:        ${stats.courseCreated ? 'создан' : APPLY || FLAGS.course ? 'существующий' : 'будет создан'}`)
  console.log(`  Модуль:      ${stats.moduleRenamed
    ? `«Основной» ${APPLY ? 'переименован' : 'будет переименован'} в «${section.title}»`
    : stats.modulesCreated ? `${verb} ${stats.modulesCreated}` : `существующий «${section.title}»`}`)
  console.log(`  Темы:        ${verb} ${stats.topicsCreated}, уже было ${stats.topicsExisting}`)
  console.log(`  Материалы:   ${verb} ${stats.materialsCreated}, пропущено ${stats.materialsSkipped}`)
  console.log(`  ДЗ:          ${verb} ${stats.homeworksCreated} (черновики), уже было ${stats.homeworksExisting}`)
  console.log(`  Файлы ДЗ:    ${verb} ${stats.homeworkFilesCreated}, пропущено ${stats.homeworkFilesSkipped}`)
  console.log(`  Объём:       ${humanBytes(stats.bytesUploaded)}`)
  console.log(`  Время:       ${seconds} с`)
  console.log(`  Очередь уведомлений: ${queueBefore} → ${queueAfter}` +
    (queueAfter === queueBefore ? ' (не изменилась)' : '  ← ВНИМАНИЕ, изменилась'))

  const block = (title, items) => {
    if (!items.length) return
    console.log('')
    console.log(`  ${title} (${items.length}):`)
    for (const item of items) console.log(`    · ${item}`)
  }

  block('Названия испорчены чисткой имён — переименовать в интерфейсе', notes.mangledTitles)
  block('Название темы разошлось с диском — оставлено как в базе', notes.titleDrift)
  block('Файл изменился на диске — НЕ перезалит', notes.changedOnDisk)
  block(
    FLAGS.cleanOrphans && APPLY
      ? 'Сироты в Storage — УБРАНЫ (--clean-orphans)'
      : 'Сироты в Storage (обрыв между загрузкой и вставкой) — убрать флагом --clean-orphans',
    notes.orphans,
  )
  block('Файлы не по шаблону', notes.unexpectedFiles)
  block('Недостающие файлы урока', notes.missingFiles)
  block('Пустые папки уроков — тема НЕ создана', notes.emptyLessons)
  block('Пропущенные папки (решение владельца)', notes.skippedDirs)
  block('ОШИБКИ — перезапустите скрипт, он догонит по идемпотентности', notes.failures)

  if (!APPLY) {
    console.log('')
    console.log('  Это была проба. Чтобы записать — тот же вызов с --apply.')
  }
  console.log('')

  if (notes.failures.length) process.exit(1)
}

main().catch(e => {
  console.error(`\n  ОСТАНОВ: ${e.message}\n`)
  process.exit(1)
})
