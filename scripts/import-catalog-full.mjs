/**
 * import-catalog-full.mjs — промышленный импорт полного каталога ЕГЭ в Supabase.
 *
 * ТРЕБОВАНИЯ ДО ЗАПУСКА:
 *   1. SUPABASE_SERVICE_ROLE_KEY=<key>   (обязательно, без этого скрипт не запустится)
 *   2. CATALOG_FULL_IMPORT_CONFIRMED=yes (обязательно)
 *   3. Флаг --confirm-full-import        (обязательно)
 *
 * ПРИМЕРЫ:
 *   Dry-run (ничего не записывает):
 *     SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/import-catalog-full.mjs --dry-run
 *
 *   Тест первых 10 задач:
 *     SUPABASE_SERVICE_ROLE_KEY=<key> CATALOG_FULL_IMPORT_CONFIRMED=yes \
 *     node scripts/import-catalog-full.mjs --confirm-full-import --limit 10
 *
 *   Полный запуск:
 *     SUPABASE_SERVICE_ROLE_KEY=<key> CATALOG_FULL_IMPORT_CONFIRMED=yes \
 *     node scripts/import-catalog-full.mjs --confirm-full-import
 *
 *   Продолжить после остановки:
 *     SUPABASE_SERVICE_ROLE_KEY=<key> CATALOG_FULL_IMPORT_CONFIRMED=yes \
 *     node scripts/import-catalog-full.mjs --confirm-full-import --resume
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// ── Конфигурация (пути не содержат секретов) ──────────────────────────────────

const SUPABASE_URL  = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const FULL_DIR      = 'C:/Users/User/Documents/Codex/2026-06-22/new-chat/outputs/normalized_catalog'
const IMAGES_DIR    = 'C:/Users/User/Documents/Codex/2026-06-22/new-chat/outputs/shkolkovo_math_images'
const STORAGE_PREFIX = 'math-ege'
const BUCKET         = 'catalog-assets'

// Задачи с принудительным has_solution=false (задокументированные исключения)
const FORCE_NO_SOLUTION = new Set([173, 2304])

// Настройки пакетной обработки (можно переопределить флагами)
const DB_BATCH_SIZE      = 100  // задач/тем/ассетов за один upsert
const STORAGE_CONCURRENCY = 5   // параллельных загрузок файлов
const MAX_RETRIES         = 3
const RETRY_BASE_MS       = 1000

// ── Разбор аргументов ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const FLAGS = {
  confirmFullImport: args.includes('--confirm-full-import'),
  dryRun:           args.includes('--dry-run'),
  resume:           args.includes('--resume'),
  databaseOnly:     args.includes('--database-only'),
  storageOnly:      args.includes('--storage-only'),
  limit:            getIntArg('--limit'),
  startFrom:        getIntArg('--start-from') ?? 0,
  concurrency:      getIntArg('--concurrency') ?? STORAGE_CONCURRENCY,
}

function getIntArg(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  const v = parseInt(args[i + 1], 10)
  return isNaN(v) ? null : v
}

// ── Защитные проверки ─────────────────────────────────────────────────────────

const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY
const confirmed    = process.env.CATALOG_FULL_IMPORT_CONFIRMED
const devTestMode  = process.env.CATALOG_DEV_TEST_MODE === 'yes'  // только с --limit, для pre-flight тестов

if (!FLAGS.dryRun) {
  if (!serviceKey) {
    // Dev-test mode: допускаем email/password auth, но ТОЛЬКО с --limit (не для полного импорта)
    if (devTestMode && FLAGS.limit != null && FLAGS.limit <= 100) {
      console.warn('⚠️   DEV TEST MODE: используется email/password auth. Только с --limit!')
    } else {
      console.error('❌  SUPABASE_SERVICE_ROLE_KEY не задан.')
      console.error('    Задайте переменную окружения. Никогда не передавайте ключ как аргумент.')
      console.error('    Для pre-flight теста: CATALOG_DEV_TEST_MODE=yes --limit N')
      process.exit(1)
    }
  }
  if (!FLAGS.confirmFullImport && !devTestMode) {
    console.error('❌  Добавьте флаг --confirm-full-import для запуска полного импорта.')
    process.exit(1)
  }
  if (confirmed !== 'yes' && !devTestMode) {
    console.error('❌  CATALOG_FULL_IMPORT_CONFIRMED != "yes".')
    console.error('    Установите: export CATALOG_FULL_IMPORT_CONFIRMED=yes')
    process.exit(1)
  }
}

// Убеждаемся, что работаем с полной папкой, а не sample
if (FULL_DIR.endsWith('/sample') || FULL_DIR.endsWith('\\sample')) {
  console.error('❌  FULL_DIR указывает на sample! Используйте import-catalog-sample.mjs.')
  process.exit(1)
}

// ── Supabase-клиент ───────────────────────────────────────────────────────────

// Анонимный ключ — публичный (доступен в браузере), не секрет
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'

const supabase = FLAGS.dryRun
  ? null
  : serviceKey
    ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })

async function authenticateDevMode() {
  if (FLAGS.dryRun || serviceKey) return
  const email = process.env.IMPORT_EMAIL
  const pwd   = process.env.IMPORT_PASSWORD
  if (!email || !pwd) {
    console.error('❌  В dev-test mode задайте IMPORT_EMAIL и IMPORT_PASSWORD')
    process.exit(1)
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pwd })
  if (error) { console.error('❌  Ошибка авторизации:', error.message); process.exit(1) }
  console.log(`  👤  Dev-test auth: ${data.user?.email}`)
}

// ── Файлы отчётов ─────────────────────────────────────────────────────────────

const CHECKPOINT_FILE   = 'import-checkpoint.json'
const SUMMARY_FILE      = 'import-summary.json'
const ERRORS_FILE       = 'import-errors.jsonl'
const SKIPPED_FILE      = 'skipped-assets.jsonl'

// ── Статистика ────────────────────────────────────────────────────────────────

const stats = {
  sections:   { upserted: 0, skipped: 0, errors: 0, durationMs: 0 },
  topics:     { upserted: 0, skipped: 0, errors: 0, durationMs: 0 },
  tasks:      { upserted: 0, skipped: 0, errors: 0, durationMs: 0 },
  taskTopics: { upserted: 0, skipped: 0, errors: 0, durationMs: 0 },
  assets:     { uploaded: 0, skipped: 0, errors: 0, retries: 0, durationMs: 0 },
}

let errorCount = 0

function logError(phase, message, data = {}) {
  errorCount++
  const entry = JSON.stringify({ phase, message, ...data, ts: new Date().toISOString() })
  appendFileSync(ERRORS_FILE, entry + '\n')
}

function logSkipped(data) {
  appendFileSync(SKIPPED_FILE, JSON.stringify(data) + '\n')
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

let checkpoint = {
  startTime: new Date().toISOString(),
  completedPhases: [],
  assetBatchOffset: 0,
  uploadedPaths: [],
  runFlags: FLAGS,
}

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) return false
  try {
    const saved = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'))
    checkpoint = { ...checkpoint, ...saved }
    return true
  } catch {
    return false
  }
}

function saveCheckpoint(extra = {}) {
  if (FLAGS.dryRun) return
  writeFileSync(CHECKPOINT_FILE, JSON.stringify({ ...checkpoint, ...extra }, null, 2))
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

function readJsonl(filename) {
  const path = join(FULL_DIR, filename)
  if (!existsSync(path)) throw new Error(`Файл не найден: ${path}`)
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l))
}

function chunks(arr, size) {
  const result = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function withRetry(fn, context) {
  let lastErr
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === MAX_RETRIES) break
      const wait = RETRY_BASE_MS * Math.pow(2, attempt)
      stats.assets.retries++
      const msg = err?.message ?? String(err)
      // 429 rate limit — wait longer
      const delay = msg.includes('429') ? 30000 : wait
      console.warn(`    ⚠  Retry ${attempt + 1}/${MAX_RETRIES} [${context}]: ${msg.slice(0, 80)} — wait ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastErr
}

// Параллельный пул с ограниченной конкурентностью
async function poolMap(items, concurrency, fn) {
  const results = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ── Проверка HTML ─────────────────────────────────────────────────────────────

const SUPABASE_STORAGE_BASE = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`

/**
 * Заменяет src="filename.svg" → Supabase Storage URL.
 * kind='condition' → только в statement_html; kind='solution' → только в solution_html.
 * Возвращает { statement_html, solution_html, unresolvedCount }.
 */
