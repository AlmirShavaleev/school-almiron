/**
 * Полный импорт каталога ФИЗИКИ ЕГЭ.
 *
 * Тройной замок безопасности (требуются ВСЕ три):
 *   1. SUPABASE_SERVICE_ROLE_KEY=<key>
 *   2. CATALOG_PHYSICS_FULL_IMPORT_CONFIRMED=yes
 *   3. --confirm-full-import
 *
 * Запуск:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> CATALOG_PHYSICS_FULL_IMPORT_CONFIRMED=yes \
 *     node scripts/import-physics-catalog-full.mjs --confirm-full-import
 *
 * Флаги:
 *   --dry-run           Только парсинг/валидация, без записи в БД/Storage
 *   --limit N           Импортировать только N задач (все разделы/темы)
 *   --resume            Продолжить с checkpoint
 *   --concurrency N     Параллельность Storage uploads (default 5)
 *   --database-only     Только БД, без Storage
 *   --storage-only      Только Storage (пропустить разделы/темы/задачи)
 *
 * Секреты НИКОГДА не выводятся в лог.
 * Математический каталог, sample, прогресс учеников НЕ затрагиваются.
 */

import { createClient }    from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, basename }  from 'path'

// ── Константы ─────────────────────────────────────────────────────────────────

const SUPABASE_URL  = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'

const SUBJECT    = 'Физика'
const EXAM_TYPE  = 'ЕГЭ'
const FULL_DIR   = 'D:/школково спарсенные файлы/shkolkovo_physics_catalog/outputs/normalized_catalog'
const IMAGES_DIR = 'D:/школково спарсенные файлы/shkolkovo_physics_catalog/outputs/shkolkovo_physics_images'
const BUCKET         = 'catalog-assets'
const STORAGE_PREFIX = 'physics-ege'

const DB_BATCH_SIZE      = 100
const ASSET_CHUNK_SIZE   = 200
const MAX_RETRIES        = 3
const RETRY_BASE_MS      = 1000
const CHECKPOINT_EVERY   = 500  // save checkpoint every N asset uploads

const CHECKPOINT_FILE  = 'physics-import-checkpoint.json'
const SUMMARY_FILE     = 'physics-import-summary.json'
const ERRORS_FILE      = 'physics-import-errors.jsonl'
const SKIPPED_FILE     = 'physics-skipped-assets.jsonl'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const DRY_RUN         = args.includes('--dry-run')
const RESUME          = args.includes('--resume')
const DATABASE_ONLY   = args.includes('--database-only')
const STORAGE_ONLY    = args.includes('--storage-only')
const CONFIRM_FLAG    = args.includes('--confirm-full-import')
const limitIdx        = args.indexOf('--limit')
const LIMIT           = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null
const concIdx         = args.indexOf('--concurrency')
const CONCURRENCY     = concIdx !== -1 ? parseInt(args[concIdx + 1], 10) : 5

// ── Triple safety lock ────────────────────────────────────────────────────────

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const confirmed  = process.env.CATALOG_PHYSICS_FULL_IMPORT_CONFIRMED === 'yes'

if (!DRY_RUN) {
  if (!serviceKey) {
    console.error('❌  SUPABASE_SERVICE_ROLE_KEY не задан. Выход без изменений.')
    process.exit(1)
  }
  if (!confirmed) {
    console.error('❌  CATALOG_PHYSICS_FULL_IMPORT_CONFIRMED != "yes". Выход без изменений.')
    process.exit(1)
  }
  if (!CONFIRM_FLAG) {
    console.error('❌  Флаг --confirm-full-import не передан. Выход без изменений.')
    process.exit(1)
  }
}

// ── Supabase client ───────────────────────────────────────────────────────────

const supabase = serviceKey
  ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
  : createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })

// ── Утилиты ───────────────────────────────────────────────────────────────────

