/**
 * Импорт ТОЛЬКО sample-каталога «Математика ОГЭ»
 * (1 раздел, 6 тем, 30 задач, 358 assets).
 *
 * ⚠️  Максимум 30 задач — hard limit, полный импорт этим скриптом невозможен.
 *
 * Использование:
 *   SUPABASE_SERVICE_KEY=<key> node scripts/import-math-oge-catalog-sample.mjs
 *
 * Повторный запуск безопасен: upsert по (subject, exam_type, external_id).
 * Не изменяет математику ЕГЭ, физику ЕГЭ и catalog_task_progress.
 * Не выводит секреты в консоль.
 *
 * Storage prefix: math-oge/{tex_session_id}/{safe_filename}
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

// ── Константы ─────────────────────────────────────────────────────────────────

const SUPABASE_URL  = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'

const SUBJECT      = 'Математика'
const EXAM_TYPE    = 'ОГЭ'
const MAX_TASKS    = 30          // hard limit — cannot import full catalog

// local_path relative root — one level up from sample dir
const SAMPLE_DIR   = 'D:/школково спарсенные файлы/shkolkovo_oge_math_catalog/outputs/normalized_catalog/sample'
const CATALOG_DIR  = resolve(SAMPLE_DIR, '..')   // normalized_catalog/
const BUCKET       = 'catalog-assets'
const STORAGE_PREFIX = 'math-oge'

// Prefix that local_path values start with (relative to CATALOG_DIR)
const LOCAL_PATH_PREFIX = '../shkolkovo_oge_math_images/'

// Tasks that must have has_solution = false even if data says otherwise
const NO_SOLUTION_IDS = new Set([
  120232, 120238, 120239, 120244, 120245, 120246, 120247,
  120249, 120250, 120251, 120252, 120253, 120254, 120255,
  120256, 120409, 120411, 120412, 120426, 120427, 120429,
  163016, 178028,
].map(String))

// ── Клиент ────────────────────────────────────────────────────────────────────

const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = serviceKey
  ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
  : createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })

async function authenticate() {
  if (serviceKey) {
    console.log('  🔑  Service role key — RLS bypassed')
    return
  }
  const email    = process.env.IMPORT_EMAIL
  const password = process.env.IMPORT_PASSWORD
  if (!email || !password) {
    console.error('❌  Укажи SUPABASE_SERVICE_KEY или IMPORT_EMAIL+IMPORT_PASSWORD')
    process.exit(1)
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) { console.error(`❌  Ошибка входа: ${error.message}`); process.exit(1) }
  console.log(`  👤  Вошли как ${data.user?.email}`)
}

// ── Утилиты ───────────────────────────────────────────────────────────────────

function readJsonl(filename) {
  const path = join(SAMPLE_DIR, filename)
  if (!existsSync(path)) { console.error(`❌  Файл не найден: ${path}`); process.exit(1) }
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

/**
 * Converts local_path to Storage path under math-oge/.
 *
 * local_path looks like: ../shkolkovo_oge_math_images/{session}/{filename}
 * Storage path:          math-oge/{encoded_session}/{encoded_filename}
 *
 * Each path segment is encoded with encodeURIComponent so spaces, Cyrillic
 * and special chars become %-sequences. safeDecodeStoragePath on the frontend
 * then decodes before calling getPublicUrl, preventing double-encoding.
 */
function localPathToStoragePath(localPath) {
  // Strip the leading prefix to get just "{session}/{filename}"
  const relative = localPath.startsWith(LOCAL_PATH_PREFIX)
    ? localPath.slice(LOCAL_PATH_PREFIX.length)
    : localPath
  const segments = relative.split('/')
  const encoded  = segments.map(s => encodeURIComponent(s)).join('/')
  return `${STORAGE_PREFIX}/${encoded}`
}

/**
 * Resolves local_path to an absolute file system path.
 * local_path is relative to CATALOG_DIR (one level above sample/).
 */
function localPathToFile(localPath) {
  return resolve(CATALOG_DIR, localPath)
}

const stats = {
  sections:   { upserted: 0, errors: 0 },
  topics:     { upserted: 0, errors: 0 },
  tasks:      { upserted: 0, errors: 0 },
  taskTopics: { upserted: 0, errors: 0 },
  assets:     { uploaded: 0, skipped: 0, errors: 0 },
}
const errors = []

function logError(stage, detail) {
  errors.push({ stage, detail })
  const msg = typeof detail === 'string' ? detail : JSON.stringify(detail)
  console.error(`  ✗ [${stage}] ${msg.slice(0, 250)}`)
}