function resolveHtmlAssets(task, assets) {
  const conditionAssets = assets.filter(a => a.kind === 'condition')
  const solutionAssets  = assets.filter(a => a.kind === 'solution')

  let unresolvedCount = 0

  function replaceSrcs(html, assetList) {
    if (!html) return html
    return html.replace(/src="([^"]+\.svg)"/g, (match, filename) => {
      const asset = assetList.find(a => a.storage_path.endsWith('/' + filename))
      if (!asset) { unresolvedCount++; return match }
      return `src="${SUPABASE_STORAGE_BASE}/${asset.storage_path}"`
    })
  }

  const statement_html = replaceSrcs(task.statement_html, conditionAssets)
  const solution_html  = replaceSrcs(task.solution_html,  solutionAssets)

  // Проверка: не должно остаться локальных src (только если были assets)
  const residualStmt = (statement_html ?? '').match(/src="[^h][^"]*\.svg"/g) ?? []
  const residualSol  = (solution_html  ?? '').match(/src="[^h][^"]*\.svg"/g) ?? []

  return { statement_html, solution_html, unresolvedCount, residualStmt, residualSol }
}

// ── Фаза 1: Разделы ───────────────────────────────────────────────────────────

async function importSections(dryRun) {
  const t0 = Date.now()
  const rows = readJsonl('catalog_sections.jsonl')
  console.log(`\n📂  Разделы: ${rows.length}`)

  if (dryRun) {
    console.log('    [dry-run] пропускаем запись')
    stats.sections.skipped = rows.length
    stats.sections.durationMs = Date.now() - t0
    return {}
  }

  const extToUuid = {}
  for (const batch of chunks(rows, DB_BATCH_SIZE)) {
    const records = batch.map(r => ({
      external_id:  r.external_id,
      subject:      r.subject,
      exam_type:    r.exam_type,
      exam_number:  r.exam_number ?? null,
      title:        r.title,
      position:     r.position ?? 0,
      is_published: r.is_published !== false,
    }))

    const { data, error } = await supabase
      .from('catalog_sections')
      .upsert(records, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id, external_id')

    if (error) {
      logError('sections', error.message)
      stats.sections.errors += batch.length
    } else {
      stats.sections.upserted += batch.length
      for (const s of data ?? []) extToUuid[s.external_id] = s.id
    }
  }

  // Если upsert не вернул данные — читаем из БД
  if (Object.keys(extToUuid).length === 0) {
    const { data } = await supabase.from('catalog_sections').select('id, external_id')
    for (const s of data ?? []) extToUuid[s.external_id] = s.id
  }

  stats.sections.durationMs = Date.now() - t0
  console.log(`    ✓  ${stats.sections.upserted} upserted, ${stats.sections.errors} errors`)
  return extToUuid
}

// ── Фаза 2: Темы ──────────────────────────────────────────────────────────────

async function importTopics(dryRun) {
  const t0 = Date.now()
  const rows = readJsonl('catalog_topics.jsonl')
  console.log(`\n📂  Темы: ${rows.length}`)

  if (dryRun) {
    console.log('    [dry-run] пропускаем запись')
    stats.topics.skipped = rows.length
    stats.topics.durationMs = Date.now() - t0
    return {}
  }

  const extToUuid = {}

  // Первый проход — вставляем без parent_id
  for (const batch of chunks(rows, DB_BATCH_SIZE)) {
    const records = batch.map(r => ({
      external_id:  r.external_id,
      title:        r.title,
      slug:         r.slug ?? null,
      position:     r.position ?? 0,
      is_published: r.is_published !== false,
      parent_id:    null,
    }))

    const { data, error } = await supabase
      .from('catalog_topics')
      .upsert(records, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id, external_id')

    if (error) {
      logError('topics', error.message)
      stats.topics.errors += batch.length
    } else {
      stats.topics.upserted += batch.length
      for (const t of data ?? []) extToUuid[t.external_id] = t.id
    }
  }

  // Заполняем карту если upsert не вернул данные
  if (Object.keys(extToUuid).length < rows.length) {
    const { data } = await supabase.from('catalog_topics').select('id, external_id')
    for (const t of data ?? []) extToUuid[t.external_id] = t.id
  }

  // Второй проход — проставляем parent_id
  const withParent = rows.filter(r => r.parent_external_id != null)
  let parentErrors = 0
  for (const batch of chunks(withParent, DB_BATCH_SIZE)) {
    for (const r of batch) {
      const parentUuid = extToUuid[r.parent_external_id]
      if (!parentUuid) {
        logError('topics_parent', `parent_external_id ${r.parent_external_id} not found`, { external_id: r.external_id })
        parentErrors++
        continue
      }
      const { error } = await supabase
        .from('catalog_topics')
        .update({ parent_id: parentUuid })
        .eq('external_id', r.external_id)
      if (error) {
        logError('topics_parent_update', error.message, { external_id: r.external_id })
        parentErrors++
      }
    }
  }

  stats.topics.durationMs = Date.now() - t0
  console.log(`    ✓  ${stats.topics.upserted} upserted, ${withParent.length} parent links, ${parentErrors} parent errors`)
  return extToUuid
}

// ── Фаза 3: Задачи ────────────────────────────────────────────────────────────

async function importTasks(sectionExtToUuid, dryRun, opts = {}) {
  const t0 = Date.now()
  let rows = readJsonl('catalog_tasks.jsonl')

  // Исключённые ОГЭ-задачи
  const excludedFile = join(FULL_DIR, 'excluded_oge_tasks.jsonl')
  let excludedIds = new Set()
  if (existsSync(excludedFile)) {
    const excRows = readFileSync(excludedFile, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
    excludedIds = new Set(excRows.map(r => r.external_id))
    console.log(`    Исключённых ОГЭ-задач: ${excludedIds.size}`)
  }

  // Применяем --start-from и --limit
  if (opts.startFrom > 0) rows = rows.slice(opts.startFrom)
  if (opts.limit != null) rows = rows.slice(0, opts.limit)

  const skippedOge     = []
  const skippedEmpty   = []
  const validRows = []

  for (const r of rows) {
    if (excludedIds.has(r.external_id)) { skippedOge.push(r.external_id); continue }
    const stmt = (r.statement_html ?? '').trim()
    if (!stmt || stmt === '<p></p>' || stmt.length < 5) { skippedEmpty.push(r.external_id); continue }
    validRows.push(r)
  }

  console.log(`\n📂  Задачи: ${rows.length} (исключено ОГЭ: ${skippedOge.length}, пустых: ${skippedEmpty.length}, к импорту: ${validRows.length})`)
  if (skippedOge.length) logError('tasks_excluded_oge', `Пропущено ${skippedOge.length} ОГЭ-задач`, { ids: skippedOge.slice(0, 10) })
  if (skippedEmpty.length) logError('tasks_empty_statement', `Пропущено ${skippedEmpty.length} задач с пустым условием`, { ids: skippedEmpty.slice(0, 10) })

  if (dryRun) {
    console.log('    [dry-run] пропускаем запись')
    stats.tasks.skipped = validRows.length
    stats.tasks.durationMs = Date.now() - t0
    return {}
  }

  const extToUuid = {}

  for (const batch of chunks(validRows, DB_BATCH_SIZE)) {
    const records = batch.map(r => {
      const hasSolution = FORCE_NO_SOLUTION.has(r.external_id) ? false : r.has_solution === true
      return {
        external_id:    r.external_id,
        section_id:     sectionExtToUuid[r.primary_section_external_id],
        statement_html: r.statement_html,
        answer_html:    r.answer_html   ?? null,
        solution_html:  r.solution_html ?? null,
        source_url:     r.source_url    ?? null,
        position:       r.position      ?? 0,
        has_answer:     r.has_answer   === true,
        has_solution:   hasSolution,
        is_published:   r.is_published !== false,
      }
    }).filter(r => r.section_id != null)

    const { data, error } = await supabase
      .from('catalog_tasks')
      .upsert(records, { onConflict: 'external_id', ignoreDuplicates: false })
      .select('id, external_id')

    if (error) {
      logError('tasks', error.message)
      stats.tasks.errors += batch.length
    } else {
      stats.tasks.upserted += batch.length
      for (const t of data ?? []) extToUuid[t.external_id] = t.id
    }
  }

  // Заполняем карту если данные неполные
  if (Object.keys(extToUuid).length < validRows.length) {
    const allExtIds = validRows.map(r => r.external_id)
    for (const batch of chunks(allExtIds, 1000)) {
      const { data } = await supabase.from('catalog_tasks').select('id, external_id').in('external_id', batch)
      for (const t of data ?? []) extToUuid[t.external_id] = t.id
    }
  }

  stats.tasks.durationMs = Date.now() - t0
  console.log(`    ✓  ${stats.tasks.upserted} upserted, ${stats.tasks.errors} errors`)
  return extToUuid
}

// ── Фаза 4: Связи задача↔тема ─────────────────────────────────────────────────

async function importTaskTopics(taskExtToUuid, topicExtToUuid, dryRun) {
  const t0 = Date.now()
  const rows = readJsonl('catalog_task_topics.jsonl')
  console.log(`\n📂  Связи задача↔тема: ${rows.length}`)

  if (dryRun) {
    console.log('    [dry-run] пропускаем запись')
    stats.taskTopics.skipped = rows.length
    stats.taskTopics.durationMs = Date.now() - t0
    return
  }

  // Загружаем существующие пары для дедупликации
  const { data: existing } = await supabase.from('catalog_task_topics').select('task_id, topic_id')
  const existingSet = new Set((existing ?? []).map(l => `${l.task_id}:${l.topic_id}`))

  const records = []
  for (const r of rows) {
    const taskUuid  = taskExtToUuid[r.task_external_id]
    const topicUuid = topicExtToUuid[r.topic_external_id]
    if (!taskUuid || !topicUuid) continue
    const key = `${taskUuid}:${topicUuid}`
    if (existingSet.has(key)) continue
    records.push({ task_id: taskUuid, topic_id: topicUuid, is_primary: r.is_primary ?? false })
    existingSet.add(key)
  }

  for (const batch of chunks(records, DB_BATCH_SIZE)) {
    const { error } = await supabase.from('catalog_task_topics').insert(batch)
    if (error) {
      logError('task_topics', error.message)
      stats.taskTopics.errors += batch.length
    } else {
      stats.taskTopics.upserted += batch.length
    }
  }

  stats.taskTopics.durationMs = Date.now() - t0
  console.log(`    ✓  ${stats.taskTopics.upserted} inserted, ${stats.taskTopics.errors} errors`)
}

// ── Фаза 5: Assets (Storage + DB) ─────────────────────────────────────────────

async function importAssets(taskExtToUuid, dryRun, opts = {}) {
  const t0 = Date.now()
  let rows = readJsonl('catalog_task_assets.jsonl')

  // Фильтруем только задачи, которые мы импортировали
  rows = rows.filter(r => taskExtToUuid[r.task_external_id] != null)

  // Применяем limit если задан (по задачам, не по ассетам)
  if (opts.limit != null) {
    const taskSet = new Set(Object.keys(taskExtToUuid).slice(0, opts.limit).map(Number))
    rows = rows.filter(r => taskSet.has(r.task_external_id))
  }

  console.log(`\n📂  Assets: ${rows.length}`)

  if (dryRun) {
    let missingFiles = 0
    for (const r of rows) {
      const localFile = join(IMAGES_DIR, r.local_path)
      if (!existsSync(localFile)) {
        missingFiles++
        logSkipped({ reason: 'file_not_found', local_path: r.local_path, task_external_id: r.task_external_id })
      }
    }
    console.log(`    [dry-run] файлов не найдено: ${missingFiles} из ${rows.length}`)
    stats.assets.skipped = rows.length
    stats.assets.durationMs = Date.now() - t0
    return
  }

  // Загружаем уже существующие storage_path из БД
  let existingPaths = new Set(checkpoint.uploadedPaths ?? [])
  if (!opts.resume || existingPaths.size === 0) {
    console.log('    Загружаем список существующих assets из БД...')
    let offset = 0
    while (true) {
      const { data } = await supabase
        .from('catalog_task_assets')
        .select('storage_path')
        .range(offset, offset + 999)
      if (!data || data.length === 0) break
      for (const a of data) existingPaths.add(a.storage_path)
      if (data.length < 1000) break
      offset += 1000
    }
    console.log(`    Уже в БД: ${existingPaths.size} assets`)
  }

  // Группируем ассеты по задаче для resolveHtml
  const assetsByTaskExt = {}
  for (const r of rows) {
    const eid = r.task_external_id
    if (!assetsByTaskExt[eid]) assetsByTaskExt[eid] = []
    assetsByTaskExt[eid].push({ ...r, storage_path: `${STORAGE_PREFIX}/${r.local_path}` })
  }

  // HTML-валидация: проверяем каждую задачу на наличие остаточных локальных src
  const tasks = readJsonl('catalog_tasks.jsonl').filter(t => taskExtToUuid[t.external_id] != null)
  let htmlWarnings = 0
  for (const task of tasks) {
    const assets = assetsByTaskExt[task.external_id] ?? []
    const { residualStmt, residualSol } = resolveHtmlAssets(task, assets)
    if (residualStmt.length + residualSol.length > 0) {
      htmlWarnings++
      logError('html_unresolved_src', `Задача ext=${task.external_id}: ${residualStmt.length} в условии, ${residualSol.length} в решении`, {
        external_id: task.external_id,
        residual_statement: residualStmt.slice(0, 3),
        residual_solution:  residualSol.slice(0, 3),
      })
    }
  }
  if (htmlWarnings > 0) console.warn(`    ⚠  HTML предупреждений: ${htmlWarnings} задач с неразрешёнными src`)

  // Загружаем файлы батчами с ограниченным параллелизмом
  const toUpload = rows.filter(r => {
    const sp = `${STORAGE_PREFIX}/${r.local_path}`
    return !existingPaths.has(sp)
  })

  console.log(`    К загрузке: ${toUpload.length}, пропускается: ${rows.length - toUpload.length}`)
  stats.assets.skipped = rows.length - toUpload.length

  const assetRecords = []

  await poolMap(toUpload, opts.concurrency ?? STORAGE_CONCURRENCY, async (r) => {
    const storagePath = `${STORAGE_PREFIX}/${r.local_path}`
    const localFile   = join(IMAGES_DIR, r.local_path)

    if (!existsSync(localFile)) {
      stats.assets.errors++
      logSkipped({ reason: 'file_not_found', local_path: r.local_path, task_external_id: r.task_external_id })
      return
    }

    try {
      const fileBuffer = readFileSync(localFile)
      await withRetry(async () => {
        const { error } = await supabase.storage.from(BUCKET).upload(storagePath, fileBuffer, {
          contentType:  'image/svg+xml',
          upsert:       false,
          cacheControl: '31536000',
        })
        if (error && !error.message.includes('already exists') && !error.message.includes('The resource already exists')) {
          throw error
        }
      }, storagePath)

      stats.assets.uploaded++
      existingPaths.add(storagePath)

      assetRecords.push({
        task_id:        taskExtToUuid[r.task_external_id],
        tex_session_id: r.tex_session_id ?? null,
        kind:           r.kind,
        storage_path:   storagePath,
        alt:            r.alt            ?? null,
        position:       r.position       ?? 0,
      })

      // Сохраняем прогресс каждые 500 загрузок
      if (stats.assets.uploaded % 500 === 0) {
        checkpoint.uploadedPaths = [...existingPaths]
        saveCheckpoint()
        console.log(`    ... ${stats.assets.uploaded} загружено`)
      }
    } catch (err) {
      stats.assets.errors++
      logError('assets_upload', err?.message ?? String(err), { local_path: r.local_path })
    }
  })

  // Вставляем записи в БД батчами
  if (assetRecords.length > 0) {
    console.log(`    Запись ${assetRecords.length} asset-записей в БД...`)
    for (const batch of chunks(assetRecords, DB_BATCH_SIZE)) {
      const { error } = await supabase.from('catalog_task_assets').insert(batch)
      if (error) {
        logError('assets_db', error.message)
        stats.assets.errors += batch.length
      }
    }
  }

  stats.assets.durationMs = Date.now() - t0
  console.log(`    ✓  ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors, ${stats.assets.retries} retries`)
}

// ── Предварительная информация ────────────────────────────────────────────────

async function showPlan() {
  const sections  = readJsonl('catalog_sections.jsonl').length
  const topics    = readJsonl('catalog_topics.jsonl').length
  let   tasks     = readJsonl('catalog_tasks.jsonl')
  const taskTopics = readJsonl('catalog_task_topics.jsonl').length
  const assets    = readJsonl('catalog_task_assets.jsonl').length

  if (FLAGS.startFrom > 0) tasks = tasks.slice(FLAGS.startFrom)
  if (FLAGS.limit != null) tasks = tasks.slice(0, FLAGS.limit)

  console.log('\n══════════════════════════════════════════════════')
  console.log('  Полный каталог ЕГЭ — план импорта')
  console.log('══════════════════════════════════════════════════')
  console.log(`  Разделов:  ${sections}`)
  console.log(`  Тем:       ${topics}`)
  console.log(`  Задач:     ${tasks.length}${FLAGS.limit ? ` (limit ${FLAGS.limit})` : ''}`)
  console.log(`  Связей:    ${taskTopics}`)
  console.log(`  Assets:    ${assets}`)
  console.log(`  Режим:     ${FLAGS.dryRun ? 'DRY-RUN (ничего не запишется)' : FLAGS.databaseOnly ? 'database-only' : FLAGS.storageOnly ? 'storage-only' : 'full'}`)
  if (FLAGS.resume) console.log('  Resume:    checkpoint будет использован')
  console.log('══════════════════════════════════════════════════\n')
}

// ── Итоговый отчёт ────────────────────────────────────────────────────────────

function writeSummary(startTime) {
  const summary = {
    startTime,
    endTime: new Date().toISOString(),
    durationMs: Date.now() - new Date(startTime).getTime(),
    flags: FLAGS,
    stats,
    errors: errorCount,
  }
  if (!FLAGS.dryRun) writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2))
  return summary
}

function printStats(summary) {
  console.log('\n══════════════════════════════════════════════════')
  console.log('  Итог импорта')
  console.log('══════════════════════════════════════════════════')
  const s = summary.stats
  const fmt = (n) => String(n).padStart(7)
  console.log(`  Разделы:  ${fmt(s.sections.upserted)} upserted  ${fmt(s.sections.errors)} errors   ${s.sections.durationMs}ms`)
  console.log(`  Темы:     ${fmt(s.topics.upserted)} upserted  ${fmt(s.topics.errors)} errors   ${s.topics.durationMs}ms`)
  console.log(`  Задачи:   ${fmt(s.tasks.upserted)} upserted  ${fmt(s.tasks.skipped)} skipped  ${fmt(s.tasks.errors)} errors   ${s.tasks.durationMs}ms`)
  console.log(`  Связи:    ${fmt(s.taskTopics.upserted)} inserted  ${fmt(s.taskTopics.errors)} errors   ${s.taskTopics.durationMs}ms`)
  console.log(`  Assets:   ${fmt(s.assets.uploaded)} uploaded  ${fmt(s.assets.skipped)} skipped  ${fmt(s.assets.errors)} errors  ${s.assets.retries} retries  ${s.assets.durationMs}ms`)
  console.log(`  Всего ошибок: ${errorCount}`)
  if (errorCount) console.log(`  Ошибки записаны в: ${ERRORS_FILE}`)
  console.log('══════════════════════════════════════════════════')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = new Date().toISOString()

  console.log('\n🚀  import-catalog-full.mjs')
  if (FLAGS.dryRun) console.log('   ⚡  DRY-RUN — данные не изменяются\n')
  console.log(`   Каталог: ${FULL_DIR}`)
  console.log(`   Изобр.:  ${IMAGES_DIR}`)
  console.log(`   Supabase: ${SUPABASE_URL}`)
  if (!FLAGS.dryRun) {
    if (serviceKey) console.log('   Auth: service role key ✓ (ключ в логах не отображается)')
    else { console.log('   Auth: dev-test mode (email/password)'); await authenticateDevMode() }
  }

  await showPlan()

  // Инициализируем файлы отчётов
  if (!FLAGS.dryRun) {
    if (FLAGS.resume && existsSync(CHECKPOINT_FILE)) {
      loadCheckpoint()
      console.log(`  ♻️   Resuming from checkpoint (фазы завершены: ${checkpoint.completedPhases.join(', ') || 'нет'})`)
    } else {
      writeFileSync(ERRORS_FILE, '')
      writeFileSync(SKIPPED_FILE, '')
      saveCheckpoint({ startTime })
    }
  }

  const completed = new Set(checkpoint.completedPhases ?? [])
  const opts = { dryRun: FLAGS.dryRun, limit: FLAGS.limit, startFrom: FLAGS.startFrom, resume: FLAGS.resume, concurrency: FLAGS.concurrency }

  // ── Фаза 1: Разделы
  let sectionMap = {}
  if (!completed.has('sections') && !FLAGS.storageOnly) {
    sectionMap = await importSections(FLAGS.dryRun)
    if (!FLAGS.dryRun) { checkpoint.completedPhases.push('sections'); saveCheckpoint() }
  } else {
    if (!FLAGS.dryRun) {
      const { data } = await supabase.from('catalog_sections').select('id, external_id')
      for (const s of data ?? []) sectionMap[s.external_id] = s.id
    }
    console.log('\n  ✓  sections — пропускаем (уже выполнено)')
  }

  // ── Фаза 2: Темы
  let topicMap = {}
  if (!completed.has('topics') && !FLAGS.storageOnly) {
    topicMap = await importTopics(FLAGS.dryRun)
    if (!FLAGS.dryRun) { checkpoint.completedPhases.push('topics'); saveCheckpoint() }
  } else {
    if (!FLAGS.dryRun) {
      const { data } = await supabase.from('catalog_topics').select('id, external_id')
      for (const t of data ?? []) topicMap[t.external_id] = t.id
    }
    console.log('  ✓  topics — пропускаем (уже выполнено)')
  }

  // ── Фаза 3: Задачи
  let taskMap = {}
  if (!completed.has('tasks') && !FLAGS.storageOnly) {
    taskMap = await importTasks(sectionMap, FLAGS.dryRun, opts)
    if (!FLAGS.dryRun) { checkpoint.completedPhases.push('tasks'); saveCheckpoint() }
  } else {
    if (!FLAGS.dryRun) {
      const { data } = await supabase.from('catalog_tasks').select('id, external_id')
      for (const t of data ?? []) taskMap[t.external_id] = t.id
    }
    console.log('  ✓  tasks — пропускаем (уже выполнено)')
  }

  // ── Фаза 4: Task-topic links
  if (!completed.has('task_topics') && !FLAGS.storageOnly && !FLAGS.databaseOnly) {
    await importTaskTopics(taskMap, topicMap, FLAGS.dryRun)
    if (!FLAGS.dryRun) { checkpoint.completedPhases.push('task_topics'); saveCheckpoint() }
  } else if (!FLAGS.storageOnly) {
    console.log('  ✓  task_topics — пропускаем (уже выполнено)')
  }

  // ── Фаза 5: Assets
  if (!completed.has('assets') && !FLAGS.databaseOnly) {
    await importAssets(taskMap, FLAGS.dryRun, opts)
    if (!FLAGS.dryRun) { checkpoint.completedPhases.push('assets'); saveCheckpoint() }
  } else if (!FLAGS.databaseOnly) {
    console.log('  ✓  assets — пропускаем (уже выполнено)')
  }

  // ── Финальный отчёт
  const summary = writeSummary(startTime)
  printStats(summary)

  if (!FLAGS.dryRun && errorCount === 0) {
    console.log('\n✅  Импорт завершён без ошибок')
  } else if (errorCount > 0) {
    console.log(`\n⚠️   ${errorCount} ошибок — см. ${ERRORS_FILE}`)
  } else {
    console.log('\n✅  Dry-run завершён')
  }
}

main().catch(err => {
  console.error('\n💥  Fatal:', err?.message ?? err)
  process.exit(1)
})
