/**
 * import-trenirovka.mjs — загрузчик задачника по кодификатору в темы курса
 * «Физика ЕГЭ» (§234, вкладка «Тренировка»).
 *
 *   207 подтем × 7 PDF  →  topic_material_items (track = 'training') тем ШАБЛОНА
 *
 * Пишет только в темы шаблона (`template_topic_id` из раскладки); три
 * класса-копии догоняет триггер синхронизации каркаса (§172) — сам скрипт в
 * них не пишет ничего. Каждая вставка в шаблон запускает синхронизацию темы
 * в копии (~1 с на строку), поэтому подтема (7 строк) уходит ОДНИМ запросом.
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ (сухой прогон): проверяет, что все файлы на
 * месте и темы шаблона существуют, печатает сводку. Запись — только `--apply`.
 *
 *   node scripts/import-trenirovka.mjs                     сухой прогон, все подтемы
 *   node scripts/import-trenirovka.mjs --only 1.17         сухой прогон одной подтемы
 *   node scripts/import-trenirovka.mjs --apply --only 1.17 загрузить одну подтему
 *   node scripts/import-trenirovka.mjs --apply             загрузить всё
 *   … --root "E:\Задачник"                                 другой корень задачника
 *
 * Математика (§234.1) — та же команда со своей раскладкой в «явном» формате
 * (`"format": "explicit"`, у файла сразу `{ name, section, label }`):
 *   node scripts/import-trenirovka.mjs --mapping scripts/trenirovka-math-mapping.json [--apply] [--only 1.2]
 *
 * Ключи — из `.env.import.local` / `.env` / окружения (те же имена, что у
 * import-lessons: VITE_SUPABASE_URL или SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 * Значения ключей не печатаются никогда.
 *
 * Повторный запуск безопасен: уже загруженное (тема + подтема + рубрика)
 * пропускается. Обрыв посередине не оставляет файла без строки: если вставка
 * подтемы не удалась, только что залитые файлы убираются из Storage.
 * Лог — `scripts/trenirovka-import-log.json`.
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  buildPlan, insertRows, missingFiles, parseOnly, summarizePlan,
} from './trenirovka-plan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MATERIALS_BUCKET = 'topic-materials'
const DEFAULT_ROOT = 'D:\\Задачник'
const DEFAULT_MAPPING = join(HERE, 'trenirovka-mapping.json')
const LOG_PATH = join(HERE, 'trenirovka-import-log.json')

/** Профиль владельца (как в import-lessons): под service role auth.uid() пуст. */
const OWNER_PROFILE_ID = '4972e1a0-4e4b-489b-8f84-5f735b597c11'

// ── Аргументы ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
function getArg(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const FLAGS = {
  apply: argv.includes('--apply'),
  only: parseOnly(getArg('--only')),
  root: getArg('--root') ?? DEFAULT_ROOT,
  mapping: getArg('--mapping') ?? DEFAULT_MAPPING,
}

function die(message) {
  console.error(`\n  ОСТАНОВ: ${message}\n`)
  process.exit(1)
}

// ── Доступ (как в import-lessons: мини-парсер .env, значения не печатаются) ──

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
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

// ── Имена в Storage — копия import-lessons (и src/lib/topicMaterialItems.ts) ─

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
  const ext = dot > 0 ? raw.slice(dot + 1) : ''
  const translitBase = base.toLowerCase().split('')
    .map(ch => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch)).join('')
  const safeBase = translitBase.replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'file'
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10)
  return safeExt ? `${safeBase}.${safeExt}` : safeBase
}
function buildStoragePath(topicId, fileName) {
  return `${topicId}/${Date.now()}_${sanitizeStorageFileName(fileName)}`
}

// ── Мелочи ───────────────────────────────────────────────────────────────────

