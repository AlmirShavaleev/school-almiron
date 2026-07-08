/**
 * Импорт ТОЛЬКО sample-каталога физики (1 раздел, 10 тем, 30 задач, 142 assets).
 * Для полного импорта физики использовать отдельный скрипт (не создан).
 *
 * Безопасность:
 *   SUPABASE_SERVICE_KEY=<key> node scripts/import-physics-catalog-sample.mjs
 *   Или: IMPORT_EMAIL=<e> IMPORT_PASSWORD=<p> node scripts/import-physics-catalog-sample.mjs
 *
 * Секреты загружать только через переменные окружения. Никогда не хардкодить.
 * Повторный запуск безопасен — upsert по (subject, exam_type, external_id).
 *
 * Специальные правила при полном импорте (не sample):
 *   - external_id 130471 → has_solution = false
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ── Константы ─────────────────────────────────────────────────────────────────

const SUPABASE_URL  = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'

const SUBJECT    = 'Физика'
const EXAM_TYPE  = 'ЕГЭ'
const MAX_TASKS  = 30   // hard limit — cannot import full catalog

const SAMPLE_DIR = 'D:/школково спарсенные файлы/shkolkovo_physics_catalog/outputs/normalized_catalog/sample'
const IMAGES_DIR = 'D:/школково спарсенные файлы/shkolkovo_physics_catalog/outputs/shkolkovo_physics_images'
const BUCKET     = 'catalog-assets'
const STORAGE_PREFIX = 'physics-ege'

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
 * Кодирует путь для Storage: каждый сегмент через encodeURIComponent.
 * Пробелы, скобки, апострофы и кириллица становятся %-sequences.
 */