function readJsonl(filename) {
  const path = join(FULL_DIR, filename)
  if (!existsSync(path)) { console.error(`❌  Файл не найден: ${path}`); process.exit(1) }
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

/** Кодирует storage path: каждый сегмент через encodeURIComponent (пробелы, скобки, кириллица) */
function encodeStoragePath(prefix, localPath) {
  return prefix + '/' + localPath.split('/').map(s => encodeURIComponent(s)).join('/')
}

/** Строит HTML из набора assets (solution_plan / grade_criteria) */
function buildAssetsHtml(assets) {
  if (!assets || assets.length === 0) return null
  const sorted = [...assets].sort((a, b) => a.position - b.position)
  const imgs = sorted.map(a => {
    const filename = basename(a.local_path)
    const alt = a.alt ? ` alt="${a.alt.replace(/"/g, '&quot;')}"` : ''
    return `<img src="${filename}"${alt}/>`
  })
  return `<p>${imgs.join(' ')}</p>`
}

/** Retry с exponential backoff для transient errors */
async function withRetry(fn, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const msg = err?.message ?? String(err)
      const isTransient = /429|5[0-9][0-9]|network|timeout|ECONNRESET/i.test(msg)
      if (!isTransient || attempt === MAX_RETRIES) throw err
      const delay = RETRY_BASE_MS * Math.pow(2, attempt)
      stats.retries++
      process.stdout.write(`  ⟳ [${label}] Retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms\n`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

/** Ограниченный параллельный map */
async function poolMap(items, concurrency, fn) {
  const results = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

// ── Состояние ─────────────────────────────────────────────────────────────────

const stats = {
  sections:   { upserted: 0, errors: 0 },
  topics:     { upserted: 0, errors: 0 },
  tasks:      { upserted: 0, errors: 0, skipped: 0 },
  taskTopics: { upserted: 0, errors: 0 },
  assets:     { uploaded: 0, skipped: 0, errors: 0 },
  retries:    0,
}
const errorLines = []
const skippedLines = []

function logError(phase, detail) {
  const line = JSON.stringify({ phase, ...( typeof detail === 'string' ? { message: detail } : detail) })
  errorLines.push(line)
  console.error(`  ✗ [${phase}] ${line.slice(0, 200)}`)
}

function logSkipped(detail) {
  skippedLines.push(JSON.stringify(detail))
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

let checkpoint = { assetsUploaded: 0, uploadedPaths: [] }

function loadCheckpoint() {
  if (RESUME && existsSync(CHECKPOINT_FILE)) {
    checkpoint = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8'))
    console.log(`  📂  Resuming from checkpoint: ${checkpoint.assetsUploaded} assets already done`)
  }
}

function saveCheckpoint() {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2))
}

// ── Phase 1: Sections ─────────────────────────────────────────────────────────

async function importSections(rows) {
  console.log(`\n📂  Sections: ${rows.length} записей`)
  if (DRY_RUN) { console.log('  [dry-run] skipped'); return }

  const records = rows.map(r => ({
    external_id:  r.external_id,
    subject:      r.subject  ?? SUBJECT,
    exam_type:    r.exam_type ?? EXAM_TYPE,
    exam_number:  r.exam_number ?? null,
    title:        r.title,
    position:     r.position ?? 0,
    is_published: true,
  }))

  const { error } = await supabase
    .from('catalog_sections')
    .upsert(records, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false })

  if (error) { logError('sections', error.message); stats.sections.errors++ }
  else { stats.sections.upserted = records.length; console.log(`  ✓  ${records.length} sections upserted`) }
}

// ── Phase 2: Topics ───────────────────────────────────────────────────────────

async function importTopics(rows) {
  console.log(`\n📂  Topics: ${rows.length} записей`)
  if (DRY_RUN) { console.log('  [dry-run] skipped'); return }

  // Upsert без parent_id первым проходом
  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE)
    const records = batch.map(r => ({
      external_id:  r.external_id,
      subject:      SUBJECT,
      exam_type:    EXAM_TYPE,
      title:        r.title,
      slug:         r.slug ?? null,
      position:     r.position ?? 0,
      is_published: true,
      parent_id:    null,
    }))
    const { error } = await supabase
      .from('catalog_topics')
      .upsert(records, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false })
    if (error) { logError('topics_upsert', error.message); stats.topics.errors++ }
    else stats.topics.upserted += records.length
  }

  // Маппинг external_id → uuid
  const { data: allTopics, error: e2 } = await supabase
    .from('catalog_topics')
    .select('id, external_id')
    .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
  if (e2) { logError('topics_fetch', e2.message); return }
  const extToUuid = Object.fromEntries(allTopics.map(t => [t.external_id, t.id]))

  // Второй проход — parent links
  const withParent = rows.filter(r => r.parent_external_id != null)
  let resolved = 0
  for (const r of withParent) {
    const parentUuid = extToUuid[r.parent_external_id]
    if (!parentUuid) { logError('topics_parent', `parent_external_id ${r.parent_external_id} not found`); continue }
    const { error } = await supabase
      .from('catalog_topics')
      .update({ parent_id: parentUuid })
      .eq('external_id', r.external_id)
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
    if (error) logError('topics_parent_update', error.message)
    else resolved++
  }

  console.log(`  ✓  ${stats.topics.upserted} topics upserted, ${resolved} parent links resolved`)
}

