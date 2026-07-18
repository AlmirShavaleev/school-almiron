import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY не задан.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

const SUBJECT = 'Физика'
const EXAM_TYPE = 'ЕГЭ'
const TOPIC_EXTERNAL_ID_MIN = 900101
const TOPIC_EXTERNAL_ID_MAX = 900712
const SOURCE_TAG = 'ai_physics_v1'

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const INPUT_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'apply-snapshot.json')
const DRY_RUN_CSV = path.join(REPORTS_DIR, 'apply-dry-run.csv')
const APPLY_LOG_CSV = path.join(REPORTS_DIR, 'apply-log.csv')
const DB_BATCH_SIZE = 50

const APPLY = process.argv.includes('--apply')

fs.mkdirSync(REPORTS_DIR, { recursive: true })

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Не найден файл ${filePath}`)
  }

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Некорректный JSONL на строке ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function writeCsv(filePath, headers, rows) {
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(header => csvEscape(row[header])).join(',')),
  ]
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8')
}

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

function formatError(error) {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack || ''}`.trim()
  }
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

function loadPrimaryCandidates() {
  const rows = readJsonl(INPUT_FILE)
  const stats = {
    total_rows: rows.length,
    zero_topics_skipped: 0,
    parse_failed_skipped: 0,
    no_primary_skipped: 0,
    multi_primary_skipped: 0,
  }

  const candidates = []

  for (const row of rows) {
    const topics = Array.isArray(row.suggestion?.topics) ? row.suggestion.topics : []
    if (topics.length === 0) {
      stats.zero_topics_skipped++
      continue
    }
    if (row.status === 'parse_failed' || row.suggestion?.validation_errors?.includes('parse_failed')) {
      stats.parse_failed_skipped++
      continue
    }

    const primaryTopics = topics.filter(topic => topic.is_primary)
    if (primaryTopics.length === 0) {
      stats.no_primary_skipped++
      continue
    }
    if (primaryTopics.length !== 1) {
      stats.multi_primary_skipped++
      continue
    }

    candidates.push({
      external_id: row.external_id,
      primary_topic_id: primaryTopics[0].topic_id,
      confidence: primaryTopics[0].confidence,
      difficulty: row.suggestion?.difficulty || '',
      section_exam_number: row.section_exam_number ?? null,
      section_title: row.section_title ?? '',
    })
  }

  return { candidates, stats }
}

async function fetchTaskMap(externalIds) {
  const taskRows = []
  const batches = chunk(externalIds, DB_BATCH_SIZE)
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id, external_id, subject, exam_type')
      .in('external_id', batch)
    if (error) {
      throw new Error(`catalog_tasks batch ${index + 1}/${batches.length} failed: ${formatError(error)}`)
    }
    taskRows.push(...(data || []))
  }
  return Object.fromEntries(taskRows.map(row => [row.external_id, row]))
}

async function fetchTopicMap(topicIds) {
  const topicRows = []
  const batches = chunk(topicIds, DB_BATCH_SIZE)
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    const { data, error } = await supabase
      .from('catalog_topics')
      .select('id, title, external_id, subject, exam_type, parent_id')
      .in('id', batch)
    if (error) {
      throw new Error(`catalog_topics batch ${index + 1}/${batches.length} failed: ${formatError(error)}`)
    }
    topicRows.push(...(data || []))
  }

  const parentIds = [...new Set(topicRows.map(row => row.parent_id).filter(Boolean))]
  const parentRows = []
  const parentBatches = chunk(parentIds, DB_BATCH_SIZE)
  for (let index = 0; index < parentBatches.length; index++) {
    const batch = parentBatches[index]
    const { data, error } = await supabase
      .from('catalog_topics')
      .select('id, title')
      .in('id', batch)
    if (error) {
      throw new Error(`catalog_topics parent batch ${index + 1}/${parentBatches.length} failed: ${formatError(error)}`)
    }
    parentRows.push(...(data || []))
  }

  const parentMap = Object.fromEntries(parentRows.map(row => [row.id, row]))
  return Object.fromEntries(topicRows.map(row => [row.id, {
    ...row,
    parent_topic_title: row.parent_id ? parentMap[row.parent_id]?.title || '' : '',
  }]))
}

