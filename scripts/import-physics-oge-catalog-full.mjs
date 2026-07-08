/**
 * Полный импорт каталога «Физика ОГЭ»
 * 22 разделов · 334 темы · 2910 задач · 5053 связи · 18532 assets
 *
 * DRY-RUN по умолчанию. Боевой запуск требует ОДНОВРЕМЕННО:
 *   - переменная: CATALOG_PHYSICS_OGE_FULL_IMPORT_CONFIRMED=yes
 *   - флаг: --confirm-full-import
 *
 * Использование:
 *   node scripts/import-physics-oge-catalog-full.mjs
 *   node scripts/import-physics-oge-catalog-full.mjs --dry-run
 *   CATALOG_PHYSICS_OGE_FULL_IMPORT_CONFIRMED=yes node ... --confirm-full-import
 *   CATALOG_PHYSICS_OGE_FULL_IMPORT_CONFIRMED=yes node ... --confirm-full-import --resume
 *   CATALOG_PHYSICS_OGE_FULL_IMPORT_CONFIRMED=yes node ... --confirm-full-import --limit=10
 *
 * Checkpoint: scripts/.checkpoints/physics-oge-full-checkpoint.json
 * Log: physics-oge-full-import-<timestamp>.log
 *
 * Не затрагивает math-ege / math-oge / physics-ege.
 * Секреты не выводятся в консоль.
 * task 21833 → has_solution=false принудительно.
 */

import { createClient }       from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs'
import { join, resolve }      from 'path'

// ── Константы ─────────────────────────────────────────────────────────────────

const SUPABASE_URL        = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUBJECT             = 'Физика'
const EXAM_TYPE           = 'ОГЭ'
const BUCKET              = 'catalog-assets'
const STORAGE_PREFIX      = 'physics-oge'

const CATALOG_DIR         = 'D:/школково спарсенные файлы/shkolkovo_oge_physics_catalog/outputs/normalized_catalog'
const LOCAL_PATH_PREFIX   = '../shkolkovo_oge_physics_images/'
const CHECKPOINT_PATH     = join('scripts', '.checkpoints', 'physics-oge-full-checkpoint.json')

const CHECKPOINT_INTERVAL = 200   // save every N assets
const UPLOAD_CONCURRENCY  = 5
const MAX_RETRIES         = 5

// Tasks that must have has_solution=false regardless of source data
const NO_SOLUTION_IDS = new Set(['21833'])

// Expected counts for validation
const EXPECTED = { sections: 22, topics: 334, tasks: 2910, taskTopics: 5053, assets: 18532 }

// ── CLI ───────────────────────────────────────────────────────────────────────

const ARGS            = process.argv.slice(2)
const FLAG_DRY        = ARGS.includes('--dry-run') || !ARGS.includes('--confirm-full-import')
const FLAG_RESUME     = ARGS.includes('--resume')
const FLAG_FULL       = ARGS.includes('--confirm-full-import')
const limitArg        = ARGS.find(a => a.startsWith('--limit='))
const TASK_LIMIT      = limitArg ? parseInt(limitArg.split('=')[1], 10) : null

const ENV_CONFIRMED   = process.env.CATALOG_PHYSICS_OGE_FULL_IMPORT_CONFIRMED === 'yes'
const serviceKey      = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) {
  console.error('❌  Укажи SUPABASE_SERVICE_ROLE_KEY (из .env.import.local)')
  process.exit(1)
}

const LIVE = FLAG_FULL && ENV_CONFIRMED
if (!LIVE && FLAG_FULL) {
  console.error('❌  Флаг --confirm-full-import требует переменной CATALOG_PHYSICS_OGE_FULL_IMPORT_CONFIRMED=yes')
  process.exit(1)
}
const DRY_RUN = !LIVE

// ── Supabase ──────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

// ── Logging ───────────────────────────────────────────────────────────────────

const LOG_FILE    = `physics-oge-full-import-${Date.now()}.log`
const logStream   = DRY_RUN ? null : createWriteStream(LOG_FILE, { flags: 'a' })

