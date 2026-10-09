/**
 * import-autocheck.mjs — загрузка задач с автопроверкой в тренировочный урок (§266).
 *
 *   папка темы «автопроверка/» (задачи.json + SVG условий и решений)  →  урок (topic_id)
 *
 * Условия и решения кладутся в приватный бакет `topic-autocheck` (путь — по
 * содержимому файла, см. autocheck-plan.mjs), задачи — RPC
 * `topic_autocheck_import`: повтор по коду задачи обновляет её, урок без
 * пометки становится «Тренировочным», заводится ДЗ-носитель (оценка в журнал).
 * Урок КАРКАСА: те же задачи уезжают в уроки-копии классов (по линейке
 * source_topic_id) — скрипт в классы ничего не пишет сам.
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ (сухой прогон): проверяет задачи.json и файлы,
 * при наличии ключа — что урок есть, его название и сколько задач уже лежит.
 * Запись — только `--apply`.
 *
 *   node scripts/import-autocheck.mjs --dir "D:\Физика\1.4.1\автопроверка" --topic <uuid урока>
 *   node scripts/import-autocheck.mjs --dir "…\автопроверка" --topic <uuid урока> --apply
 *   node scripts/import-autocheck.mjs --dir "…\автопроверка" --topic <uuid урока> --apply --text-only
 *
 * §278: кроме SVG, загрузчик кладёт условия и решения ТЕКСТОМ из `дз.md` темы
 * (папка над «автопроверкой»): рисунки — в публичный бакет `catalog-figures`
 * (`autocheck/<sha>.svg`), тексты — RPC `topic_autocheck_set_text`. `--text-only`
 * — только тексты, задачи и SVG не трогаются (для уже загруженных уроков).
 *
 * Ключи — из `.env.import.local` / `.env` / окружения (те же имена, что у
 * import-lessons и import-trenirovka: VITE_SUPABASE_URL или SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY). Значения ключей не печатаются никогда.
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { figuresOf, splitTasks, taskText } from './autocheck-text.mjs'
import {
  AUTOCHECK_BUCKET, TASKS_FILE, contentTypeOf, importRows, missingFiles, parseTasksJson,
  storagePathFor, topicMatchesTitle,
} from './autocheck-plan.mjs'

const argv = process.argv.slice(2)
function getArg(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const FLAGS = {
  apply: argv.includes('--apply'),
  // §278: только тексты условий/решений из дз.md (задачи уже загружены) — без SVG и без перезаписи задач.
  textOnly: argv.includes('--text-only'),
  dir: getArg('--dir'),
  topic: getArg('--topic'),
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function main() {
  if (!FLAGS.dir) die('нужна папка: --dir "<тема>/автопроверка"')
  if (!FLAGS.topic || !UUID.test(FLAGS.topic)) die('нужен урок: --topic <uuid темы курса>')
  const jsonPath = join(FLAGS.dir, TASKS_FILE)
  if (!existsSync(jsonPath)) die(`нет файла ${jsonPath}`)

  const { topic, tasks, problems, warnings } = parseTasksJson(readFileSync(jsonPath, 'utf8'))
  const files = new Set(readdirSync(FLAGS.dir))
  const absent = missingFiles(tasks, name => files.has(name))

  console.log(`\nЗадачи с автопроверкой → урок (${FLAGS.apply ? 'ЗАГРУЗКА' : 'сухой прогон, ничего не пишется'})`)
  console.log(`  папка: ${FLAGS.dir}`)
  console.log(`  подтема в ${TASKS_FILE}: ${topic ?? '—'}, задач: ${tasks.length}`)
  console.log(`  урок: ${FLAGS.topic}`)

  let db = null
  const dbProblems = []
  if (!SUPABASE_URL || !SERVICE_KEY) {
    const why = !SUPABASE_URL ? 'нет VITE_SUPABASE_URL' : 'нет SUPABASE_SERVICE_ROLE_KEY'
    if (FLAGS.apply) die(`${why} в .env.import.local. Добавьте строку сами — файл в .gitignore, присылать ключ в переписку не нужно.`)
    console.log(`  база: не проверялась (${why} в .env.import.local) — проверены только файлы`)
  } else {
    db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: t, error } = await db.from('topics').select('id, title, kind, lesson_format').eq('id', FLAGS.topic).maybeSingle()
    if (error) dbProblems.push(`чтение урока: ${error.message}`)
    else if (!t) dbProblems.push(`урок ${FLAGS.topic} не найден`)
    else {
      console.log(`  в базе: «${t.title}», пометка: ${t.lesson_format ?? 'нет (станет «Тренировочный»)'}`)
      if (t.kind && t.kind !== 'lesson') dbProblems.push(`это не урок (тип ${t.kind}) — задачи с автопроверкой только в уроке`)
      if (t.lesson_format === 'ege') warnings.push('урок помечен «Формат ЕГЭ» — блок задач ученик увидит только у «Тренировочного»')
      if (!topicMatchesTitle(topic, t.title)) warnings.push(`подтема «${topic}» не похожа на название урока «${t.title}» — тот ли урок?`)
      const { count } = await db.from('topic_autocheck_tasks').select('id', { count: 'exact', head: true }).eq('topic_id', FLAGS.topic)
      console.log(`  уже задач в уроке: ${count ?? 0}`)
    }
  }

  // §278. Тексты из дз.md темы (папка выше «автопроверки»).
  const topicDir = dirname(FLAGS.dir)
  const mdPath = join(topicDir, 'дз.md')
  const textPlan = { items: [], figures: [], missing: [] }
  if (existsSync(mdPath)) {
    const md = readFileSync(mdPath, 'utf8')
    const chunks = splitTasks(md)
    const codes = tasks.map(t => t.code)
    textPlan.figures = figuresOf(md, codes)
    for (const code of codes) {
      const chunk = chunks.get(code)
      const probe = chunk ? taskText(chunk, () => 'x.svg') : null
      if (!probe) textPlan.missing.push(code)
    }
    const absentFig = textPlan.figures.filter(rel => !existsSync(join(topicDir, rel)))
    for (const f of absentFig) warnings.push(`нет рисунка для текста: ${f} — задача покажется без него`)
    textPlan.figures = textPlan.figures.filter(rel => existsSync(join(topicDir, rel)))
    textPlan.md = md
    console.log(`  тексты (дз.md): ${codes.length - textPlan.missing.length} из ${codes.length}, рисунков ${textPlan.figures.length}`
      + (textPlan.missing.length ? ` — без текста (останется картинка): ${textPlan.missing.join(', ')}` : ''))
  } else {
    warnings.push(`нет ${mdPath} — тексты не загрузятся, останутся картинки`)
  }

  const all = [...problems, ...absent.map(f => `нет файла: ${f}`), ...dbProblems]
  for (const w of warnings) console.log(`  ! ${w}`)
  if (all.length) {
    console.log(`\n  ПРОБЛЕМЫ (${all.length}):`)
    for (const p of all) console.log(`   · ${p}`)
  }
  if (!FLAGS.apply) {
    console.log(all.length
      ? '\n  Сначала разберите проблемы выше, потом запускайте с --apply.\n'
      : '\n  Всё на месте. Загрузка: тот же запуск с --apply.\n')
    return
  }
  if (all.length) die('есть проблемы — загрузка не начата')

  if (!FLAGS.textOnly) await importTasks(db, tasks)
  await importTexts(db, topicDir, tasks, textPlan)
  console.log('  Готово.\n')
}

/** §278: рисунки текстов — в публичный бакет каталога (путь по содержимому), тексты — topic_autocheck_set_text. */
async function importTexts(db, topicDir, tasks, plan) {
  if (!plan.md) return
  const figPath = new Map()
  const failedFigs = new Set()
  for (const rel of plan.figures) {
    const bytes = readFileSync(join(topicDir, rel))
    const path = `autocheck/${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.svg`
    // Сеть у владельца иногда рвёт отдельные запросы («fetch failed») — пробуем несколько раз с паузой;
    // не вышло — задачи с этим рисунком остаются картинками (без текста), остальные получают текст.
    let ok = false
    let lastErr = ''
    for (let i = 1; i <= 6 && !ok; i++) {
      try {
        const { error } = await db.storage.from('catalog-figures').upload(path, bytes, {
          contentType: 'image/svg+xml', upsert: false, cacheControl: '31536000',
        })
        if (!error || /exists|duplicate|409/i.test(String(error.message ?? '') + String(error.statusCode ?? ''))) ok = true
        else lastErr = error.message
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
      if (!ok) await new Promise(r => setTimeout(r, 1500 * i))
    }
    if (ok) figPath.set(rel, path)
    else { failedFigs.add(rel); console.log(`  ! рисунок «${rel}» не загрузился (${lastErr}) — его задачи останутся картинками`) }
  }
  const chunks = splitTasks(plan.md)
  const items = []
  for (const t of tasks) {
    const chunk = chunks.get(t.code)
    const txt = chunk ? taskText(chunk, rel => figPath.get(rel) ?? null) : null
    if (txt && !txt.figures.some(rel => failedFigs.has(rel))) {
      items.push({ code: t.code, statement_md: txt.statement_md, solution_md: txt.solution_md })
    }
  }
  if (!items.length) { console.log('  тексты: нечего загружать'); return }
  const { data, error } = await db.rpc('topic_autocheck_set_text', { p_topic_id: FLAGS.topic, p_items: items })
  if (error) die(`тексты задач: ${error.message}`)
  console.log(`  тексты: с текстом ${data?.with_text ?? '?'} из ${data?.total ?? '?'}, обновлено строк ${data?.updated_rows ?? 0} (вместе с копиями ${data?.copies ?? 0}); рисунков ${figPath.size}`)
}

async function importTasks(db, tasks) {
  // 1. Файлы: путь по содержимому, уже лежащий файл не перезаливается.
  const pathByName = new Map()
  let uploaded = 0
  let reused = 0
  for (const name of new Set(tasks.flatMap(t => [t.statement, t.solution].filter(Boolean)))) {
    const bytes = readFileSync(join(FLAGS.dir, name))
    const path = storagePathFor(FLAGS.topic, name, bytes)
    const { error } = await db.storage.from(AUTOCHECK_BUCKET).upload(path, bytes, {
      contentType: contentTypeOf(name), upsert: false, cacheControl: '31536000',
    })
    if (error && !/exists|duplicate|409/i.test(String(error.message ?? '') + String(error.statusCode ?? ''))) {
      die(`загрузка «${name}»: ${error.message}`)
    }
    if (error) reused++
    else uploaded++
    pathByName.set(name, path)
  }
  console.log(`  файлы: залито ${uploaded}, уже были ${reused}`)

  // 2. Задачи — одним вызовом (упорядочено, повтор по коду обновляет).
  const rows = importRows(tasks, name => pathByName.get(name))
  const { data, error } = await db.rpc('topic_autocheck_import', { p_topic_id: FLAGS.topic, p_tasks: rows })
  if (error) die(`запись задач: ${error.message}`)
  console.log(`  задачи: новых ${data?.inserted ?? 0}, обновлено ${data?.updated ?? 0}, без изменений ${data?.unchanged ?? 0}; всего в уроке ${data?.total ?? '?'}; уроков-копий ${data?.copies ?? 0}`)
}

main().catch(e => die(e instanceof Error ? e.message : String(e)))
