/**
 * Sample-импорт каталога «Физика ОГЭ»
 * 1 раздел · 9 тем · 30 задач · 33 связи · 175 assets (161 SVG + 14 PNG)
 *
 * По умолчанию — DRY-RUN (только отчёт, без записи в БД и Storage).
 * Боевой запуск: передай флаг --confirm-sample-import
 *
 * Использование:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/import-physics-oge-catalog-sample.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/import-physics-oge-catalog-sample.mjs --confirm-sample-import
 *
 * Повторный запуск безопасен (upsert по subject+exam_type+external_id).
 * Не изменяет Математику ЕГЭ/ОГЭ, Физику ЕГЭ, catalog_task_progress.
 * Секреты не выводятся в консоль.
 *
 * Storage prefix: physics-oge/
 * Path format:    physics-oge/{tex_session_id}/{encoded_filename}
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

// ── Константы ─────────────────────────────────────────────────────────────────

const SUPABASE_URL    = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUBJECT         = 'Физика'
const EXAM_TYPE       = 'ОГЭ'
const MAX_TASKS       = 30   // hard limit — sample only
const BUCKET          = 'catalog-assets'
const STORAGE_PREFIX  = 'physics-oge'

const SAMPLE_DIR      = 'D:/школково спарсенные файлы/shkolkovo_oge_physics_catalog/outputs/normalized_catalog/sample'
const CATALOG_DIR     = resolve(SAMPLE_DIR, '..')  // normalized_catalog/
// local_path in JSONL is relative to CATALOG_DIR, e.g. ../shkolkovo_oge_physics_images/68104/file.png
const LOCAL_PATH_PREFIX = '../shkolkovo_oge_physics_images/'

// ── CLI flags ─────────────────────────────────────────────────────────────────

const DRY_RUN   = !process.argv.includes('--confirm-sample-import')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) {
  console.error('❌  Укажи SUPABASE_SERVICE_ROLE_KEY (из .env.import.local)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

// ── Утилиты ───────────────────────────────────────────────────────────────────

function readJsonl(filename) {
  const path = join(SAMPLE_DIR, filename)
  if (!existsSync(path)) { console.error(`❌  Файл не найден: ${path}`); process.exit(1) }
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

/**
 * Converts local_path to Storage path under physics-oge/.
 * local_path: ../shkolkovo_oge_physics_images/{session}/{filename}
 * result:     physics-oge/{encoded_session}/{encoded_filename}
 *
 * Each segment encoded with encodeURIComponent (spaces, special chars → %-seq).
 * Frontend safeDecodeStoragePath decodes before getPublicUrl → no double-encoding.
 */
function localPathToStoragePath(localPath) {
  const relative = localPath.startsWith(LOCAL_PATH_PREFIX)
    ? localPath.slice(LOCAL_PATH_PREFIX.length)
    : localPath
  const segments = relative.split('/')
  const encoded  = segments.map(s => encodeURIComponent(s)).join('/')
  return `${STORAGE_PREFIX}/${encoded}`
}

/** Resolves local_path to an absolute filesystem path. */
function localPathToFile(localPath) {
  return resolve(CATALOG_DIR, localPath)
}