function log(...args) {
  const msg = args.join(' ')
  console.log(msg)
  logStream?.write(msg + '\n')
}
function logErr(...args) {
  const msg = args.join(' ')
  console.error(msg)
  logStream?.write('[ERR] ' + msg + '\n')
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

let checkpoint = {
  sectionsUpserted:   false,
  topicsUpserted:     false,
  importedTaskIds:    [],   // external_ids confirmed in DB
  linksUpserted:      false,
  uploadedPaths:      [],   // storage_paths confirmed uploaded
  assetsMetaUpserted: [],   // storage_paths confirmed in catalog_task_assets
  errors:             [],
}

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_PATH)) return
  try {
    const raw = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'))
    checkpoint = { ...checkpoint, ...raw }
    log(`📂  Checkpoint loaded: ${checkpoint.importedTaskIds.length} tasks, ${checkpoint.uploadedPaths.length} uploads, ${checkpoint.assetsMetaUpserted.length} meta`)
  } catch (e) {
    logErr(`⚠️  Checkpoint parse error: ${e.message} — starting fresh`)
  }
}

function saveCheckpoint() {
  try {
    mkdirSync(resolve(CHECKPOINT_PATH, '..'), { recursive: true })
    writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2))
  } catch (e) {
    logErr(`⚠️  Checkpoint save error: ${e.message}`)
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function readJsonl(filename) {
  const path = join(CATALOG_DIR, filename)
  if (!existsSync(path)) { logErr(`❌  Файл не найден: ${path}`); process.exit(1) }
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}

function localPathToStoragePath(localPath) {
  const relative = localPath.startsWith(LOCAL_PATH_PREFIX)
    ? localPath.slice(LOCAL_PATH_PREFIX.length)
    : localPath
  const segments = relative.split('/')
  const encoded  = segments.map(s => encodeURIComponent(s)).join('/')
  return `${STORAGE_PREFIX}/${encoded}`
}

function localPathToFile(localPath) {
  return resolve(CATALOG_DIR, localPath)
}

function mime(filename) {
  if (filename.endsWith('.svg')) return 'image/svg+xml'
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/octet-stream'
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function withRetry(fn, label, maxRetries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()
      if (result?.error) {
        const msg = result.error.message ?? ''
        const status = result.error.statusCode ?? result.error.status ?? 0
        const retryable = [429, 502, 503, 504].includes(Number(status))
                       || msg.includes('429') || msg.includes('502') || msg.includes('503')
                       || msg.includes('504') || msg.includes('timeout') || msg.includes('network')
        if (retryable && attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 16000)
          logErr(`  ⚠️  [${label}] retry ${attempt}/${maxRetries} after ${delay}ms: ${msg}`)
          await sleep(delay)
          continue
        }
      }
      return result
    } catch (e) {
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 16000)
        logErr(`  ⚠️  [${label}] catch retry ${attempt}/${maxRetries} after ${delay}ms: ${e.message}`)
        await sleep(delay)
      } else {
        return { error: { message: e.message } }
      }
    }
  }
}

const stats = {
  sections:   { upserted: 0, errors: 0 },
  topics:     { upserted: 0, errors: 0 },
  tasks:      { upserted: 0, errors: 0 },
  taskTopics: { upserted: 0, skipped: 0, errors: 0 },
  assets:     { uploaded: 0, skipped: 0, errors: 0 },
  meta:       { upserted: 0, errors: 0 },
}
const errors = []

function recordError(stage, detail) {
  const msg = typeof detail === 'string' ? detail : JSON.stringify(detail)
  errors.push({ stage, detail: msg })
  checkpoint.errors.push({ stage, detail: msg.slice(0, 300), ts: new Date().toISOString() })
  logErr(`  ✗ [${stage}] ${msg.slice(0, 300)}`)
}

// ── 0. Pre-import validation ──────────────────────────────────────────────────