async function fetchExistingLinks(taskIds) {
  const links = []
  const batches = chunk(taskIds, DB_BATCH_SIZE)
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id, is_primary, source')
      .in('task_id', batch)
    if (error) {
      throw new Error(`catalog_task_topics batch ${index + 1}/${batches.length} failed: ${formatError(error)}`)
    }
    links.push(...(data || []))
  }
  return links
}

async function verifySupabaseAccess() {
  const { count, error } = await supabase
    .from('catalog_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)

  if (error) {
    throw new Error(`Supabase connectivity check failed: ${formatError(error)}`)
  }

  console.log(`Supabase connectivity OK, physics/ege tasks visible: ${count ?? 'unknown'}`)
}

async function validateCandidates(candidates) {
  const externalIds = [...new Set(candidates.map(candidate => candidate.external_id))]
  const topicIds = [...new Set(candidates.map(candidate => candidate.primary_topic_id))]

  console.log(`Validation batches: tasks=${Math.ceil(externalIds.length / DB_BATCH_SIZE)}, topics=${Math.ceil(topicIds.length / DB_BATCH_SIZE)}`)

  console.log('Resolving tasks...')
  const taskMap = await fetchTaskMap(externalIds)
  console.log('Resolving topics...')
  const topicMap = await fetchTopicMap(topicIds)

  const rows = []
  const validRows = []
  const invalidReasons = {}

  for (const candidate of candidates) {
    const errors = []
    const task = taskMap[candidate.external_id]
    const topic = topicMap[candidate.primary_topic_id]

    if (!task) {
      errors.push('TASK_NOT_FOUND')
    } else {
      if (task.subject !== SUBJECT || task.exam_type !== EXAM_TYPE) {
        errors.push(`TASK_WRONG_SUBJECT_EXAM:${task.subject}/${task.exam_type}`)
      }
    }

    if (!topic) {
      errors.push('TOPIC_NOT_FOUND')
    } else {
      if (topic.subject !== SUBJECT || topic.exam_type !== EXAM_TYPE) {
        errors.push(`TOPIC_WRONG_SUBJECT_EXAM:${topic.subject}/${topic.exam_type}`)
      }
      if (topic.external_id < TOPIC_EXTERNAL_ID_MIN || topic.external_id > TOPIC_EXTERNAL_ID_MAX) {
        errors.push(`TOPIC_OUT_OF_LEAF_RANGE:${topic.external_id}`)
      }
    }

    const row = {
      external_id: candidate.external_id,
      task_id: task?.id ?? '',
      primary_topic_id: candidate.primary_topic_id,
      primary_topic_title: topic?.title ?? '',
      parent_topic_title: topic?.parent_topic_title ?? '',
      confidence: candidate.confidence,
      difficulty: candidate.difficulty,
      section_exam_number: candidate.section_exam_number ?? '',
      section_title: candidate.section_title ?? '',
      validation_status: errors.length === 0 ? 'OK' : 'FAIL',
      validation_errors: errors.join('; '),
    }

    rows.push(row)

    if (errors.length === 0) {
      validRows.push(row)
    } else {
      for (const error of errors) {
        invalidReasons[error] = (invalidReasons[error] || 0) + 1
      }
    }
  }

  return { rows, validRows, invalidReasons }
}

async function createSnapshot(validRows) {
  const taskIds = validRows.map(row => row.task_id)
  const existingLinks = await fetchExistingLinks(taskIds)
  const byTask = {}

  for (const link of existingLinks) {
    if (!byTask[link.task_id]) byTask[link.task_id] = []
    byTask[link.task_id].push(link)
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    source: SOURCE_TAG,
    affected_tasks: validRows.length,
    tasks: validRows.map(row => ({
      task_id: row.task_id,
      external_id: row.external_id,
      existing_links: byTask[row.task_id] || [],
    })),
  }

  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8')
  return snapshot
}

function buildDryRunCsv(validRows) {
  writeCsv(
    DRY_RUN_CSV,
    ['external_id', 'primary_topic_title', 'parent_topic_title', 'confidence', 'difficulty', 'section_exam_number', 'section_title'],
    validRows
  )
}

function summarizeByTopic(validRows) {
  const counts = {}
  for (const row of validRows) {
    const label = row.primary_topic_title || row.primary_topic_id
    counts[label] = (counts[label] || 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([title, count]) => ({ title, count }))
}

function summarizeBySection(validRows) {
  const counts = {}
  for (const row of validRows) {
    const key = `№${row.section_exam_number || '?'} ${row.section_title || ''}`.trim()
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
    .map(([section, count]) => ({ section, count }))
}

async function applyRows(validRows) {
  const records = validRows.map(row => ({
    task_id: row.task_id,
    topic_id: row.primary_topic_id,
    is_primary: true,
    source: SOURCE_TAG,
  }))

  const beforeCountResult = await supabase
    .from('catalog_task_topics')
    .select('task_id, topic_id', { count: 'exact' })
    .eq('source', SOURCE_TAG)

  if (beforeCountResult.error) throw beforeCountResult.error
  const beforePairs = new Set((beforeCountResult.data || []).map(row => `${row.task_id}::${row.topic_id}`))

  for (const batch of chunk(records, DB_BATCH_SIZE)) {
    const { error } = await supabase
      .from('catalog_task_topics')
      .upsert(batch, { onConflict: 'task_id,topic_id', ignoreDuplicates: true })
    if (error) throw error
  }

  const afterResult = await supabase
    .from('catalog_task_topics')
    .select('task_id, topic_id, source')
    .eq('source', SOURCE_TAG)

  if (afterResult.error) throw afterResult.error

  const afterPairs = new Set((afterResult.data || []).map(row => `${row.task_id}::${row.topic_id}`))

  const logRows = validRows.map(row => {
    const key = `${row.task_id}::${row.primary_topic_id}`
    const existedBefore = beforePairs.has(key)
    const existsAfter = afterPairs.has(key)
    return {
      external_id: row.external_id,
      task_id: row.task_id,
      primary_topic_id: row.primary_topic_id,
      primary_topic_title: row.primary_topic_title,
      confidence: row.confidence,
      difficulty: row.difficulty,
      action: existedBefore ? 'already_present' : (existsAfter ? 'inserted' : 'missing_after_apply'),
    }
  })

  writeCsv(
    APPLY_LOG_CSV,
    ['external_id', 'task_id', 'primary_topic_id', 'primary_topic_title', 'confidence', 'difficulty', 'action'],
    logRows
  )

  const finalCountResult = await supabase
    .from('catalog_task_topics')
    .select('*', { count: 'exact', head: true })
    .eq('source', SOURCE_TAG)

  if (finalCountResult.error) throw finalCountResult.error

  return {
    logRows,
    final_count: finalCountResult.count ?? 0,
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))

  const { candidates, stats } = loadPrimaryCandidates()
  console.log(`JSONL rows: ${stats.total_rows}`)
  console.log(`Skipped zero-topic: ${stats.zero_topics_skipped}`)
  console.log(`Skipped parse_failed: ${stats.parse_failed_skipped}`)
  console.log(`Skipped no primary: ${stats.no_primary_skipped}`)
  console.log(`Skipped multi primary: ${stats.multi_primary_skipped}`)
  console.log(`Primary candidates: ${candidates.length}`)

  await verifySupabaseAccess()

  const { rows, validRows, invalidReasons } = await validateCandidates(candidates)
  console.log(`Validated OK: ${validRows.length}`)
  console.log(`Validation FAIL: ${rows.length - validRows.length}`)

  if (Object.keys(invalidReasons).length > 0) {
    console.log('Invalid reasons:')
    for (const [reason, count] of Object.entries(invalidReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`)
    }
  }

  await createSnapshot(validRows)
  buildDryRunCsv(validRows)

  const byTopic = summarizeByTopic(validRows)
  const bySection = summarizeBySection(validRows)

  console.log(`Snapshot: ${SNAPSHOT_FILE}`)
  console.log(`Dry-run CSV: ${DRY_RUN_CSV}`)
  console.log(`Would insert primary links: ${validRows.length}`)
  console.log('By topic:')
  for (const row of byTopic.slice(0, 20)) {
    console.log(`  ${row.title}: ${row.count}`)
  }
  console.log('By section:')
  for (const row of bySection) {
    console.log(`  ${row.section}: ${row.count}`)
  }

  if (!APPLY) {
    console.log('\nDry-run only. Для применения добавьте --apply.')
    return
  }

  const applyResult = await applyRows(validRows)
  console.log(`Apply log: ${APPLY_LOG_CSV}`)
  console.log(`catalog_task_topics rows with source='${SOURCE_TAG}': ${applyResult.final_count}`)
}

main().catch(error => {
  console.error('FATAL:')
  console.error(formatError(error))
  process.exit(1)
})