function humanBytes(n) {
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}
const seconds = ms => `${(ms / 1000).toFixed(1)} с`
/** Склонение при числе — правило то же, что в src/lib/plural.ts. */
function plural(n, one, few, many) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}
const nSubtopics = n => `${n} ${plural(n, 'подтема', 'подтемы', 'подтем')}`
const nFiles = n => `${n} ${plural(n, 'файл', 'файла', 'файлов')}`
const nTopics = n => `${n} ${plural(n, 'тема', 'темы', 'тем')}`
function diskPath(relPath) {
  return join(FLAGS.root, ...relPath.split('/'))
}
function unwrap(label, { data, error }) {
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

/** Чтение страницами: строк тренировки больше, чем PostgREST отдаёт за раз. */
async function fetchAll(label, makeQuery) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const rows = unwrap(label, await makeQuery().range(from, from + 999))
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

// ── Главное ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(FLAGS.mapping)) die(`нет раскладки ${FLAGS.mapping}`)
  const mapping = JSON.parse(readFileSync(FLAGS.mapping, 'utf8'))
  const { subtopics, problems } = buildPlan(mapping, { only: FLAGS.only })
  const sum = summarizePlan(subtopics)

  console.log(`\nЗадачник → «Тренировка» (${FLAGS.apply ? 'ЗАГРУЗКА' : 'сухой прогон, ничего не пишется'})`)
  console.log(`  раскладка: ${FLAGS.mapping}`)
  // §234.1: «явная» раскладка (математика) — роли файлов заданы в ней самой.
  if (mapping.format === 'explicit') console.log(`  формат раскладки: явный (роль файла — из раскладки), шаблон ${mapping.template_course_id}`)
  console.log(`  корень задачника: ${FLAGS.root}`)
  console.log(`  в плане: ${nSubtopics(sum.subtopics)}, ${nFiles(sum.files)}, ${nTopics(sum.topics)} шаблона`)

  // 1. Файлы на диске.
  const absent = []
  let bytes = 0
  for (const s of subtopics) {
    for (const f of s.files) {
      const p = diskPath(f.relPath)
      if (!existsSync(p)) { absent.push(p); continue }
      f.size = statSync(p).size
      bytes += f.size
    }
  }
  console.log(`  на диске: ${sum.files - absent.length} из ${nFiles(sum.files)}, ${humanBytes(bytes)}`)

  // 2. Темы шаблона и уже загруженное — если есть доступ к базе.
  let db = null
  let existing = []
  const topicProblems = []
  if (!SUPABASE_URL || !SERVICE_KEY) {
    const why = !SUPABASE_URL ? 'нет VITE_SUPABASE_URL' : 'нет SUPABASE_SERVICE_ROLE_KEY'
    if (FLAGS.apply) {
      die(`${why} в .env.import.local. Добавьте строку сами — файл в .gitignore, присылать ключ в переписку не нужно.`)
    }
    console.log(`  база: не проверялась (${why} в .env.import.local) — проверены только файлы`)
  } else {
    db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const topicIds = [...new Set(subtopics.map(s => s.topicId))]
    const topics = topicIds.length
      ? unwrap('чтение тем', await db.from('topics').select('id, title, modules(course_id)').in('id', topicIds))
      : []
    for (const id of topicIds) {
      const t = topics.find(x => x.id === id)
      const sample = subtopics.find(s => s.topicId === id)
      if (!t) topicProblems.push(`тема ${id}${sample?.topicTitle ? ` («${sample.topicTitle}»)` : ''} не найдена`)
      else if (t.modules?.course_id !== mapping.template_course_id) {
        topicProblems.push(`тема ${id} («${t.title}») не из шаблона ${mapping.template_course_id}`)
      }
      // В «явной» раскладке названия темы нет — берём из базы для прогресса.
      if (t) for (const s of subtopics) if (s.topicId === id && !s.topicTitle) s.topicTitle = t.title
    }
    if (topicIds.length) {
      existing = await fetchAll('чтение загруженного', () => db
        .from('topic_material_items')
        .select('topic_id, subtopic_code, section')
        .eq('track', 'training')
        .in('topic_id', topicIds))
    }
    console.log(`  темы шаблона: ${topicIds.length - topicProblems.length} из ${topicIds.length} на месте`)
    const already = subtopics.reduce((n, s) => n + (s.files.length - missingFiles(s, existing).length), 0)
    console.log(`  уже загружено: ${already} из ${nFiles(sum.files)}`)
  }

  const allProblems = [...problems, ...absent.map(p => `нет файла: ${p}`), ...topicProblems]
  if (allProblems.length) {
    console.log(`\n  ПРОБЛЕМЫ (${allProblems.length}):`)
    for (const p of allProblems.slice(0, 50)) console.log(`   · ${p}`)
    if (allProblems.length > 50) console.log(`   … ещё ${allProblems.length - 50}, полный список в логе`)
  }

  const log = {
    startedAt: new Date().toISOString(),
    apply: FLAGS.apply,
    root: FLAGS.root,
    only: FLAGS.only,
    plan: sum,
    problems: allProblems,
    subtopics: [],
  }
  const saveLog = () => writeFileSync(LOG_PATH, JSON.stringify({ ...log, finishedAt: new Date().toISOString() }, null, 2))

  if (!FLAGS.apply) {
    saveLog()
    console.log(`\n  Сухой прогон окончен. Лог: ${LOG_PATH}`)
    console.log(allProblems.length
      ? '  Сначала разберите проблемы выше, потом запускайте с --apply.\n'
      : '  Всё на месте. Загрузка: тот же запуск с --apply (для пробы — с --only 1.17).\n')
    return
  }
  if (allProblems.length) {
    saveLog()
    die('есть проблемы (список выше и в логе) — загрузка не начата. Исправьте или сузьте --only.')
  }

  // 3. Загрузка: подтема за подтемой, одна вставка на подтему.
  const t0 = Date.now()
  let done = 0, inserted = 0, skippedFiles = 0, failed = 0
  for (const s of subtopics) {
    done++
    const todo = missingFiles(s, existing)
    const head = `[${done}/${subtopics.length}] ${s.code} ${s.title}`
    if (todo.length === 0) {
      skippedFiles += s.files.length
      console.log(`${head} — уже загружена`)
      log.subtopics.push({ code: s.code, topicId: s.topicId, inserted: 0, skipped: s.files.length })
      continue
    }

    const started = Date.now()
    let error = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      const uploaded = []
      try {
        for (const file of todo) {
          const body = readFileSync(diskPath(file.relPath))
          const storagePath = buildStoragePath(s.topicId, file.fileName)
          const { error: upErr } = await db.storage.from(MATERIALS_BUCKET).upload(storagePath, body, {
            contentType: 'application/pdf', upsert: false, cacheControl: '31536000',
          })
          if (upErr) throw new Error(`загрузка «${file.fileName}»: ${upErr.message}`)
          uploaded.push({ file, storagePath, size: body.length })
        }
        const { error: insErr } = await db.from('topic_material_items').insert(insertRows(s, uploaded, OWNER_PROFILE_ID))
        if (insErr) throw new Error(`вставка строк: ${insErr.message}`)
        error = null
        break
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
        // Файл без строки — сирота: убираем то, что залили в этой попытке.
        // Но сначала спрашиваем базу: ответ на вставку мог потеряться уже
        // ПОСЛЕ записи, и тогда удаление оставило бы строки без файлов — у
        // трёх классов. Не удалось спросить — не удаляем: лишний файл в
        // бакете дешевле мёртвой ссылки у ученика (урок import-lessons).
        if (uploaded.length) {
          const paths = uploaded.map(u => u.storagePath)
          const { data: kept, error: keptErr } = await db
            .from('topic_material_items').select('storage_path').in('storage_path', paths)
          if (!keptErr) {
            const referenced = new Set((kept ?? []).map(r => r.storage_path))
            const orphans = paths.filter(p => !referenced.has(p))
            if (referenced.size > 0) {
              // Строки легли — подтема на самом деле загружена.
              existing.push(...uploaded.map(u => ({ topic_id: s.topicId, subtopic_code: s.code, section: u.file.section })))
            }
            if (orphans.length) await db.storage.from(MATERIALS_BUCKET).remove(orphans).catch(() => {})
            if (referenced.size === paths.length) { error = null; break }
          }
        }
        if (attempt === 1) console.log(`${head} — сбой (${error}), повтор…`)
      }
    }

    const took = Date.now() - started
    if (error) {
      failed++
      console.log(`${head} — ПРОПУЩЕНА: ${error} (${seconds(took)})`)
      log.subtopics.push({ code: s.code, topicId: s.topicId, inserted: 0, error, seconds: took / 1000 })
    } else {
      inserted += todo.length
      skippedFiles += s.files.length - todo.length
      const size = todo.reduce((n, f) => n + (f.size ?? 0), 0)
      console.log(`${head} → «${s.topicTitle}»: ${nFiles(todo.length)}, ${humanBytes(size)}, ${seconds(took)} · всего ${seconds(Date.now() - t0)}`)
      log.subtopics.push({ code: s.code, topicId: s.topicId, inserted: todo.length, skipped: s.files.length - todo.length, seconds: took / 1000 })
    }
    saveLog()
  }

  saveLog()
  console.log(`\nГотово за ${seconds(Date.now() - t0)}: загружено ${nFiles(inserted)}, уже было ${skippedFiles}, пропущено подтем: ${failed}.`)
  console.log(`Лог: ${LOG_PATH}`)
  if (failed) console.log('Пропущенные подтемы догрузит повторный запуск той же командой.\n')
}

main().catch(e => die(e instanceof Error ? e.message : String(e)))