function mime(filename) {
  if (filename.endsWith('.svg')) return 'image/svg+xml'
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

const stats = {
  sections:   { upserted: 0, skipped: 0, errors: 0 },
  topics:     { upserted: 0, errors: 0 },
  tasks:      { upserted: 0, errors: 0 },
  taskTopics: { upserted: 0, skipped: 0, errors: 0 },
  assets:     { uploaded: 0, skipped: 0, errors: 0 },
}
const errors = []

function logError(stage, detail) {
  errors.push({ stage, detail })
  const msg = typeof detail === 'string' ? detail : JSON.stringify(detail)
  console.error(`  ✗ [${stage}] ${msg.slice(0, 300)}`)
}

// ── 0. Pre-import isolation check ─────────────────────────────────────────────

async function checkIsolation(label) {
  const [{count:mathEge},{count:mathOge},{count:physEge}] = await Promise.all([
    supabase.from('catalog_tasks').select('*',{count:'exact',head:true}).eq('subject','Математика').eq('exam_type','ЕГЭ'),
    supabase.from('catalog_tasks').select('*',{count:'exact',head:true}).eq('subject','Математика').eq('exam_type','ОГЭ'),
    supabase.from('catalog_tasks').select('*',{count:'exact',head:true}).eq('subject','Физика').eq('exam_type','ЕГЭ'),
  ])
  console.log(`\n${label} — изоляция:`)
  console.log(`  Математика ЕГЭ: ${mathEge}  ${mathEge===9515?'✅':'⚠️'}`)
  console.log(`  Математика ОГЭ: ${mathOge}  ${mathOge===5972?'✅':'⚠️'}`)
  console.log(`  Физика ЕГЭ:     ${physEge}  ${physEge===3386?'✅':'⚠️'}`)
  return { mathEge, mathOge, physEge }
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

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Будет upserted: ${records.length} sections`)
    records.forEach(r => console.log(`    • ext=${r.external_id} "${r.title}"`))
    stats.sections.upserted = records.length
    return
  }

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

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Будет upserted: ${records.length} topics`)
    rows.forEach(r => console.log(`    • ext=${r.external_id} parent=${r.parent_external_id ?? '—'} "${r.title.slice(0,45)}"`))
    stats.topics.upserted = records.length
    return
  }

  // Pass 1 — upsert without parent_id
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
  const rows    = allRows.slice(0, MAX_TASKS)
  console.log(`\n📂  Tasks: ${rows.length} (лимит ${MAX_TASKS}, в файле: ${allRows.length})`)

  if (DRY_RUN) {
    const noAnswer   = rows.filter(r => !r.has_answer)
    const noSolution = rows.filter(r => !r.has_solution)
    console.log(`  [DRY-RUN] Будет upserted: ${rows.length} tasks`)
    console.log(`    • has_answer=false: ${noAnswer.length} (ext: ${noAnswer.map(r=>r.external_id).join(', ')})`)
    console.log(`    • has_solution=false: ${noSolution.length}`)
    stats.tasks.upserted = rows.length
    return
  }

  const { data: sections } = await supabase
    .from('catalog_sections')
    .select('id, external_id')
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)
  const secMap = Object.fromEntries((sections ?? []).map(s => [String(s.external_id), s.id]))

  for (const r of rows) {
    const extId      = String(r.external_id)
    const sectionUuid = secMap[String(r.primary_section_external_id)]
    if (!sectionUuid) {
      logError('tasks_section', `section ${r.primary_section_external_id} not found for task ${extId}`)
      stats.tasks.errors++
      continue
    }

    const hasAnswer   = r.has_answer === true
    const hasSolution = r.has_solution === true

    const record = {
      external_id:         extId,
      subject:             SUBJECT,
      exam_type:           EXAM_TYPE,
      section_id:          sectionUuid,
      statement_html:      r.statement_html       ?? '',
      answer_html:         hasAnswer   ? (r.answer_html   ?? null) : null,
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
  console.log(`\n📂  Task-Topic links: ${allRows.length} в файле`)

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Будет upserted: ${allRows.length} links`)
    stats.taskTopics.upserted = allRows.length
    return
  }

  const [{ data: tasks }, { data: topics }] = await Promise.all([
    supabase.from('catalog_tasks').select('id,external_id').eq('subject',SUBJECT).eq('exam_type',EXAM_TYPE),
    supabase.from('catalog_topics').select('id,external_id').eq('subject',SUBJECT).eq('exam_type',EXAM_TYPE),
  ])

  const taskMap  = Object.fromEntries((tasks  ?? []).map(t => [String(t.external_id), t.id]))
  const topicMap = Object.fromEntries((topics ?? []).map(t => [String(t.external_id), t.id]))

  const records = []
  for (const r of allRows) {
    const taskUuid  = taskMap[String(r.task_external_id)]
    const topicUuid = topicMap[String(r.topic_external_id)]
    if (!taskUuid)  { stats.taskTopics.skipped++; continue }
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

  console.log(`  ✓  ${stats.taskTopics.upserted} links upserted, ${stats.taskTopics.skipped} skipped`)
}

// ── 5. Assets ─────────────────────────────────────────────────────────────────

async function importAssets() {
  const allRows = readJsonl('catalog_task_assets.jsonl')
  console.log(`\n📂  Assets: ${allRows.length} в файле`)

  if (DRY_RUN) {
    const svgs = allRows.filter(r => r.local_path.endsWith('.svg'))
    const pngs = allRows.filter(r => r.local_path.endsWith('.png'))
    const missing = allRows.filter(r => !existsSync(localPathToFile(r.local_path)))
    const samplePaths = allRows.slice(0,3).map(r => localPathToStoragePath(r.local_path))
    console.log(`  [DRY-RUN] SVG: ${svgs.length}, PNG: ${pngs.length}, missing: ${missing.length}`)
    console.log(`  Примеры Storage-путей:`)
    samplePaths.forEach(p => console.log(`    ${p}`))
    stats.assets.uploaded = allRows.length
    return
  }

  const { data: tasks } = await supabase
    .from('catalog_tasks').select('id,external_id')
    .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
  const taskMap = Object.fromEntries((tasks ?? []).map(t => [String(t.external_id), t.id]))

  const rows = allRows.filter(r => taskMap[String(r.task_external_id)])
  console.log(`  →  ${rows.length} assets для загруженных задач`)

  // Fetch existing paths (in chunks of 50 to avoid URL limit)
  const taskUuids = Object.values(taskMap)
  const existingPaths = new Set()
  for (let i = 0; i < taskUuids.length; i += 50) {
    const chunk = taskUuids.slice(i, i + 50)
    const { data: ea } = await supabase
      .from('catalog_task_assets').select('storage_path').in('task_id', chunk)
    ;(ea ?? []).forEach(a => existingPaths.add(a.storage_path))
  }

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
      logError('assets_file', `file not found: ${r.local_path}`)
      stats.assets.errors++
      continue
    }

    const content     = readFileSync(localFile)
    const contentType = mime(r.local_path)

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, content, { contentType, upsert: false })

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
      kind:           r.kind ?? 'condition',
      storage_path:   storagePath,
      alt:            r.alt        ?? null,
      size_bytes:     r.size_bytes ?? null,
      position:       r.position   ?? 0,
    })
  }

  // Upsert asset metadata in batches of 100
  const BATCH = 100
  for (let i = 0; i < assetRecords.length; i += BATCH) {
    const { error } = await supabase
      .from('catalog_task_assets')
      .upsert(assetRecords.slice(i, i + BATCH), { onConflict: 'task_id,storage_path', ignoreDuplicates: false })
    if (error) logError('assets_upsert', error.message)
  }

  console.log(`  ✓  ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀  Импорт Физика ОГЭ (sample)')
  console.log(`    SUBJECT=${SUBJECT}  EXAM_TYPE=${EXAM_TYPE}  MAX_TASKS=${MAX_TASKS}`)
  console.log(`    SAMPLE_DIR=${SAMPLE_DIR}`)
  console.log(`    Service key: [задан, не показываем]`)
  console.log(`    DRY_RUN=${DRY_RUN}`)
  if (DRY_RUN) {
    console.log('\n⚠️   DRY-RUN режим: база данных и Storage не изменяются.')
    console.log('    Для боевого запуска передай: --confirm-sample-import\n')
  }

  const before = await checkIsolation('До импорта')

  await importSections()
  await importTopics()
  await importTasks()
  await importTaskTopics()
  await importAssets()

  if (!DRY_RUN) {
    await checkIsolation('После импорта')
  }

  console.log('\n══════════════════════════════════════════')
  console.log(`📊  Итог ${DRY_RUN ? '[DRY-RUN]' : ''}:`)
  console.log(`    Sections:   ${stats.sections.upserted} upserted, ${stats.sections.errors} errors`)
  console.log(`    Topics:     ${stats.topics.upserted} upserted, ${stats.topics.errors} errors`)
  console.log(`    Tasks:      ${stats.tasks.upserted} upserted, ${stats.tasks.errors} errors`)
  console.log(`    Task-Topic: ${stats.taskTopics.upserted} links, ${stats.taskTopics.skipped} skipped, ${stats.taskTopics.errors} errors`)
  console.log(`    Assets:     ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)

  if (errors.length) {
    const { writeFileSync } = await import('fs')
    const errLog = `physics-oge-errors-${Date.now()}.json`
    writeFileSync(errLog, JSON.stringify(errors, null, 2))
    console.log(`\n⚠️   ${errors.length} ошибок записано в ${errLog}`)
    process.exit(1)
  } else if (DRY_RUN) {
    console.log('\n✅  DRY-RUN завершён. Данные не изменены.')
  } else {
    console.log('\n✅  Импорт завершён успешно.')
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