function encodeStoragePath(prefix, localPath) {
  const segments = localPath.split('/')
  const encoded  = segments.map(s => encodeURIComponent(s)).join('/')
  return `${prefix}/${encoded}`
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

// ── 2. Topics ──────────────────────────────────────────────────────────────────

async function importTopics() {
  const rows = readJsonl('catalog_topics.jsonl')
  console.log(`\n📂  Topics: ${rows.length} записей`)

  // Первый проход — upsert без parent_id
  const records = rows.map(r => ({
    external_id:  r.external_id,
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

  // Получаем external_id → uuid для физики
  const { data: allTopics, error: e2 } = await supabase
    .from('catalog_topics')
    .select('id, external_id')
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)

  if (e2) { logError('topics_fetch', e2.message); return }

  const extToUuid = Object.fromEntries(allTopics.map(t => [t.external_id, t.id]))

  // Второй проход — проставляем parent_id
  const withParent = rows.filter(r => r.parent_external_id != null)
  for (const r of withParent) {
    const parentUuid = extToUuid[r.parent_external_id]
    if (!parentUuid) { logError('topics_parent', `parent_external_id ${r.parent_external_id} not found`); continue }
    const { error: e3 } = await supabase
      .from('catalog_topics')
      .update({ parent_id: parentUuid })
      .eq('external_id', r.external_id)
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
  console.log(`\n📂  Tasks: ${rows.length} записей (лимит ${MAX_TASKS}, всего в файле: ${allRows.length})`)

  const { data: sections } = await supabase
    .from('catalog_sections')
    .select('id, external_id')
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)
  const secMap = Object.fromEntries((sections ?? []).map(s => [s.external_id, s.id]))

  for (const r of rows) {
    const sectionUuid = secMap[r.primary_section_external_id]
    if (!sectionUuid) {
      logError('tasks_section', `section ${r.primary_section_external_id} not found`)
      stats.tasks.errors++
      continue
    }

    const record = {
      external_id:          r.external_id,
      subject:              SUBJECT,
      exam_type:            EXAM_TYPE,
      section_id:           sectionUuid,
      statement_html:       r.statement_html,
      answer_html:          r.answer_html          ?? null,
      solution_html:        r.solution_html        ?? null,
      solution_plan_html:   r.solution_plan_html   ?? null,
      grade_criteria_html:  r.grade_criteria_html  ?? null,
      source_url:           r.source_url           ?? null,
      position:             r.position             ?? 0,
      has_answer:           r.has_answer   === true,
      has_solution:         r.has_solution === true,
      is_published:         r.is_published !== false,
    }

    const { error } = await supabase
      .from('catalog_tasks')
      .upsert(record, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false })

    if (error) { logError('tasks', `ext=${r.external_id}: ${error.message}`); stats.tasks.errors++ }
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

  const taskMap  = Object.fromEntries((tasks  ?? []).map(t => [t.external_id, t.id]))
  const topicMap = Object.fromEntries((topics ?? []).map(t => [t.external_id, t.id]))

  const records = []
  for (const r of allRows) {
    const taskUuid  = taskMap[r.task_external_id]
    const topicUuid = topicMap[r.topic_external_id]
    if (!taskUuid || !topicUuid) {
      // Skip links for tasks not in sample (limited to MAX_TASKS)
      if (!taskUuid) continue
      logError('task_topics', `topic ext=${r.topic_external_id} not found`)
      stats.taskTopics.errors++
      continue
    }
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
  const taskMap = Object.fromEntries((tasks ?? []).map(t => [t.external_id, t.id]))

  // Только assets для задач из sample
  const rows = allRows.filter(r => taskMap[r.task_external_id])
  console.log(`  →  ${rows.length} assets для загруженных задач`)

  const { data: existingAssets } = await supabase
    .from('catalog_task_assets')
    .select('storage_path')
    .in('task_id', Object.values(taskMap))
  const existingPaths = new Set((existingAssets ?? []).map(a => a.storage_path))

  const assetRecords = []

  for (const r of rows) {
    const taskUuid = taskMap[r.task_external_id]
    // Encode storage path to handle spaces, brackets, Cyrillic
    const storagePath = encodeStoragePath(STORAGE_PREFIX, r.local_path)

    if (existingPaths.has(storagePath)) {
      stats.assets.skipped++
      continue
    }

    const localFile = join(IMAGES_DIR, r.local_path)
    if (!existsSync(localFile)) {
      logError('assets_file', `file not found: ${r.local_path}`)
      stats.assets.errors++
      continue
    }

    const fileBuffer = readFileSync(localFile)
    const contentType = r.local_path.endsWith('.svg') ? 'image/svg+xml'
      : r.local_path.endsWith('.png') ? 'image/png'
      : 'image/jpeg'

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert:       true,
        cacheControl: '31536000',
      })

    if (uploadError && !uploadError.message.includes('already exists')) {
      logError('assets_upload', `${r.local_path}: ${uploadError.message}`)
      stats.assets.errors++
      continue
    }

    stats.assets.uploaded++
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
  }

  // Batch insert
  const CHUNK = 200
  for (let i = 0; i < assetRecords.length; i += CHUNK) {
    const { error } = await supabase
      .from('catalog_task_assets')
      .insert(assetRecords.slice(i, i + CHUNK))
    if (error) logError('assets_insert', error.message)
  }

  console.log(`  ✓  ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  Импорт sample-каталога ФИЗИКИ ЕГЭ\n')
  console.log(`   Supabase: ${SUPABASE_URL}`)
  console.log(`   Sample:   ${SAMPLE_DIR}`)
  console.log(`   Images:   ${IMAGES_DIR}`)
  console.log(`   Предмет:  ${SUBJECT} / ${EXAM_TYPE}`)
  console.log(`   Лимит задач: ${MAX_TASKS} (только sample)`)

  await authenticate()

  await importSections()
  await importTopics()
  await importTasks()
  await importTaskTopics()
  await importAssets()

  console.log('\n═══════════════════════════════════════')
  console.log('  Итог импорта')
  console.log('═══════════════════════════════════════')
  console.log(`  Sections:   ${stats.sections.upserted} upserted, ${stats.sections.errors} errors`)
  console.log(`  Topics:     ${stats.topics.upserted} upserted, ${stats.topics.errors} errors`)
  console.log(`  Tasks:      ${stats.tasks.upserted} upserted, ${stats.tasks.errors} errors`)
  console.log(`  TaskTopics: ${stats.taskTopics.upserted} upserted, ${stats.taskTopics.errors} errors`)
  console.log(`  Assets:     ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)

  if (errors.length) {
    const { writeFileSync } = await import('fs')
    const errLog = `import-physics-errors-${Date.now()}.json`
    writeFileSync(errLog, JSON.stringify(errors, null, 2))
    console.log(`\n⚠️   ${errors.length} ошибок записано в ${errLog}`)
  } else {
    console.log('\n✅  Ошибок нет')
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