// ── 1. Sections ───────────────────────────────────────────────────────────────

async function importSections() {
  const rows = readJsonl('catalog_sections.jsonl')
  console.log(`\n📂  Sections: ${rows.length} записей`)

  const records = rows.map(r => ({
    external_id:  String(r.external_id),
    subject:      r.subject   ?? SUBJECT,
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

// ── 2. Topics ─────────────────────────────────────────────────────────────────

async function importTopics() {
  const rows = readJsonl('catalog_topics.jsonl')
  console.log(`\n📂  Topics: ${rows.length} записей`)

  // Pass 1 — upsert without parent_id
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

  const { error: e1 } = await supabase
    .from('catalog_topics')
    .upsert(records, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false })

  if (e1) { logError('topics_pass1', e1.message); stats.topics.errors++; return }

  // Fetch uuid map for this subject+exam
  const { data: allTopics, error: e2 } = await supabase
    .from('catalog_topics')
    .select('id, external_id')
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)

  if (e2) { logError('topics_fetch', e2.message); return }

  const extToUuid = Object.fromEntries((allTopics ?? []).map(t => [String(t.external_id), t.id]))

  // Pass 2 — set parent_id
  const withParent = rows.filter(r => r.parent_external_id != null)
  for (const r of withParent) {
    const parentUuid = extToUuid[String(r.parent_external_id)]
    if (!parentUuid) { logError('topics_parent', `parent_external_id ${r.parent_external_id} not found`); continue }
    const { error: e3 } = await supabase
      .from('catalog_topics')
      .update({ parent_id: parentUuid })
      .eq('external_id', String(r.external_id))
      .eq('subject', SUBJECT)
      .eq('exam_type', EXAM_TYPE)
    if (e3) logError('topics_parent_update', e3.message)
  }

  stats.topics.upserted = records.length
  console.log(`  ✓  ${records.length} topics upserted, ${withParent.length} parent links resolved`)
}

// ── 3. Tasks ──────────────────────────────────────────────────────────────────

async function importTasks() {
  const allRows = readJsonl('catalog_tasks.jsonl')
  const rows = allRows.slice(0, MAX_TASKS)
  console.log(`\n📂  Tasks: ${rows.length} (лимит ${MAX_TASKS}, всего в файле: ${allRows.length})`)

  const { data: sections } = await supabase
    .from('catalog_sections')
    .select('id, external_id')
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)
  const secMap = Object.fromEntries((sections ?? []).map(s => [String(s.external_id), s.id]))

  for (const r of rows) {
    const extId = String(r.external_id)
    const sectionUuid = secMap[String(r.primary_section_external_id)]
    if (!sectionUuid) {
      logError('tasks_section', `section ${r.primary_section_external_id} not found for task ${extId}`)
      stats.tasks.errors++
      continue
    }

    // Honour the explicit has_solution/has_answer from JSON, then apply override list
    const hasSolution = NO_SOLUTION_IDS.has(extId) ? false : (r.has_solution === true)
    const hasAnswer   = r.has_answer === true

    const record = {
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
    }

    const { error } = await supabase
      .from('catalog_tasks')
      .upsert(record, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false })

    if (error) { logError('tasks', `ext=${extId}: ${error.message}`); stats.tasks.errors++ }
    else stats.tasks.upserted++
  }

  console.log(`  ✓  ${stats.tasks.upserted} tasks upserted, ${stats.tasks.errors} errors`)
}

// ── 4. Task-Topic links ───────────────────────────────────────────────────────

async function importTaskTopics() {
  const allRows = readJsonl('catalog_task_topics.jsonl')
  console.log(`\n📂  Task-Topic links: всего в файле ${allRows.length}`)

  const { data: tasks }  = await supabase.from('catalog_tasks').select('id, external_id')
    .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
  const { data: topics } = await supabase.from('catalog_topics').select('id, external_id')
    .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)

  const taskMap  = Object.fromEntries((tasks  ?? []).map(t => [String(t.external_id), t.id]))
  const topicMap = Object.fromEntries((topics ?? []).map(t => [String(t.external_id), t.id]))

  const records = []
  for (const r of allRows) {
    const taskUuid  = taskMap[String(r.task_external_id)]
    const topicUuid = topicMap[String(r.topic_external_id)]
    if (!taskUuid)  continue   // task not in sample — silently skip
    if (!topicUuid) { logError('task_topics', `topic ext=${r.topic_external_id} not found`); stats.taskTopics.errors++; continue }
    records.push({ task_id: taskUuid, topic_id: topicUuid, is_primary: r.is_primary ?? false })
  }

  if (records.length) {
    const { error } = await supabase
      .from('catalog_task_topics')
      .upsert(records, { onConflict: 'task_id,topic_id', ignoreDuplicates: true })
    if (error) { logError('task_topics_upsert', error.message); stats.taskTopics.errors++ }
    else stats.taskTopics.upserted = records.length
  }

  console.log(`  ✓  ${stats.taskTopics.upserted} links upserted`)
}

