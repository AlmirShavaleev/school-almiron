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
const DB_BATCH_SIZE = 50
const NEW_TOPIC_EXTERNAL_IDS = new Set([900130, 900131])

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const OLD_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const NEW_FILE = path.join(REPORTS_DIR, 'reclassify-suggestions.jsonl')
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'reclassify-apply-snapshot.json')
const DRY_RUN_CSV = path.join(REPORTS_DIR, 'reclassify-apply-dry-run.csv')
const APPLY_LOG_CSV = path.join(REPORTS_DIR, 'reclassify-apply-log.csv')
const SUMMARY_FILE = path.join(REPORTS_DIR, 'reclassify-apply-summary.json')

const APPLY = process.argv.includes('--apply')
const ONLY_NEW_TOPICS = !process.argv.includes('--all-changes')

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
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size))
  return result
}

function getPrimaryTopic(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.find(topic => topic.is_primary) || topics[0] || null
}

function formatError(error) {
  if (error instanceof Error) return `${error.message}\n${error.stack || ''}`.trim()
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

function loadChangedPrimaryCandidates() {
  const oldRows = readJsonl(OLD_FILE)
  const newRows = readJsonl(NEW_FILE)
  const oldByExternalId = new Map(oldRows.map(row => [row.external_id, row]))
  const stats = {
    old_rows: oldRows.length,
    new_rows: newRows.length,
    skipped_missing_old: 0,
    skipped_no_primary: 0,
    skipped_same_primary: 0,
    skipped_not_new_topics: 0,
  }

  const candidates = []

  for (const newRow of newRows) {
    const oldRow = oldByExternalId.get(newRow.external_id)
    if (!oldRow) {
      stats.skipped_missing_old++
      continue
    }

    const oldPrimary = getPrimaryTopic(oldRow)
    const newPrimary = getPrimaryTopic(newRow)
    if (!oldPrimary || !newPrimary) {
      stats.skipped_no_primary++
      continue
    }

    if (oldPrimary.topic_id === newPrimary.topic_id) {
      stats.skipped_same_primary++
      continue
    }

    const newExternalId = Number(newPrimary.topic_id_external_id ?? NaN)
    candidates.push({
      external_id: newRow.external_id,
      task_statement: newRow.statement_text || oldRow.statement_text || '',
      old_primary_topic_id: oldPrimary.topic_id,
      old_primary_confidence: oldPrimary.confidence,
      new_primary_topic_id: newPrimary.topic_id,
      new_primary_confidence: newPrimary.confidence,
      new_primary_external_id_hint: newExternalId,
    })
  }

  return { candidates, stats }
}

async function fetchTaskMap(externalIds) {
  const taskRows = []
  for (const batch of chunk(externalIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id, external_id, subject, exam_type')
      .in('external_id', batch)

    if (error) throw error
    taskRows.push(...(data || []))
  }
  return Object.fromEntries(taskRows.map(row => [row.external_id, row]))
}

async function fetchTopicMap(topicIds) {
  const topicRows = []
  for (const batch of chunk(topicIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_topics')
      .select('id, title, external_id, subject, exam_type')
      .in('id', batch)

    if (error) throw error
    topicRows.push(...(data || []))
  }
  return Object.fromEntries(topicRows.map(row => [row.id, row]))
}

async function fetchExistingLinks(taskIds) {
  const links = []
  for (const batch of chunk(taskIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id, is_primary, source')
      .in('task_id', batch)

    if (error) throw error
    links.push(...(data || []))
  }
  return links
}

async function validateCandidates(candidates) {
  const externalIds = [...new Set(candidates.map(candidate => candidate.external_id))]
  const topicIds = [...new Set(candidates.flatMap(candidate => [candidate.old_primary_topic_id, candidate.new_primary_topic_id]))]

  const [taskMap, topicMap] = await Promise.all([
    fetchTaskMap(externalIds),
    fetchTopicMap(topicIds),
  ])

  const rows = []
  const validRows = []
  const invalidReasons = {}

  for (const candidate of candidates) {
    const errors = []
    const task = taskMap[candidate.external_id]
    const oldTopic = topicMap[candidate.old_primary_topic_id]
    const newTopic = topicMap[candidate.new_primary_topic_id]

    if (!task) {
      errors.push('TASK_NOT_FOUND')
    } else if (task.subject !== SUBJECT || task.exam_type !== EXAM_TYPE) {
      errors.push(`TASK_WRONG_SUBJECT_EXAM:${task.subject}/${task.exam_type}`)
    }

    for (const [label, topic] of [['OLD', oldTopic], ['NEW', newTopic]]) {
      if (!topic) {
        errors.push(`${label}_TOPIC_NOT_FOUND`)
        continue
      }
      if (topic.subject !== SUBJECT || topic.exam_type !== EXAM_TYPE) {
        errors.push(`${label}_TOPIC_WRONG_SUBJECT_EXAM:${topic.subject}/${topic.exam_type}`)
      }
      if (topic.external_id < TOPIC_EXTERNAL_ID_MIN || topic.external_id > TOPIC_EXTERNAL_ID_MAX) {
        errors.push(`${label}_TOPIC_OUT_OF_RANGE:${topic.external_id}`)
      }
    }

    if (ONLY_NEW_TOPICS && newTopic && !NEW_TOPIC_EXTERNAL_IDS.has(newTopic.external_id)) {
      errors.push(`NEW_TOPIC_NOT_IN_900130_900131:${newTopic.external_id}`)
    }

    const row = {
      external_id: candidate.external_id,
      task_id: task?.id ?? '',
      old_primary_topic_id: candidate.old_primary_topic_id,
      old_primary_topic_title: oldTopic?.title ?? '',
      old_primary_external_id: oldTopic?.external_id ?? '',
      old_primary_confidence: candidate.old_primary_confidence,
      new_primary_topic_id: candidate.new_primary_topic_id,
      new_primary_topic_title: newTopic?.title ?? '',
      new_primary_external_id: newTopic?.external_id ?? '',
      new_primary_confidence: candidate.new_primary_confidence,
      validation_status: errors.length === 0 ? 'OK' : 'FAIL',
      validation_errors: errors.join('; '),
      statement_text: candidate.task_statement,
    }

    rows.push(row)
    if (errors.length === 0) {
      validRows.push(row)
    } else {
      for (const error of errors) invalidReasons[error] = (invalidReasons[error] || 0) + 1
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
    only_new_topics: ONLY_NEW_TOPICS,
    affected_tasks: validRows.length,
    tasks: validRows.map(row => ({
      task_id: row.task_id,
      external_id: row.external_id,
      old_primary_topic_id: row.old_primary_topic_id,
      old_primary_topic_title: row.old_primary_topic_title,
      new_primary_topic_id: row.new_primary_topic_id,
      new_primary_topic_title: row.new_primary_topic_title,
      existing_links: byTask[row.task_id] || [],
    })),
  }

  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8')
}

function buildDryRunArtifacts(validRows) {
  writeCsv(
    DRY_RUN_CSV,
    [
      'external_id',
      'task_id',
      'old_primary_external_id',
      'old_primary_topic_title',
      'old_primary_confidence',
      'new_primary_external_id',
      'new_primary_topic_title',
      'new_primary_confidence',
      'validation_status',
    ],
    validRows
  )

  const transitions = {}
  for (const row of validRows) {
    const key = `${row.old_primary_topic_title} -> ${row.new_primary_topic_title}`
    transitions[key] = (transitions[key] || 0) + 1
  }

  const summary = {
    generated_at: new Date().toISOString(),
    apply_mode: APPLY,
    only_new_topics: ONLY_NEW_TOPICS,
    transferring: validRows.length,
    transitions: Object.entries(transitions)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
      .map(([transition, count]) => ({ transition, count })),
  }

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), 'utf8')
}

async function deleteOldLink(row) {
  const { data, error } = await supabase
    .from('catalog_task_topics')
    .delete()
    .eq('task_id', row.task_id)
    .eq('topic_id', row.old_primary_topic_id)
    .eq('source', SOURCE_TAG)
    .select('task_id, topic_id')

  if (error) throw error
  return data || []
}

async function insertOrPromoteNewLink(row) {
  const existingResult = await supabase
    .from('catalog_task_topics')
    .select('task_id, topic_id, is_primary, source')
    .eq('task_id', row.task_id)
    .eq('topic_id', row.new_primary_topic_id)
    .limit(1)

  if (existingResult.error) throw existingResult.error
  const existing = existingResult.data?.[0] ?? null

  if (existing) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .update({ is_primary: true, source: SOURCE_TAG })
      .eq('task_id', row.task_id)
      .eq('topic_id', row.new_primary_topic_id)
      .select('task_id, topic_id, is_primary, source')

    if (error) throw error
    return { mode: 'update_existing', rows: data || [] }
  }

  const { data, error } = await supabase
    .from('catalog_task_topics')
    .insert({
      task_id: row.task_id,
      topic_id: row.new_primary_topic_id,
      is_primary: true,
      source: SOURCE_TAG,
    })
    .select('task_id, topic_id, is_primary, source')

  if (error) throw error
  return { mode: 'insert_new', rows: data || [] }
}

async function applyRows(validRows) {
  const logRows = []
  let transferred = 0
  let errors = 0

  for (let index = 0; index < validRows.length; index++) {
    const row = validRows[index]

    try {
      const currentPrimaryResult = await supabase
        .from('catalog_task_topics')
        .select('task_id, topic_id, is_primary, source')
        .eq('task_id', row.task_id)
        .eq('topic_id', row.new_primary_topic_id)
        .eq('is_primary', true)
        .limit(1)

      if (currentPrimaryResult.error) throw currentPrimaryResult.error

      if (currentPrimaryResult.data?.length) {
        logRows.push({
          external_id: row.external_id,
          task_id: row.task_id,
          old_primary_topic_title: row.old_primary_topic_title,
          new_primary_topic_title: row.new_primary_topic_title,
          action: 'skipped_already_new_primary',
          details: 'new primary already set',
        })
        continue
      }

      const deleted = await deleteOldLink(row)
      if (deleted.length === 0) {
        errors++
        logRows.push({
          external_id: row.external_id,
          task_id: row.task_id,
          old_primary_topic_title: row.old_primary_topic_title,
          new_primary_topic_title: row.new_primary_topic_title,
          action: 'error_delete_zero_rows',
          details: 'DELETE returned 0 rows',
        })
        continue
      }

      const inserted = await insertOrPromoteNewLink(row)
      if ((inserted.rows || []).length === 0) {
        errors++
        logRows.push({
          external_id: row.external_id,
          task_id: row.task_id,
          old_primary_topic_title: row.old_primary_topic_title,
          new_primary_topic_title: row.new_primary_topic_title,
          action: 'error_insert_zero_rows',
          details: 'INSERT/UPDATE returned 0 rows',
        })
        continue
      }

      transferred++
      logRows.push({
        external_id: row.external_id,
        task_id: row.task_id,
        old_primary_topic_title: row.old_primary_topic_title,
        new_primary_topic_title: row.new_primary_topic_title,
        action: inserted.mode,
        details: `deleted=${deleted.length}; written=${inserted.rows.length}`,
      })
    } catch (error) {
      errors++
      logRows.push({
        external_id: row.external_id,
        task_id: row.task_id,
        old_primary_topic_title: row.old_primary_topic_title,
        new_primary_topic_title: row.new_primary_topic_title,
        action: 'error_exception',
        details: formatError(error),
      })
    }

    const processed = index + 1
    if (APPLY && processed % 10 === 0) {
      console.log(`Перенесено ${processed}/${validRows.length}...`)
    }
  }

  writeCsv(
    APPLY_LOG_CSV,
    ['external_id', 'task_id', 'old_primary_topic_title', 'new_primary_topic_title', 'action', 'details'],
    logRows
  )

  return { transferred, errors, logRows }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log(`ONLY_NEW_TOPICS=${ONLY_NEW_TOPICS}`)
  console.log('='.repeat(60))

  const { candidates, stats } = loadChangedPrimaryCandidates()
  console.log(`Old rows: ${stats.old_rows}`)
  console.log(`New rows: ${stats.new_rows}`)
  console.log(`Skipped same primary: ${stats.skipped_same_primary}`)
  console.log(`Changed primary candidates before validation: ${candidates.length}`)

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
  buildDryRunArtifacts(validRows)

  console.log(`Snapshot: ${SNAPSHOT_FILE}`)
  console.log(`Dry-run CSV: ${DRY_RUN_CSV}`)
  console.log(`Summary: ${SUMMARY_FILE}`)
  console.log(`Would transfer: ${validRows.length}`)

  if (!APPLY) {
    console.log('\nDry-run only. Для применения добавьте --apply.')
    return
  }

  const result = await applyRows(validRows)
  console.log(`Apply log: ${APPLY_LOG_CSV}`)
  console.log(`ГОТОВО: перенесено ${result.transferred}, ошибок ${result.errors}`)
}

main().catch(error => {
  console.error('FATAL:')
  console.error(formatError(error))
  process.exit(1)
})