async function validateData() {
  log('\n🔍  Предварительная проверка данных...')
  let ok = true

  const sections   = readJsonl('catalog_sections.jsonl')
  const topics     = readJsonl('catalog_topics.jsonl')
  const tasks      = readJsonl('catalog_tasks.jsonl')
  const taskTopics = readJsonl('catalog_task_topics.jsonl')
  const assets     = readJsonl('catalog_task_assets.jsonl')

  // Count checks
  const counts = { sections: sections.length, topics: topics.length, tasks: tasks.length, taskTopics: taskTopics.length, assets: assets.length }
  for (const [k, v] of Object.entries(EXPECTED)) {
    const actual = counts[k]
    const pass = actual === v
    if (!pass) ok = false
    log(`  ${pass?'✅':'❌'}  ${k}: ${actual} ${pass?'':'(expect '+v+')'}`)
  }

  // Unique task external_ids
  const taskExtIds = new Set(tasks.map(t => String(t.external_id)))
  const dupes = tasks.length - taskExtIds.size
  log(`  ${dupes===0?'✅':'❌'}  task external_id dupes: ${dupes}`)
  if (dupes > 0) ok = false

  // Empty statement_html
  const emptyStmt = tasks.filter(t => !t.statement_html?.trim())
  log(`  ${emptyStmt.length===0?'✅':'❌'}  empty statement_html: ${emptyStmt.length}`)

  // Section refs in tasks
  const sectionExtIds = new Set(sections.map(s => String(s.external_id)))
  const badSections = tasks.filter(t => !sectionExtIds.has(String(t.primary_section_external_id)))
  log(`  ${badSections.length===0?'✅':'❌'}  tasks with invalid section ref: ${badSections.length}`)

  // Topic refs
  const topicExtIds = new Set(topics.map(t => String(t.external_id)))
  const badTopics = taskTopics.filter(r => !topicExtIds.has(String(r.topic_external_id)))
  log(`  ${badTopics.length===0?'✅':'⚠️'}  task_topic links with unknown topic: ${badTopics.length}`)

  // Asset refs
  const badAssets = assets.filter(a => !taskExtIds.has(String(a.task_external_id)))
  log(`  ${badAssets.length===0?'✅':'❌'}  assets with unknown task: ${badAssets.length}`)

  // Missing files
  let missingFiles = 0
  for (const a of assets.slice(0, 200)) {
    if (!existsSync(localPathToFile(a.local_path))) missingFiles++
  }
  log(`  ${missingFiles===0?'✅':'❌'}  missing files (spot check first 200): ${missingFiles}`)

  // has_solution override check
  const noSol = tasks.filter(t => !t.has_solution)
  log(`  ✅  has_solution=false: ${noSol.length} tasks (${noSol.map(t=>t.external_id).join(',')})`)

  // Unique local_paths for assets
  const uniquePaths = new Set(assets.map(a => a.local_path))
  log(`  ✅  unique local_paths: ${uniquePaths.size} (assets: ${assets.length}, diff=${assets.length-uniquePaths.size} shared files)`)

  log(`\n  Результат: ${ok ? '✅  Всё готово к импорту' : '❌  Обнаружены проблемы, импорт прерван'}`)
  return ok
}

async function checkIsolation(label) {
  const [{ count: mathEge }, { count: mathOge }, { count: physEge }] = await Promise.all([
    supabase.from('catalog_tasks').select('*', { count: 'exact', head: true }).eq('subject', 'Математика').eq('exam_type', 'ЕГЭ'),
    supabase.from('catalog_tasks').select('*', { count: 'exact', head: true }).eq('subject', 'Математика').eq('exam_type', 'ОГЭ'),
    supabase.from('catalog_tasks').select('*', { count: 'exact', head: true }).eq('subject', 'Физика').eq('exam_type', 'ЕГЭ'),
  ])
  log(`\n${label} — изоляция:`)
  log(`  Математика ЕГЭ: ${mathEge}  ${mathEge === 9515 ? '✅' : '⚠️ expect 9515'}`)
  log(`  Математика ОГЭ: ${mathOge}  ${mathOge === 5972 ? '✅' : '⚠️ expect 5972'}`)
  log(`  Физика ЕГЭ:     ${physEge}  ${physEge === 3386 ? '✅' : '⚠️ expect 3386'}`)
  return { mathEge, mathOge, physEge }
}

// ── 1. Sections ───────────────────────────────────────────────────────────────