// ── Pagination helper ─────────────────────────────────────────────────────────

async function fetchAllPhysicsTasks() {
  const PAGE = 1000
  const all = []
  let from = 0
  while (true) {
    const { data } = await supabase.from('catalog_tasks').select('id, external_id')
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
      .range(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// ── Phase 3: Tasks ────────────────────────────────────────────────────────────

async function importTasks(rows, assetsByTask) {
  const limited = LIMIT ? rows.slice(0, LIMIT) : rows
  console.log(`\n📂  Tasks: ${limited.length} записей${LIMIT ? ` (limit ${LIMIT})` : ''}`)
  if (DRY_RUN) { console.log('  [dry-run] skipped'); return }

  // Section map
  const { data: sections } = await supabase
    .from('catalog_sections')
    .select('id, external_id')
    .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
  const secMap = Object.fromEntries((sections ?? []).map(s => [s.external_id, s.id]))

  for (let i = 0; i < limited.length; i += DB_BATCH_SIZE) {
    const batch = limited.slice(i, i + DB_BATCH_SIZE)
    for (const r of batch) {
      const sectionUuid = secMap[r.primary_section_external_id]
      if (!sectionUuid) {
        logError('tasks_section', { external_id: r.external_id, section: r.primary_section_external_id })
        stats.tasks.errors++
        continue
      }

      // Build plan/criteria HTML from assets if present
      const taskAssets = assetsByTask[r.external_id] ?? {}
      const planHtml  = buildAssetsHtml(taskAssets.solution_plan)
      const gradeHtml = buildAssetsHtml(taskAssets.grade_criteria)

      const record = {
        external_id:         r.external_id,
        subject:             SUBJECT,
        exam_type:           EXAM_TYPE,
        section_id:          sectionUuid,
        statement_html:      r.statement_html,
        answer_html:         r.answer_html        ?? null,
        solution_html:       r.solution_html      ?? null,
        solution_plan_html:  planHtml,
        grade_criteria_html: gradeHtml,
        source_url:          r.source_url         ?? null,
        position:            r.position           ?? 0,
        has_answer:          r.has_answer  === true,
        has_solution:        r.has_solution === true,
        is_published:        r.is_published !== false,
      }

      await withRetry(async () => {
        const { error } = await supabase
          .from('catalog_tasks')
          .upsert(record, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false })
        if (error) throw new Error(error.message)
      }, `task ext=${r.external_id}`).then(() => {
        stats.tasks.upserted++
      }).catch(err => {
        logError('tasks', { external_id: r.external_id, message: err.message })
        stats.tasks.errors++
      })
    }

    if ((i + DB_BATCH_SIZE) % 500 === 0 || i + DB_BATCH_SIZE >= limited.length) {
      process.stdout.write(`  … tasks ${Math.min(i + DB_BATCH_SIZE, limited.length)}/${limited.length}\n`)
    }
  }
  console.log(`  ✓  ${stats.tasks.upserted} tasks upserted, ${stats.tasks.errors} errors`)
}

// ── Phase 4: Task-Topic links ─────────────────────────────────────────────────

async function importTaskTopics(rows, importedExtIds) {
  // Filter to only links for tasks we actually imported
  const filtered = importedExtIds
    ? rows.filter(r => importedExtIds.has(r.task_external_id))
    : rows
  console.log(`\n📂  Task-Topic links: ${filtered.length} из ${rows.length}`)
  if (DRY_RUN) { console.log('  [dry-run] skipped'); return }

  const tasks    = await fetchAllPhysicsTasks()
  const { data: topics } = await supabase.from('catalog_topics').select('id, external_id')
    .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE).limit(10000)

  const taskMap  = Object.fromEntries(tasks.map(t => [t.external_id, t.id]))
  const topicMap = Object.fromEntries((topics ?? []).map(t => [t.external_id, t.id]))

  const records = []
  for (const r of filtered) {
    const taskUuid  = taskMap[r.task_external_id]
    const topicUuid = topicMap[r.topic_external_id]
    if (!taskUuid) continue   // task not imported (limit mode)
    if (!topicUuid) {
      logError('task_topics', `topic ext=${r.topic_external_id} for task ext=${r.task_external_id} not found`)
      stats.taskTopics.errors++
      continue
    }
    records.push({ task_id: taskUuid, topic_id: topicUuid, is_primary: r.is_primary ?? false })
  }

  for (let i = 0; i < records.length; i += DB_BATCH_SIZE) {
    const chunk = records.slice(i, i + DB_BATCH_SIZE)
    const { error } = await supabase
      .from('catalog_task_topics')
      .upsert(chunk, { onConflict: 'task_id,topic_id', ignoreDuplicates: true })
    if (error) { logError('task_topics_upsert', error.message); stats.taskTopics.errors++ }
    else stats.taskTopics.upserted += chunk.length
  }
  console.log(`  ✓  ${stats.taskTopics.upserted} links upserted, ${stats.taskTopics.errors} errors`)
}

// ── Phase 5: Assets ───────────────────────────────────────────────────────────

async function importAssets(rows, importedExtIds) {
  // Filter to tasks we imported
  const filtered = importedExtIds
    ? rows.filter(r => importedExtIds.has(r.task_external_id))
    : rows
  console.log(`\n📂  Assets: ${filtered.length} из ${rows.length}`)
  if (DRY_RUN) { console.log('  [dry-run] skipped'); return }
  if (DATABASE_ONLY) { console.log('  [database-only] storage skipped'); return }

  const tasks   = await fetchAllPhysicsTasks()
  const taskMap = Object.fromEntries(tasks.map(t => [t.external_id, t.id]))

  // Existing paths in DB (for idempotency) — paginated to bypass PostgREST max-rows
  const taskIds = Object.values(taskMap)
  const existingPathsArr = []
  const ASSET_PAGE = 1000
  for (let from = 0; ; from += ASSET_PAGE) {
    const { data } = await supabase
      .from('catalog_task_assets')
      .select('storage_path')
      .in('task_id', taskIds)
      .range(from, from + ASSET_PAGE - 1)
    if (!data || data.length === 0) break
    existingPathsArr.push(...data.map(a => a.storage_path))
    if (data.length < ASSET_PAGE) break
  }
  const existingPaths = new Set([
    ...existingPathsArr,
    ...checkpoint.uploadedPaths,
  ])

  const toUpload = filtered.filter(r => {
    const sp = encodeStoragePath(STORAGE_PREFIX, r.local_path)
    return !existingPaths.has(sp)
  })
  console.log(`  →  ${existingPaths.size} уже загружено/пропущено, ${toUpload.length} к загрузке`)

  const assetRecords = []
  let uploadedSinceCheckpoint = 0

  await poolMap(toUpload, CONCURRENCY, async (r) => {
    const taskUuid = taskMap[r.task_external_id]
    if (!taskUuid) return

    const storagePath = encodeStoragePath(STORAGE_PREFIX, r.local_path)
    const localFile   = join(IMAGES_DIR, r.local_path)

    if (!existsSync(localFile)) {
      logSkipped({ phase: 'assets_file', local_path: r.local_path, task_external_id: r.task_external_id })
      stats.assets.errors++
      return
    }

    const fileBuffer  = readFileSync(localFile)
    const contentType = r.local_path.endsWith('.svg') ? 'image/svg+xml'
      : r.local_path.endsWith('.png') ? 'image/png' : 'image/jpeg'

    try {
      await withRetry(async () => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, fileBuffer, { contentType, upsert: true, cacheControl: '31536000' })
        if (error && !error.message.includes('already exists')) throw new Error(error.message)
      }, `upload ${r.local_path}`)

      stats.assets.uploaded++
      uploadedSinceCheckpoint++
      checkpoint.uploadedPaths.push(storagePath)
      checkpoint.assetsUploaded++

      assetRecords.push({
        task_id:        taskUuid,
        tex_session_id: r.tex_session_id ?? null,
        kind:           r.kind,
        storage_path:   storagePath,
        source_url:     r.source_url ?? null,
        alt:            r.alt        ?? null,
        size_bytes:     r.size_bytes ?? null,
        position:       r.position   ?? 0,
      })

      if (uploadedSinceCheckpoint % CHECKPOINT_EVERY === 0) {
        saveCheckpoint()
        process.stdout.write(`  … ${stats.assets.uploaded} uploaded\n`)
      }
    } catch (err) {
      logError('assets_upload', { local_path: r.local_path, message: err.message })
      stats.assets.errors++
    }
  })

  // Batch insert asset records
  for (let i = 0; i < assetRecords.length; i += ASSET_CHUNK_SIZE) {
    const chunk = assetRecords.slice(i, i + ASSET_CHUNK_SIZE)
    const { error } = await supabase.from('catalog_task_assets')
      .upsert(chunk, { onConflict: 'task_id,storage_path', ignoreDuplicates: true })
    if (error) logError('assets_insert', error.message)
  }

  saveCheckpoint()
  console.log(`  ✓  ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now()

  console.log('═══════════════════════════════════════════════════════')
  console.log(`  Полный импорт ФИЗИКИ ЕГЭ${DRY_RUN ? ' [DRY RUN]' : ''}${LIMIT ? ` [LIMIT ${LIMIT}]` : ''}`)
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  Supabase: ${SUPABASE_URL}`)
  console.log(`  FULL_DIR: ${FULL_DIR}`)
  console.log(`  IMAGES:   ${IMAGES_DIR}`)
  console.log(`  Subject:  ${SUBJECT} / ${EXAM_TYPE}`)
  console.log(`  Concurrency: ${CONCURRENCY}`)
  if (DRY_RUN)   console.log('  ⚠️   DRY RUN — ничего не записывается')
  if (RESUME)    console.log('  ▶   RESUME mode')

  // Load data
  console.log('\n📖  Загрузка JSONL...')
  const sections  = readJsonl('catalog_sections.jsonl')
  const topics    = readJsonl('catalog_topics.jsonl')
  const tasks     = readJsonl('catalog_tasks.jsonl')
  const taskTopics = readJsonl('catalog_task_topics.jsonl')
  const assetsAll  = readJsonl('catalog_task_assets.jsonl')

  console.log(`  Sections: ${sections.length}, Topics: ${topics.length}, Tasks: ${tasks.length}`)
  console.log(`  TaskTopics: ${taskTopics.length}, Assets: ${assetsAll.length}`)

  // Validate special rule
  const task130471 = tasks.find(t => t.external_id === 130471)
  if (task130471 && task130471.has_solution !== false) {
    console.warn('  ⚠️  task 130471: has_solution overriding to false')
    task130471.has_solution = false
  }

  // Group assets by task_external_id and kind (for building plan/grade HTML)
  const assetsByTask = {}
  for (const a of assetsAll) {
    if (!assetsByTask[a.task_external_id]) assetsByTask[a.task_external_id] = {}
    if (!assetsByTask[a.task_external_id][a.kind]) assetsByTask[a.task_external_id][a.kind] = []
    assetsByTask[a.task_external_id][a.kind].push(a)
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Проверка данных:')
    const special = assetsAll.filter(a => /[^a-zA-Z0-9._\-\/]/.test(a.local_path))
    console.log(`  Special char paths: ${special.length}`)
    console.log(`  Tasks with plan HTML: ${Object.values(assetsByTask).filter(v=>v.solution_plan).length}`)
    console.log(`  Tasks with grade HTML: ${Object.values(assetsByTask).filter(v=>v.grade_criteria).length}`)
    console.log(`  Task 130471 has_solution: ${task130471?.has_solution}`)
    const missingFiles = assetsAll.filter(a => !existsSync(join(IMAGES_DIR, a.local_path)))
    console.log(`  Missing local files: ${missingFiles.length}`)
    console.log('\n✅  Dry run завершён — всё корректно')
    return
  }

  loadCheckpoint()
  if (!DRY_RUN) console.log(`\n  🔑  Service role — RLS bypassed`)

  // Determine which tasks are being imported
  const limitedTasks = LIMIT ? tasks.slice(0, LIMIT) : tasks
  const importedExtIds = new Set(limitedTasks.map(t => t.external_id))

  if (!STORAGE_ONLY) {
    await importSections(sections)
    await importTopics(topics)
    await importTasks(limitedTasks, assetsByTask)
    await importTaskTopics(taskTopics, importedExtIds)
  }

  if (!DATABASE_ONLY) {
    await importAssets(assetsAll, importedExtIds)
  }

  // Write reports
  const elapsed = Math.round((Date.now() - startTime) / 1000)
  const summary = {
    subject: SUBJECT, exam_type: EXAM_TYPE,
    startedAt: new Date(startTime).toISOString(),
    durationSec: elapsed,
    dry_run: DRY_RUN,
    limit: LIMIT,
    stats,
    errorCount: errorLines.length,
    skippedCount: skippedLines.length,
  }

  writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2))
  if (errorLines.length)   writeFileSync(ERRORS_FILE,  errorLines.join('\n') + '\n')
  if (skippedLines.length) writeFileSync(SKIPPED_FILE, skippedLines.join('\n') + '\n')

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  Итог')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  Sections:    ${stats.sections.upserted} upserted, ${stats.sections.errors} errors`)
  console.log(`  Topics:      ${stats.topics.upserted} upserted, ${stats.topics.errors} errors`)
  console.log(`  Tasks:       ${stats.tasks.upserted} upserted, ${stats.tasks.errors} errors`)
  console.log(`  TaskTopics:  ${stats.taskTopics.upserted} upserted, ${stats.taskTopics.errors} errors`)
  console.log(`  Assets:      ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
  console.log(`  Retries:     ${stats.retries}`)
  console.log(`  Duration:    ${elapsed}s (${Math.floor(elapsed/60)}m ${elapsed%60}s)`)
  if (errorLines.length)   console.log(`  Errors log:  ${ERRORS_FILE}`)
  if (skippedLines.length) console.log(`  Skipped log: ${SKIPPED_FILE}`)
  console.log(`  Summary:     ${SUMMARY_FILE}`)
  console.log(errorLines.length === 0 ? '\n✅  Импорт завершён без ошибок' : `\n⚠️   Импорт завершён с ${errorLines.length} ошибками`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