// ── 5. Assets ─────────────────────────────────────────────────────────────────

async function importAssets() {
  const allRows = readJsonl('catalog_task_assets.jsonl')
  console.log(`\n📂  Assets: всего в файле ${allRows.length}`)

  const { data: tasks } = await supabase.from('catalog_tasks').select('id, external_id')
    .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
  const taskMap = Object.fromEntries((tasks ?? []).map(t => [String(t.external_id), t.id]))

  // Only assets for tasks actually imported
  const rows = allRows.filter(r => taskMap[String(r.task_external_id)])
  console.log(`  →  ${rows.length} assets для загруженных задач`)

  // Fetch already-stored paths to skip re-upload
  const { data: existingAssets } = await supabase
    .from('catalog_task_assets')
    .select('storage_path')
    .in('task_id', Object.values(taskMap))
  const existingPaths = new Set((existingAssets ?? []).map(a => a.storage_path))

  const assetRecords = []

  for (const r of rows) {
    const taskUuid    = taskMap[String(r.task_external_id)]
    const storagePath = localPathToStoragePath(r.local_path)

    if (existingPaths.has(storagePath)) {
      stats.assets.skipped++
      continue
    }

    const localFile = localPathToFile(r.local_path)
    if (!existsSync(localFile)) {
      logError('assets_file', `file not found: ${r.local_path} → ${localFile}`)
      stats.assets.errors++
      continue
    }

    const fileBuffer = readFileSync(localFile)
    const contentType = r.local_path.endsWith('.svg') ? 'image/svg+xml'
      : r.local_path.endsWith('.png') ? 'image/png'
      : 'image/jpeg'

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, { contentType, upsert: false })

    if (upErr) {
      if (upErr.message?.includes('already exists') || upErr.statusCode === '409') {
        stats.assets.skipped++
      } else {
        logError('assets_upload', `${r.local_path}: ${upErr.message}`)
        stats.assets.errors++
        continue
      }
    } else {
      stats.assets.uploaded++
    }

    assetRecords.push({
      task_id:        taskUuid,
      tex_session_id: r.tex_session_id ?? null,
      kind:           r.kind,
      storage_path:   storagePath,
      alt:            r.alt ?? null,
      position:       r.position ?? 0,
    })
  }

  // Upsert asset metadata in batches of 200
  const BATCH = 200
  for (let i = 0; i < assetRecords.length; i += BATCH) {
    const batch = assetRecords.slice(i, i + BATCH)
    const { error } = await supabase
      .from('catalog_task_assets')
      .upsert(batch, { onConflict: 'task_id,storage_path', ignoreDuplicates: false })
    if (error) logError('assets_upsert', error.message)
  }

  console.log(`  ✓  ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  Импорт Математика ОГЭ (sample)')
  console.log(`    SUBJECT=${SUBJECT}  EXAM_TYPE=${EXAM_TYPE}  MAX_TASKS=${MAX_TASKS}`)
  console.log(`    SAMPLE_DIR=${SAMPLE_DIR}`)

  await authenticate()
  await importSections()
  await importTopics()
  await importTasks()
  await importTaskTopics()
  await importAssets()

  console.log('\n══════════════════════════════════════')
  console.log('📊  Итог:')
  console.log(`    Sections:   ${stats.sections.upserted} upserted, ${stats.sections.errors} errors`)
  console.log(`    Topics:     ${stats.topics.upserted} upserted,   ${stats.topics.errors} errors`)
  console.log(`    Tasks:      ${stats.tasks.upserted} upserted,   ${stats.tasks.errors} errors`)
  console.log(`    Task-Topic: ${stats.taskTopics.upserted} links,    ${stats.taskTopics.errors} errors`)
  console.log(`    Assets:     ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)

  if (errors.length) {
    console.log(`\n⚠️   ${errors.length} ошибок:`)
    errors.forEach(e => console.error(`  [${e.stage}] ${JSON.stringify(e.detail).slice(0, 200)}`))
    process.exit(1)
  } else {
    console.log('\n✅  Импорт завершён успешно')
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