async function importSections() {
  if (checkpoint.sectionsUpserted && FLAG_RESUME) {
    log('\n📂  Sections: пропущено (checkpoint)')
    return
  }

  const rows = readJsonl('catalog_sections.jsonl')
  log(`\n📂  Sections: ${rows.length} записей`)

  if (DRY_RUN) {
    log(`  [DRY-RUN] ${rows.length} sections`)
    stats.sections.upserted = rows.length
    return
  }

  const records = rows.map(r => ({
    external_id:  String(r.external_id),
    subject:      r.subject   ?? SUBJECT,
    exam_type:    r.exam_type ?? EXAM_TYPE,
    exam_number:  r.exam_number ?? null,
    title:        r.title,
    position:     r.position ?? 0,
    is_published: true,
  }))

  const result = await withRetry(
    () => supabase.from('catalog_sections').upsert(records, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false }),
    'sections'
  )
  if (result?.error) { recordError('sections', result.error.message); stats.sections.errors++ }
  else {
    stats.sections.upserted = records.length
    checkpoint.sectionsUpserted = true
    saveCheckpoint()
    log(`  ✓  ${records.length} sections upserted`)
  }
}

// ── 2. Topics ─────────────────────────────────────────────────────────────────

async function importTopics() {
  if (checkpoint.topicsUpserted && FLAG_RESUME) {
    log('\n📂  Topics: пропущено (checkpoint)')
    return
  }

  const rows = readJsonl('catalog_topics.jsonl')
  log(`\n📂  Topics: ${rows.length} записей`)

  if (DRY_RUN) {
    log(`  [DRY-RUN] ${rows.length} topics`)
    stats.topics.upserted = rows.length
    return
  }

  // Pass 1 — upsert without parent_id (in chunks of 500)
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map(r => ({
      external_id:  String(r.external_id),
      subject:      SUBJECT,
      exam_type:    EXAM_TYPE,
      title:        r.title,
      slug:         r.slug ?? null,
      position:     r.position ?? 0,
      is_published: true,
      parent_id:    null,
    }))
    const result = await withRetry(
      () => supabase.from('catalog_topics').upsert(chunk, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false }),
      `topics_pass1_chunk${i}`
    )
    if (result?.error) { recordError('topics_pass1', result.error.message); stats.topics.errors++; return }
  }

  // Fetch uuid map
  const allTopics = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('catalog_topics').select('id,external_id')
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE).range(from, from + 999)
    allTopics.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) break
  }
  const extToUuid = Object.fromEntries(allTopics.map(t => [String(t.external_id), t.id]))

  // Pass 2 — set parent_id
  const withParent = rows.filter(r => r.parent_external_id != null)
  for (const r of withParent) {
    const parentUuid = extToUuid[String(r.parent_external_id)]
    if (!parentUuid) { recordError('topics_parent', `parent ${r.parent_external_id} not found`); continue }
    const { error } = await supabase.from('catalog_topics')
      .update({ parent_id: parentUuid })
      .eq('external_id', String(r.external_id))
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
    if (error) recordError('topics_parent_update', error.message)
  }

  stats.topics.upserted = rows.length
  checkpoint.topicsUpserted = true
  saveCheckpoint()
  log(`  ✓  ${rows.length} topics upserted, ${withParent.length} parent links resolved`)
}

// ── 3. Tasks ──────────────────────────────────────────────────────────────────

