/**
 * Полный импорт каталога «Математика ОГЭ»
 * (21 раздел, 672 темы, 5 972 задачи, 11 516 связей, 67 217 assets)
 *
 * ⚠️  Для запуска обязательны ВСЕ три:
 *   1. SUPABASE_SERVICE_ROLE_KEY=<key>
 *   2. CATALOG_MATH_OGE_FULL_IMPORT_CONFIRMED=yes
 *   3. --confirm-full-import
 *
 * Опции:
 *   --dry-run              Считает и показывает без записи
 *   --limit N              Обрабатывает только первые N задач
 *   --resume               Пропускает задачи из checkpoint (math-oge-checkpoint.json)
 *   --confirm-full-import  Обязательный флаг для полного импорта
 *
 * Повторный запуск безопасен: upsert по (subject, exam_type, external_id).
 * Не затрагивает Математику ЕГЭ, Физику ЕГЭ, catalog_task_progress.
 * Не выводит секреты в консоль.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

// ── Аргументы командной строки ────────────────────────────────────────────────

const args      = process.argv.slice(2)
const DRY_RUN   = args.includes('--dry-run')
const RESUME    = args.includes('--resume')
const CONFIRMED = args.includes('--confirm-full-import')
const limitIdx  = args.indexOf('--limit')
const LIMIT     = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity

// ── Константы ─────────────────────────────────────────────────────────────────

const SUPABASE_URL   = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'

const SUBJECT         = 'Математика'
const EXAM_TYPE       = 'ОГЭ'
const STORAGE_PREFIX  = 'math-oge'
const BUCKET          = 'catalog-assets'
const CATALOG_DIR     = 'D:/школково спарсенные файлы/shkolkovo_oge_math_catalog/outputs/normalized_catalog'
const IMAGES_DIR      = resolve(CATALOG_DIR, '..', 'shkolkovo_oge_math_images')
const CHECKPOINT_FILE = join(process.cwd(), 'math-oge-checkpoint.json')
const LOCAL_PATH_PREFIX = '../shkolkovo_oge_math_images/'

const CONCURRENCY     = 5
const TASK_BATCH_SIZE = 50
const ASSET_BATCH_SIZE = 200
const LINK_BATCH_SIZE  = 500

// Tasks where has_solution must be false
const NO_SOLUTION_IDS = new Set([
  '120232','120238','120239','120244','120245','120246','120247',
  '120249','120250','120251','120252','120253','120254','120255',
  '120256','120409','120411','120412','120426','120427','120429',
  '163016','178028',
])

// ── Guards ────────────────────────────────────────────────────────────────────

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const envConfirm = process.env.CATALOG_MATH_OGE_FULL_IMPORT_CONFIRMED

if (!DRY_RUN) {
  const missing = []
  if (!serviceKey)           missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (envConfirm !== 'yes')  missing.push('CATALOG_MATH_OGE_FULL_IMPORT_CONFIRMED=yes')
  if (!CONFIRMED)            missing.push('--confirm-full-import flag')
  if (missing.length) {
    console.error('❌  Не хватает предохранителей для полного импорта:')
    missing.forEach(m => console.error(`     • ${m}`))
    console.error('\nЗапусти с --dry-run для проверки без записи.')
    process.exit(1)
  }
}

// ── Supabase client ───────────────────────────────────────────────────────────

const supabase = serviceKey
  ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
  : createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })

// ── Retry helper ──────────────────────────────────────────────────────────────

async function withRetry(fn, label, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()
      // Supabase returns { error } for API errors
      if (result && result.error) {
        const status = result.error.status ?? result.error.statusCode ?? 0
        const isRetryable = status === 429 || (status >= 500 && status < 600)
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 30000)
          console.warn(`  ⚠  ${label}: HTTP ${status}, retry ${attempt}/${maxRetries} in ${delay}ms`)
          await sleep(delay)
          continue
        }
        return result
      }
      return result
    } catch (err) {
      const isNetwork = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message?.includes('fetch')
      if (isNetwork && attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 30000)
        console.warn(`  ⚠  ${label}: network error, retry ${attempt}/${maxRetries} in ${delay}ms`)
        await sleep(delay)
        continue
      }
      throw err
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function runPool(tasks, concurrency) {
  const queue = [...tasks]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const task = queue.shift()
      if (task) await task()
    }
  })
  await Promise.all(workers)
}

// ── File utilities ────────────────────────────────────────────────────────────

function readJsonl(filename) {
  const path = join(CATALOG_DIR, filename)
  if (!existsSync(path)) { console.error(`❌  Не найден: ${path}`); process.exit(1) }
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

function localPathToStoragePath(localPath) {
  const relative = localPath.startsWith(LOCAL_PATH_PREFIX)
    ? localPath.slice(LOCAL_PATH_PREFIX.length)
    : localPath
  // Supabase Storage only allows [a-zA-Z0-9!-_.*()'] in object keys.
  // encodeURIComponent produces %XX sequences but % itself is also forbidden
  // (the API URL-decodes the path, so %D0%9F → "П" which is non-ASCII → rejected).
  // We use 'x' as a safe escape prefix: %D0 → xD0. The original Cyrillic filename
  // is stored in the DB `alt` field so resolveHtml can match it via a.alt === src.
  const hasNonAscii = /[^\x00-\x7F]/.test(relative)
  if (hasNonAscii) {
    const safe = relative.split('/').map(s => encodeURIComponent(s).replace(/%/g, 'x')).join('/')
    return `${STORAGE_PREFIX}/${safe}`
  }
  return `${STORAGE_PREFIX}/${relative.split('/').map(s => encodeURIComponent(s)).join('/')}`
}

function localPathToFile(localPath) {
  const relative = localPath.startsWith(LOCAL_PATH_PREFIX)
    ? localPath.slice(LOCAL_PATH_PREFIX.length)
    : localPath
  return join(IMAGES_DIR, ...relative.split('/'))
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

let checkpoint = { importedTaskIds: [], uploadedStoragePaths: [] }

function loadCheckpoint() {
  if (RESUME && existsSync(CHECKPOINT_FILE)) {
    try {
      checkpoint = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'))
      console.log(`  📌  Checkpoint: ${checkpoint.importedTaskIds?.length ?? 0} задач, ${checkpoint.uploadedStoragePaths?.length ?? 0} assets`)
    } catch { console.warn('  ⚠  Не удалось прочитать checkpoint') }
  }
}

function saveCheckpoint() {
  if (DRY_RUN) return
  try {
    writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
  } catch { console.warn('  ⚠  Не удалось сохранить checkpoint') }
}

// ── Statistics ─────────────────────────────────────────────────────────────────

const stats = {
  sections:   { upserted: 0, errors: 0 },
  topics:     { upserted: 0, errors: 0 },
  tasks:      { upserted: 0, skipped: 0, errors: 0 },
  taskTopics: { upserted: 0, errors: 0 },
  assets:     { uploaded: 0, skipped: 0, errors: 0, retries: 0 },
}
const errorLog = []
const startTime = Date.now()

function logErr(stage, msg) {
  errorLog.push({ stage, msg: String(msg).slice(0, 300) })
  process.stderr.write(`  ✗ [${stage}] ${String(msg).slice(0, 200)}\n`)
}

// ── Paginated fetch helper ─────────────────────────────────────────────────────

async function fetchAllRows(table, selectFields, filters = {}) {
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(selectFields)
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
    const res = await withRetry(() => q.range(from, from + PAGE - 1), `fetch ${table}`)
    if (res.error) { logErr(`fetch_${table}`, res.error.message); break }
    rows.push(...(res.data ?? []))
    if ((res.data?.length ?? 0) < PAGE) break
  }
  return rows
}

// ── 1. Dry-run count check ────────────────────────────────────────────────────

async function dryRunCheck() {
  const sections  = readJsonl('catalog_sections.jsonl')
  const topics    = readJsonl('catalog_topics.jsonl')
  const tasks     = readJsonl('catalog_tasks.jsonl')
  const links     = readJsonl('catalog_task_topics.jsonl')
  const assets    = readJsonl('catalog_task_assets.jsonl')

  const taskLimit = Number.isFinite(LIMIT) ? Math.min(tasks.length, LIMIT) : tasks.length
  const taskIds   = new Set(tasks.slice(0, taskLimit).map(t => String(t.external_id)))
  const assetsSub = assets.filter(a => taskIds.has(String(a.task_external_id)))
  const linksSub  = links.filter(l => taskIds.has(String(l.task_external_id)))

  // Count missing files
  let missingFiles = 0
  for (const a of assetsSub) {
    if (!existsSync(localPathToFile(a.local_path))) missingFiles++
  }

  console.log('\n📊  DRY-RUN сверка:')
  console.log(`    Разделов:     ${sections.length}  (ожидается 21)`)
  console.log(`    Тем:          ${topics.length}  (ожидается 672)`)
  console.log(`    Задач:        ${tasks.length}  (ожидается 5 972)${Number.isFinite(LIMIT) ? ` → лимит ${taskLimit}` : ''}`)
  console.log(`    Связей:       ${links.length}  (ожидается 11 516)${Number.isFinite(LIMIT) ? ` → для лимита: ${linksSub.length}` : ''}`)
  console.log(`    Assets:       ${assets.length}  (ожидается 67 217)${Number.isFinite(LIMIT) ? ` → для лимита: ${assetsSub.length}` : ''}`)
  console.log(`    Отсутствующих файлов: ${missingFiles}`)
  console.log(`    Задач без решения в NO_SOLUTION_IDS: ${tasks.filter(t => NO_SOLUTION_IDS.has(String(t.external_id))).length}`)

  const ok = sections.length === 21 && topics.length === 672 && tasks.length === 5972 &&
             links.length === 11516 && assets.length === 67217 && missingFiles === 0
  console.log(ok ? '\n  ✅  Сверка OK' : '\n  ❌  Несоответствие в данных')
  return ok
}

// ── 2. Import sections ─────────────────────────────────────────────────────────

async function importSections() {
  const rows = readJsonl('catalog_sections.jsonl')
  console.log(`\n📂  Sections: ${rows.length}`)
  if (DRY_RUN) { console.log('  (dry-run, пропуск)'); return }

  const records = rows.map(r => ({
    external_id:  String(r.external_id),
    subject:      SUBJECT,
    exam_type:    EXAM_TYPE,
    exam_number:  r.exam_number ?? null,
    title:        r.title,
    position:     r.position ?? 0,
    is_published: true,
  }))

  const res = await withRetry(() =>
    supabase.from('catalog_sections').upsert(records, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false }),
    'sections upsert'
  )
  if (res.error) { logErr('sections', res.error.message); stats.sections.errors++ }
  else { stats.sections.upserted = records.length; console.log(`  ✓  ${records.length} upserted`) }
}

// ── 3. Import topics ──────────────────────────────────────────────────────────

async function importTopics() {
  const rows = readJsonl('catalog_topics.jsonl')
  console.log(`\n📂  Topics: ${rows.length}`)
  if (DRY_RUN) { console.log('  (dry-run, пропуск)'); return }

  // Pass 1 — upsert без parent_id
  const records = rows.map(r => ({
    external_id:  String(r.external_id),
    subject:      SUBJECT,
    exam_type:    EXAM_TYPE,
    title:        r.title,
    slug:         r.slug ?? null,
    position:     r.position ?? 0,
    is_published: true,
    parent_id:    null,
  }))

  for (let i = 0; i < records.length; i += TASK_BATCH_SIZE) {
    const batch = records.slice(i, i + TASK_BATCH_SIZE)
    const res = await withRetry(() =>
      supabase.from('catalog_topics').upsert(batch, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false }),
      `topics batch ${i}`
    )
    if (res.error) { logErr('topics_pass1', res.error.message); stats.topics.errors++ }
    else stats.topics.upserted += batch.length
  }

  // Build uuid map
  const allTopics = await fetchAllRows('catalog_topics', 'id,external_id', { subject: SUBJECT, exam_type: EXAM_TYPE })
  const extToUuid = Object.fromEntries(allTopics.map(t => [String(t.external_id), t.id]))

  // Pass 2 — set parent_id
  const withParent = rows.filter(r => r.parent_external_id != null)
  for (let i = 0; i < withParent.length; i += TASK_BATCH_SIZE) {
    const batch = withParent.slice(i, i + TASK_BATCH_SIZE)
    for (const r of batch) {
      const parentUuid = extToUuid[String(r.parent_external_id)]
      if (!parentUuid) { logErr('topics_parent', `parent ext=${r.parent_external_id} not found`); continue }
      const res = await withRetry(() =>
        supabase.from('catalog_topics')
          .update({ parent_id: parentUuid })
          .eq('external_id', String(r.external_id))
          .eq('subject', SUBJECT)
          .eq('exam_type', EXAM_TYPE),
        `parent ${r.external_id}`
      )
      if (res.error) logErr('topics_parent_update', res.error.message)
    }
  }

  console.log(`  ✓  ${stats.topics.upserted} upserted, ${withParent.length} parent links`)
}

// ── 4. Import tasks ───────────────────────────────────────────────────────────

async function importTasks(sectionMap) {
  const allTasks = readJsonl('catalog_tasks.jsonl')
  const tasks    = Number.isFinite(LIMIT) ? allTasks.slice(0, LIMIT) : allTasks
  console.log(`\n📂  Tasks: ${tasks.length}${Number.isFinite(LIMIT) ? ` (лимит ${LIMIT})` : ''}`)
  if (DRY_RUN) { console.log('  (dry-run, пропуск)'); return new Set() }

  const resumeSet = new Set(checkpoint.importedTaskIds ?? [])
  let done = 0

  for (let i = 0; i < tasks.length; i += TASK_BATCH_SIZE) {
    const batch = tasks.slice(i, i + TASK_BATCH_SIZE)
    const records = []

    for (const r of batch) {
      const extId = String(r.external_id)
      if (RESUME && resumeSet.has(extId)) { stats.tasks.skipped++; continue }

      const sectionUuid = sectionMap[String(r.primary_section_external_id)]
      if (!sectionUuid) {
        logErr('tasks_section', `section ${r.primary_section_external_id} not found for task ${extId}`)
        stats.tasks.errors++
        continue
      }

      const hasSolution = NO_SOLUTION_IDS.has(extId) ? false : (r.has_solution === true)
      const hasAnswer   = r.has_answer === true

      records.push({
        external_id:         extId,
        subject:             SUBJECT,
        exam_type:           EXAM_TYPE,
        section_id:          sectionUuid,
        statement_html:      r.statement_html       ?? '',
        answer_html:         hasAnswer ? (r.answer_html ?? null) : null,
        solution_html:       hasSolution ? (r.solution_html ?? null) : null,
        solution_plan_html:  r.solution_plan_html   ?? null,
        grade_criteria_html: r.grade_criteria_html  ?? null,
        source_url:          r.source_url           ?? null,
        position:            r.position             ?? 0,
        has_answer:          hasAnswer,
        has_solution:        hasSolution,
        is_published:        r.is_published !== false,
      })
    }

    if (!records.length) continue

    const res = await withRetry(() =>
      supabase.from('catalog_tasks').upsert(records, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false }),
      `tasks batch ${i}`
    )
    if (res.error) {
      logErr('tasks_batch', res.error.message)
      stats.tasks.errors += records.length
    } else {
      stats.tasks.upserted += records.length
      for (const r of records) {
        checkpoint.importedTaskIds ??= []
        checkpoint.importedTaskIds.push(r.external_id)
      }
    }

    done += records.length
    if (done % 500 === 0 || i + TASK_BATCH_SIZE >= tasks.length) {
      process.stdout.write(`  ↳  ${done}/${tasks.length - stats.tasks.skipped} задач...\r`)
      saveCheckpoint()
    }
  }

  console.log(`\n  ✓  ${stats.tasks.upserted} upserted, ${stats.tasks.skipped} skipped, ${stats.tasks.errors} errors`)
  return new Set(tasks.map(t => String(t.external_id)))
}

// ── 5. Import task-topic links ────────────────────────────────────────────────

async function importTaskTopics(importedExtIds) {
  const allLinks = readJsonl('catalog_task_topics.jsonl')
  console.log(`\n📂  Task-Topic links: всего ${allLinks.length}`)
  if (DRY_RUN) { console.log('  (dry-run, пропуск)'); return }

  // Fetch all task and topic UUIDs in pages
  const tasks  = await fetchAllRows('catalog_tasks',  'id,external_id', { subject: SUBJECT, exam_type: EXAM_TYPE })
  const topics = await fetchAllRows('catalog_topics', 'id,external_id', { subject: SUBJECT, exam_type: EXAM_TYPE })
  const taskMap  = Object.fromEntries(tasks.map(t  => [String(t.external_id), t.id]))
  const topicMap = Object.fromEntries(topics.map(t => [String(t.external_id), t.id]))

  const records = []
  for (const r of allLinks) {
    if (!importedExtIds.has(String(r.task_external_id))) continue
    const taskUuid  = taskMap[String(r.task_external_id)]
    const topicUuid = topicMap[String(r.topic_external_id)]
    if (!taskUuid)  continue
    if (!topicUuid) { logErr('task_topics', `topic ext=${r.topic_external_id} not found`); stats.taskTopics.errors++; continue }
    records.push({ task_id: taskUuid, topic_id: topicUuid, is_primary: r.is_primary ?? false })
  }

  for (let i = 0; i < records.length; i += LINK_BATCH_SIZE) {
    const batch = records.slice(i, i + LINK_BATCH_SIZE)
    const res = await withRetry(() =>
      supabase.from('catalog_task_topics').upsert(batch, { onConflict: 'task_id,topic_id', ignoreDuplicates: true }),
      `links batch ${i}`
    )
    if (res.error) { logErr('links_batch', res.error.message); stats.taskTopics.errors++ }
    else stats.taskTopics.upserted += batch.length
  }

  console.log(`  ✓  ${stats.taskTopics.upserted} links upserted`)
}

// ── 6. Import assets ──────────────────────────────────────────────────────────

async function importAssets(importedExtIds) {
  const allAssets = readJsonl('catalog_task_assets.jsonl')
  const subset    = allAssets.filter(a => importedExtIds.has(String(a.task_external_id)))
  console.log(`\n📂  Assets: ${subset.length} (из ${allAssets.length} итого)`)
  if (DRY_RUN) { console.log('  (dry-run, пропуск)'); return }

  // Fetch task UUIDs
  const tasks   = await fetchAllRows('catalog_tasks', 'id,external_id', { subject: SUBJECT, exam_type: EXAM_TYPE })
  const taskMap = Object.fromEntries(tasks.map(t => [String(t.external_id), t.id]))

  // Fetch already-stored paths to skip re-upload (paginated)
  const existingPaths = new Set()
  const taskUuids = [...new Set(subset.map(a => taskMap[String(a.task_external_id)]).filter(Boolean))]
  // Fetch in chunks of 200 task IDs
  for (let i = 0; i < taskUuids.length; i += 200) {
    const chunk = taskUuids.slice(i, i + 200)
    const existing = await fetchAllRows('catalog_task_assets', 'storage_path', {})
    // Can't use fetchAllRows with .in(), so query directly
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const res = await withRetry(() =>
        supabase.from('catalog_task_assets').select('storage_path').in('task_id', chunk).range(from, from + PAGE - 1),
        'fetch existing assets'
      )
      if (res.error) break
      ;(res.data ?? []).forEach(a => existingPaths.add(a.storage_path))
      if ((res.data?.length ?? 0) < PAGE) break
    }
  }

  const resumedPaths = new Set(checkpoint.uploadedStoragePaths ?? [])
  const allSkip      = new Set([...existingPaths, ...resumedPaths])

  // Group assets by task for efficient processing
  const assetsByTask = {}
  for (const a of subset) {
    const ext = String(a.task_external_id)
    ;(assetsByTask[ext] ??= []).push(a)
  }

  const extIds     = Object.keys(assetsByTask)
  let processed    = 0
  const assetQueue = []
  const assetMeta  = []  // rows to upsert into catalog_task_assets

  // Build upload jobs
  for (const extId of extIds) {
    const taskUuid = taskMap[extId]
    if (!taskUuid) continue

    for (const a of assetsByTask[extId]) {
      const storagePath    = localPathToStoragePath(a.local_path)
      const origFilename   = a.local_path.split('/').pop()
      const hasCyrillic    = /[А-яЁё]/.test(origFilename)
      // For Cyrillic-named files the storage key is ASCII-safe (~-encoded).
      // Store the original Cyrillic filename in `alt` so resolveHtml can match
      // it against the <img src="..."> value from statement_html.
      const assetAlt = hasCyrillic ? origFilename : (a.alt ?? null)

      if (allSkip.has(storagePath)) {
        stats.assets.skipped++
        assetMeta.push({ task_id: taskUuid, tex_session_id: a.tex_session_id ?? null, kind: a.kind, storage_path: storagePath, alt: assetAlt, position: a.position ?? 0 })
        continue
      }

      const localFile = localPathToFile(a.local_path)
      if (!existsSync(localFile)) {
        logErr('asset_file', `missing: ${a.local_path}`)
        stats.assets.errors++
        continue
      }

      const storageMeta = { task_id: taskUuid, tex_session_id: a.tex_session_id ?? null, kind: a.kind, storage_path: storagePath, alt: assetAlt, position: a.position ?? 0 }

      assetQueue.push(async () => {
        const fileBuffer  = readFileSync(localFile)
        const contentType = a.local_path.endsWith('.svg') ? 'image/svg+xml'
          : a.local_path.endsWith('.png') ? 'image/png'
          : 'image/jpeg'

        const res = await withRetry(async () => {
          const r = await supabase.storage.from(BUCKET).upload(storagePath, fileBuffer, { contentType, upsert: false })
          return r
        }, `upload ${storagePath}`)

        if (res.error) {
          if (res.error.message?.includes('already exists') || res.error.statusCode === '409') {
            stats.assets.skipped++
          } else {
            logErr('asset_upload', `${a.local_path}: ${res.error.message}`)
            stats.assets.errors++
            return
          }
        } else {
          stats.assets.uploaded++
          checkpoint.uploadedStoragePaths ??= []
          checkpoint.uploadedStoragePaths.push(storagePath)
        }

        assetMeta.push(storageMeta)

        processed++
        if (processed % 500 === 0) {
          process.stdout.write(`  ↳  assets: ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped\r`)
          saveCheckpoint()
        }
      })
    }
  }

  // Add already-skipped metas to queue completed
  console.log(`  →  ${assetQueue.length} assets для загрузки, ${stats.assets.skipped} уже существуют`)

  await runPool(assetQueue, CONCURRENCY)
  saveCheckpoint()

  // Upsert asset metadata in batches
  for (let i = 0; i < assetMeta.length; i += ASSET_BATCH_SIZE) {
    const batch = assetMeta.slice(i, i + ASSET_BATCH_SIZE)
    const res = await withRetry(() =>
      supabase.from('catalog_task_assets').upsert(batch, { onConflict: 'task_id,storage_path', ignoreDuplicates: false }),
      `asset meta batch ${i}`
    )
    if (res.error) logErr('asset_meta', res.error.message)
  }

  console.log(`\n  ✓  ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
}

// ── 7. Verify existing data not touched ───────────────────────────────────────

async function verifyDataIntegrity() {
  console.log('\n🔎  Проверка сохранности существующих данных...')

  const mathEge = await withRetry(() =>
    supabase.from('catalog_tasks').select('id', { count: 'exact', head: true })
      .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ').eq('is_published', true),
    'count math ege'
  )
  const physEge = await withRetry(() =>
    supabase.from('catalog_tasks').select('id', { count: 'exact', head: true })
      .eq('subject', 'Физика').eq('exam_type', 'ЕГЭ').eq('is_published', true),
    'count physics ege'
  )

  const mathEgeCount = mathEge.count ?? '?'
  const physEgeCount = physEge.count ?? '?'
  const mathEgeOk    = mathEgeCount === 9515
  const physEgeOk    = physEgeCount === 3386

  console.log(`    Математика ЕГЭ: ${mathEgeCount} задач ${mathEgeOk ? '✓' : '⚠ ожидалось 9515'}`)
  console.log(`    Физика ЕГЭ:     ${physEgeCount} задач ${physEgeOk ? '✓' : '⚠ ожидалось 3386'}`)

  if (!mathEgeOk || !physEgeOk) {
    console.error('\n❌  Данные ЕГЭ изменились! Прерываю.')
    process.exit(1)
  }
}

// ── 8. Final verification ─────────────────────────────────────────────────────

async function finalVerification() {
  console.log('\n══════════════════════════════════════════════')
  console.log('🔎  Финальная DB-сверка')

  const ogeTasksRes = await withRetry(() =>
    supabase.from('catalog_tasks').select('id', { count: 'exact', head: true })
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE),
    'count oge tasks'
  )
  const ogeSecRes = await withRetry(() =>
    supabase.from('catalog_sections').select('id', { count: 'exact', head: true })
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE),
    'count oge sections'
  )
  const ogeTopRes = await withRetry(() =>
    supabase.from('catalog_topics').select('id', { count: 'exact', head: true })
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE),
    'count oge topics'
  )

  // Links and assets require paginated count
  const ogeTasks = await fetchAllRows('catalog_tasks', 'id,external_id', { subject: SUBJECT, exam_type: EXAM_TYPE })
  const taskUuids = ogeTasks.map(t => t.id)

  // Count links in chunks
  let linkCount = 0
  for (let i = 0; i < taskUuids.length; i += 200) {
    const chunk = taskUuids.slice(i, i + 200)
    const res = await withRetry(() =>
      supabase.from('catalog_task_topics').select('task_id', { count: 'exact', head: true }).in('task_id', chunk),
      'count links chunk'
    )
    linkCount += res.count ?? 0
  }

  // Count assets in chunks
  let assetCount = 0
  for (let i = 0; i < taskUuids.length; i += 200) {
    const chunk = taskUuids.slice(i, i + 200)
    const res = await withRetry(() =>
      supabase.from('catalog_task_assets').select('id', { count: 'exact', head: true }).in('task_id', chunk),
      'count assets chunk'
    )
    assetCount += res.count ?? 0
  }

  // Check no_solution tasks
  const noSolTasks = ogeTasks.filter(t => NO_SOLUTION_IDS.has(String(t.external_id)))
  let noSolCorrect = 0
  for (const t of noSolTasks) {
    const res = await withRetry(() =>
      supabase.from('catalog_tasks').select('has_solution').eq('id', t.id).single(),
      'check has_solution'
    )
    if (res.data?.has_solution === false) noSolCorrect++
  }

  const mathEgeRes = await withRetry(() =>
    supabase.from('catalog_tasks').select('id', { count: 'exact', head: true })
      .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ'),
    'count math ege final'
  )
  const physEgeRes = await withRetry(() =>
    supabase.from('catalog_tasks').select('id', { count: 'exact', head: true })
      .eq('subject', 'Физика').eq('exam_type', 'ЕГЭ'),
    'count phys ege final'
  )

  const r = {
    sections:    ogeSecRes.count ?? '?',
    topics:      ogeTopRes.count ?? '?',
    tasks:       ogeTasksRes.count ?? '?',
    links:       linkCount,
    assets:      assetCount,
    noSolution:  `${noSolCorrect}/${noSolTasks.length}`,
    mathEge:     mathEgeRes.count ?? '?',
    physEge:     physEgeRes.count ?? '?',
  }

  const checks = [
    ['ОГЭ sections', r.sections, 21],
    ['ОГЭ topics',   r.topics,   672],
    ['ОГЭ tasks',    r.tasks,    5972],
    ['ОГЭ links',    r.links,    11516],
    ['ОГЭ assets',   r.assets,   67217],
    ['Матем ЕГЭ',   r.mathEge,  9515],
    ['Физика ЕГЭ',  r.physEge,  3386],
  ]

  checks.forEach(([label, actual, expected]) => {
    const ok = actual === expected
    console.log(`  ${ok ? '✓' : '✗'}  ${label}: ${actual} ${ok ? '' : `(ожидалось ${expected})`}`)
  })
  console.log(`  ${'✓'}  has_solution=false: ${r.noSolution} задач`)

  const allOk = checks.every(([, a, e]) => a === e)
  if (allOk) {
    console.log('\n  ✅  Все счётчики совпадают')
  } else {
    console.warn('\n  ⚠️   Некоторые счётчики не совпадают — проверь логи ошибок')
  }

  return r
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  Импорт Математика ОГЭ (ПОЛНЫЙ)')
  console.log(`    SUBJECT=${SUBJECT}  EXAM_TYPE=${EXAM_TYPE}`)
  console.log(`    CATALOG_DIR=${CATALOG_DIR}`)
  console.log(`    DRY_RUN=${DRY_RUN}  RESUME=${RESUME}  LIMIT=${Number.isFinite(LIMIT) ? LIMIT : 'none'}`)
  console.log(`    Service key: ${serviceKey ? '[задан]' : '[не задан — RLS активен]'}`)

  if (DRY_RUN) {
    console.log('\n⚠️   DRY-RUN режим — данные не записываются\n')
    const ok = await dryRunCheck()
    process.exit(ok ? 0 : 1)
  }

  loadCheckpoint()
  await verifyDataIntegrity()

  // Build section map
  await importSections()
  const sections = await fetchAllRows('catalog_sections', 'id,external_id', { subject: SUBJECT, exam_type: EXAM_TYPE })
  const sectionMap = Object.fromEntries(sections.map(s => [String(s.external_id), s.id]))

  await importTopics()
  const importedExtIds = await importTasks(sectionMap)
  await importTaskTopics(importedExtIds)
  await importAssets(importedExtIds)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)

  console.log('\n══════════════════════════════════════════════')
  console.log('📊  Итог импорта:')
  console.log(`    Sections:   ${stats.sections.upserted} upserted, ${stats.sections.errors} errors`)
  console.log(`    Topics:     ${stats.topics.upserted} upserted, ${stats.topics.errors} errors`)
  console.log(`    Tasks:      ${stats.tasks.upserted} upserted, ${stats.tasks.skipped} skipped, ${stats.tasks.errors} errors`)
  console.log(`    Links:      ${stats.taskTopics.upserted} upserted, ${stats.taskTopics.errors} errors`)
  console.log(`    Assets:     ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
  console.log(`    Длительность: ${elapsed}s`)

  if (errorLog.length) {
    console.warn(`\n⚠️   Ошибок: ${errorLog.length}`)
    errorLog.slice(0, 20).forEach(e => console.error(`  [${e.stage}] ${e.msg}`))
    if (errorLog.length > 20) console.warn(`  ... и ещё ${errorLog.length - 20}`)
  }

  const summary = await finalVerification()

  const logPath = join(process.cwd(), `math-oge-import-${Date.now()}.json`)
  writeFileSync(logPath, JSON.stringify({
    started: new Date(startTime).toISOString(),
    elapsed: `${elapsed}s`,
    stats,
    errors: errorLog,
    dbCounts: summary,
  }, null, 2))
  console.log(`\n📄  Лог сохранён: ${logPath}`)

  if (errorLog.length === 0) {
    console.log('\n✅  Импорт завершён успешно')
    process.exit(0)
  } else {
    console.log('\n⚠️   Импорт завершён с ошибками')
    process.exit(1)
  }
}

main().catch(e => { console.error('Fatal:', e.message ?? e); process.exit(1) })