async function importTasks() {
  const allRows = readJsonl('catalog_tasks.jsonl')
  const rows    = TASK_LIMIT != null ? allRows.slice(0, TASK_LIMIT) : allRows
  log(`\n📂  Tasks: ${rows.length}${TASK_LIMIT ? ' (limit '+TASK_LIMIT+')' : ''} (в файле: ${allRows.length})`)

  if (DRY_RUN) {
    log(`  [DRY-RUN] ${rows.length} tasks`)
    stats.tasks.upserted = rows.length
    return
  }

  // Build section map
  const secRows = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('catalog_sections').select('id,external_id')
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE).range(from, from + 999)
    secRows.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) break
  }
  const secMap = Object.fromEntries(secRows.map(s => [String(s.external_id), s.id]))

  // Resume: skip already imported
  const alreadyImported = new Set(checkpoint.importedTaskIds.map(String))
  let newCount = 0

  for (const r of rows) {
    const extId = String(r.external_id)
    if (FLAG_RESUME && alreadyImported.has(extId)) { stats.tasks.upserted++; continue }

    const sectionUuid = secMap[String(r.primary_section_external_id)]
    if (!sectionUuid) {
      recordError('tasks_section', `section ${r.primary_section_external_id} not found for task ${extId}`)
      stats.tasks.errors++
      continue
    }

    const hasAnswer   = r.has_answer === true
    const hasSolution = NO_SOLUTION_IDS.has(extId) ? false : (r.has_solution === true)

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

    const result = await withRetry(
      () => supabase.from('catalog_tasks').upsert(record, { onConflict: 'subject,exam_type,external_id', ignoreDuplicates: false }),
      `task_${extId}`
    )
    if (result?.error) { recordError('tasks', `ext=${extId}: ${result.error.message}`); stats.tasks.errors++ }
    else {
      stats.tasks.upserted++
      newCount++
      checkpoint.importedTaskIds.push(extId)
      if (newCount % 100 === 0) {
        saveCheckpoint()
        log(`  ↳  tasks ${stats.tasks.upserted}/${rows.length}`)
      }
    }
  }

  saveCheckpoint()
  log(`  ✓  ${stats.tasks.upserted} tasks upserted, ${stats.tasks.errors} errors`)
}

// ── 4. Task-Topic links ───────────────────────────────────────────────────────

async function importTaskTopics() {
  if (checkpoint.linksUpserted && FLAG_RESUME) {
    log('\n📂  Task-Topic links: пропущено (checkpoint)')
    return
  }

  const allRows = readJsonl('catalog_task_topics.jsonl')
  log(`\n📂  Task-Topic links: ${allRows.length} в файле`)

  if (DRY_RUN) {
    log(`  [DRY-RUN] ${allRows.length} links`)
    stats.taskTopics.upserted = allRows.length
    return
  }

  // Fetch all tasks and topics for this subject
  const [taskRows, topicRows] = await Promise.all([
    (async () => {
      const all = []
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from('catalog_tasks').select('id,external_id')
          .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE).range(from, from + 999)
        all.push(...(data ?? []))
        if ((data?.length ?? 0) < 1000) break
      }
      return all
    })(),
    (async () => {
      const all = []
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase.from('catalog_topics').select('id,external_id')
          .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE).range(from, from + 999)
        all.push(...(data ?? []))
        if ((data?.length ?? 0) < 1000) break
      }
      return all
    })(),
  ])

  const taskMap  = Object.fromEntries(taskRows.map(t  => [String(t.external_id), t.id]))
  const topicMap = Object.fromEntries(topicRows.map(t => [String(t.external_id), t.id]))

  const records = []
  for (const r of allRows) {
    const taskUuid  = taskMap[String(r.task_external_id)]
    const topicUuid = topicMap[String(r.topic_external_id)]
    if (!taskUuid)  { stats.taskTopics.skipped++; continue }
    if (!topicUuid) { recordError('task_topics', `topic ext=${r.topic_external_id} not found`); stats.taskTopics.errors++; continue }
    records.push({ task_id: taskUuid, topic_id: topicUuid, is_primary: r.is_primary ?? false })
  }

  // Upsert in chunks
  const CHUNK = 500
  for (let i = 0; i < records.length; i += CHUNK) {
    const result = await withRetry(
      () => supabase.from('catalog_task_topics').upsert(records.slice(i, i + CHUNK), { onConflict: 'task_id,topic_id', ignoreDuplicates: true }),
      `links_chunk${i}`
    )
    if (result?.error) { recordError('task_topics_upsert', result.error.message); stats.taskTopics.errors++ }
    else stats.taskTopics.upserted += records.slice(i, i + CHUNK).length
  }

  checkpoint.linksUpserted = true
  saveCheckpoint()
  log(`  ✓  ${stats.taskTopics.upserted} links upserted, ${stats.taskTopics.skipped} skipped`)
}

// ── 5 & 6. Assets upload + metadata ──────────────────────────────────────────

async function importAssets() {
  const allRows = readJsonl('catalog_task_assets.jsonl')
  log(`\n📂  Assets: ${allRows.length} в файле`)

  if (DRY_RUN) {
    const svgs = allRows.filter(r => r.local_path.endsWith('.svg'))
    const pngs = allRows.filter(r => r.local_path.endsWith('.png'))
    const samplePaths = allRows.slice(0, 3).map(r => localPathToStoragePath(r.local_path))
    log(`  [DRY-RUN] SVG: ${svgs.length}, PNG: ${pngs.length}`)
    log(`  Примеры Storage-путей:`)
    samplePaths.forEach(p => log(`    ${p}`))
    stats.assets.uploaded = allRows.length
    return
  }

  // Fetch task uuid map
  const taskRows = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase.from('catalog_tasks').select('id,external_id')
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE).range(from, from + 999)
    taskRows.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) break
  }
  const taskMap = Object.fromEntries(taskRows.map(t => [String(t.external_id), t.id]))

  // Filter to tasks actually imported (respects --limit)
  const rows = allRows.filter(r => taskMap[String(r.task_external_id)])
  log(`  →  ${rows.length} assets для загруженных задач`)

  // Build set of already-uploaded paths (checkpoint)
  const alreadyUploaded = new Set(checkpoint.uploadedPaths)
  const alreadyMeta     = new Set(checkpoint.assetsMetaUpserted)

  // Also check existing DB asset paths (in chunks of 50)
  const taskUuids = [...new Set(rows.map(r => taskMap[String(r.task_external_id)]))]
  const existingDbPaths = new Set()
  for (let i = 0; i < taskUuids.length; i += 50) {
    const chunk = taskUuids.slice(i, i + 50)
    const { data } = await supabase.from('catalog_task_assets').select('storage_path').in('task_id', chunk)
    ;(data ?? []).forEach(a => existingDbPaths.add(a.storage_path))
  }
  log(`  →  ${existingDbPaths.size} paths уже в БД`)

  const pendingMeta = []

  // Process assets with limited concurrency
  let idx = 0
  const total = rows.length

  async function processOne(r) {
    const taskUuid    = taskMap[String(r.task_external_id)]
    const storagePath = localPathToStoragePath(r.local_path)

    const meta = {
      task_id:        taskUuid,
      tex_session_id: r.tex_session_id ?? null,
      kind:           r.kind ?? 'condition',
      storage_path:   storagePath,
      alt:            r.alt        ?? null,
      size_bytes:     r.size_bytes ?? null,
      position:       r.position   ?? 0,
    }

    // Skip upload if already in checkpoint or DB
    if (alreadyUploaded.has(storagePath) || existingDbPaths.has(storagePath)) {
      stats.assets.skipped++
      // Still need to upsert meta if not already done
      if (!alreadyMeta.has(`${taskUuid}:${storagePath}`)) {
        pendingMeta.push(meta)
      }
      return
    }

    const localFile = localPathToFile(r.local_path)
    if (!existsSync(localFile)) {
      recordError('assets_file', `file not found: ${r.local_path}`)
      stats.assets.errors++
      return
    }

    const content     = readFileSync(localFile)
    const contentType = mime(r.local_path)

    const result = await withRetry(
      () => supabase.storage.from(BUCKET).upload(storagePath, content, { contentType, upsert: false }),
      `upload_${storagePath.split('/').pop()}`
    )

    if (result?.error) {
      const msg = result.error.message ?? ''
      if (msg.includes('already exists') || result.error.statusCode === '409') {
        stats.assets.skipped++
        checkpoint.uploadedPaths.push(storagePath)
      } else {
        recordError('assets_upload', `${r.local_path}: ${msg}`)
        stats.assets.errors++
        return
      }
    } else {
      stats.assets.uploaded++
      checkpoint.uploadedPaths.push(storagePath)
    }

    pendingMeta.push(meta)
  }

  // Run with concurrency pool
  const queue = [...rows]
  let done = 0

  async function worker() {
    while (queue.length > 0) {
      const r = queue.shift()
      if (!r) break
      await processOne(r)
      done++
      idx++

      // Save checkpoint + flush meta periodically
      if (idx % CHECKPOINT_INTERVAL === 0) {
        await flushMeta(pendingMeta.splice(0))
        saveCheckpoint()
        log(`  ↳  ${done}/${total} assets (↑${stats.assets.uploaded} skip${stats.assets.skipped} ✗${stats.assets.errors})`)
      }
    }
  }

  const workers = Array.from({ length: UPLOAD_CONCURRENCY }, () => worker())
  await Promise.all(workers)

  // Flush remaining meta
  if (pendingMeta.length > 0) {
    await flushMeta(pendingMeta.splice(0))
  }
  saveCheckpoint()

  log(`  ✓  ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
}

async function flushMeta(records) {
  if (!records.length) return
  const BATCH = 200
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    const result = await withRetry(
      () => supabase.from('catalog_task_assets').upsert(batch, { onConflict: 'task_id,storage_path', ignoreDuplicates: false }),
      `meta_upsert`
    )
    if (result?.error) { recordError('assets_upsert', result.error.message); stats.meta.errors++ }
    else {
      stats.meta.upserted += batch.length
      batch.forEach(b => checkpoint.assetsMetaUpserted.push(`${b.task_id}:${b.storage_path}`))
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('🚀  Импорт Физика ОГЭ (FULL)')
  log(`    SUBJECT=${SUBJECT}  EXAM_TYPE=${EXAM_TYPE}`)
  log(`    CATALOG_DIR=${CATALOG_DIR}`)
  log(`    Service key: [задан, не показываем]`)
  log(`    DRY_RUN=${DRY_RUN}  RESUME=${FLAG_RESUME}  LIMIT=${TASK_LIMIT ?? 'none'}`)
  if (!DRY_RUN) log(`    LOG: ${LOG_FILE}`)

  if (DRY_RUN) {
    log('\n⚠️   DRY-RUN: база данных и Storage не изменяются.')
    log('    Для боевого запуска передай:')
    log('      CATALOG_PHYSICS_OGE_FULL_IMPORT_CONFIRMED=yes ... --confirm-full-import')
  }

  if (FLAG_RESUME) loadCheckpoint()

  const valid = await validateData()
  if (!valid) {
    logErr('\n❌  Валидация не пройдена. Импорт прерван.')
    process.exit(1)
  }

  await checkIsolation('До импорта')

  await importSections()
  await importTopics()
  await importTasks()
  await importTaskTopics()
  await importAssets()

  if (!DRY_RUN) {
    await checkIsolation('После импорта')
  }

  log('\n══════════════════════════════════════════════')
  log(`📊  Итог ${DRY_RUN ? '[DRY-RUN]' : ''}:`)
  log(`    Sections:   ${stats.sections.upserted} upserted, ${stats.sections.errors} errors`)
  log(`    Topics:     ${stats.topics.upserted} upserted, ${stats.topics.errors} errors`)
  log(`    Tasks:      ${stats.tasks.upserted} upserted, ${stats.tasks.errors} errors`)
  log(`    Task-Topic: ${stats.taskTopics.upserted} links, ${stats.taskTopics.skipped} skipped, ${stats.taskTopics.errors} errors`)
  log(`    Assets:     ${stats.assets.uploaded} uploaded, ${stats.assets.skipped} skipped, ${stats.assets.errors} errors`)
  log(`    Meta:       ${stats.meta.upserted} upserted, ${stats.meta.errors} errors`)

  if (errors.length) {
    const errLog = `physics-oge-errors-${Date.now()}.json`
    writeFileSync(errLog, JSON.stringify(errors, null, 2))
    log(`\n⚠️   ${errors.length} ошибок записано в ${errLog}`)
  } else if (DRY_RUN) {
    log('\n✅  DRY-RUN завершён. Данные не изменены.')
  } else {
    log('\n✅  Импорт завершён успешно.')
  }

  logStream?.end()
}

main().catch(e => { logErr('Fatal:', e); process.exit(1) })
