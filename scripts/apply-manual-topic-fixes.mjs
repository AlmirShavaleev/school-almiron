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
const SOURCE_TAG = 'ai_physics_v1'
const TOPIC_EXTERNAL_ID_MIN = 900101
const TOPIC_EXTERNAL_ID_MAX = 900712
const DB_BATCH_SIZE = 50

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const INPUT_FILE = path.join(REPORTS_DIR, 'manual-topic-fixes.json')
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'manual-fixes-snapshot.json')
const DRY_RUN_CSV = path.join(REPORTS_DIR, 'manual-fixes-dry-run.csv')
const APPLY_LOG_CSV = path.join(REPORTS_DIR, 'manual-fixes-apply-log.csv')
const SUMMARY_FILE = path.join(REPORTS_DIR, 'manual-fixes-summary.json')

const APPLY = process.argv.includes('--apply')

fs.mkdirSync(REPORTS_DIR, { recursive: true })

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size))
  return result
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

function formatError(error) {
  if (error instanceof Error) return `${error.message}\n${error.stack || ''}`.trim()
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

function readManualFixes() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Не найден файл ${INPUT_FILE}`)
  }

  const raw = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'))
  if (Array.isArray(raw)) return raw
  if (raw && Array.isArray(raw.fixes)) return raw.fixes
  throw new Error('manual-topic-fixes.json должен быть массивом или объектом формата {"_readme":"...","fixes":[...]}')
}

async function fetchLeafTopics() {
  const { data, error } = await supabase
    .from('catalog_topics')
    .select('id, title, external_id, subject, exam_type')
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)
    .gte('external_id', TOPIC_EXTERNAL_ID_MIN)
    .lte('external_id', TOPIC_EXTERNAL_ID_MAX)
    .order('external_id')

  if (error) throw error
  return data || []
}

async function fetchTaskMap(externalIds) {
  const rows = []
  for (const batch of chunk(externalIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id, external_id, subject, exam_type')
      .in('external_id', batch)
    if (error) throw error
    rows.push(...(data || []))
  }
  return Object.fromEntries(rows.map(row => [row.external_id, row]))
}

async function fetchExistingLinks(taskIds) {
  const rows = []
  for (const batch of chunk(taskIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id, is_primary, source')
      .in('task_id', batch)
    if (error) throw error
    rows.push(...(data || []))
  }
  return rows
}

function resolveTopicRef(topicRef, topics) {
  if (Number.isFinite(topicRef)) {
    const byExternalId = topics.filter(topic => topic.external_id === Number(topicRef))
    if (byExternalId.length === 1) return byExternalId[0]
    if (byExternalId.length === 0) throw new Error(`Тема с external_id=${topicRef} не найдена среди листьев 900101-900712`)
    throw new Error(`Тема с external_id=${topicRef} найдена неоднозначно`)
  }

  const normalized = String(topicRef).trim()
  const matches = topics.filter(topic => topic.title === normalized)
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) throw new Error(`Тема "${normalized}" не найдена среди листьев 900101-900712`)
  throw new Error(`Тема "${normalized}" найдена неоднозначно (${matches.length} совпадений)`)
}

async function prepareRows() {
  const fixes = readManualFixes()
  const topics = await fetchLeafTopics()
  const taskMap = await fetchTaskMap([...new Set(fixes.map(fix => fix.external_id).filter(Number.isFinite))])
  const rows = []
  const invalidReasons = {}

  for (const fix of fixes) {
    const errors = []
    const task = taskMap[fix.external_id]
    let topic = null

    if (!task) {
      errors.push('TASK_NOT_FOUND')
    } else if (task.subject !== SUBJECT || task.exam_type !== EXAM_TYPE) {
      errors.push(`TASK_WRONG_SUBJECT_EXAM:${task.subject}/${task.exam_type}`)
    }

    try {
      topic = resolveTopicRef(fix.topic, topics)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    const row = {
      external_id: fix.external_id,
      note: fix.note ?? '',
      requested_topic: fix.topic,
      task_id: task?.id ?? '',
      next_topic_id: topic?.id ?? '',
      next_topic_title: topic?.title ?? '',
      next_topic_external_id: topic?.external_id ?? '',
      validation_status: errors.length === 0 ? 'OK' : 'FAIL',
      validation_errors: errors.join('; '),
    }

    rows.push(row)
    for (const error of errors) invalidReasons[error] = (invalidReasons[error] || 0) + 1
  }

  return {
    rows,
    validRows: rows.filter(row => row.validation_status === 'OK'),
    invalidReasons,
  }
}

function getPrimaryLink(links, taskId) {
  return links.find(link => link.task_id === taskId && link.is_primary === true && link.source === SOURCE_TAG) || null
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
      next_topic_id: row.next_topic_id,
      next_topic_title: row.next_topic_title,
      note: row.note,
      existing_links: byTask[row.task_id] || [],
    })),
  }

  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8')
  return snapshot
}

function buildDryRun(validRows, snapshot) {
  const taskById = Object.fromEntries(snapshot.tasks.map(task => [task.task_id, task]))
  const dryRows = validRows.map(row => {
    const snap = taskById[row.task_id]
    const currentPrimary = (snap.existing_links || []).find(link => link.is_primary === true && link.source === SOURCE_TAG) || null
    return {
      external_id: row.external_id,
      task_id: row.task_id,
      current_primary_topic_id: currentPrimary?.topic_id ?? '',
      next_topic_external_id: row.next_topic_external_id,
      next_topic_title: row.next_topic_title,
      action: currentPrimary ? (currentPrimary.topic_id === row.next_topic_id ? 'skip_already_primary' : 'replace_primary') : 'insert_primary',
      note: row.note,
    }
  })

  writeCsv(
    DRY_RUN_CSV,
    ['external_id', 'task_id', 'current_primary_topic_id', 'next_topic_external_id', 'next_topic_title', 'action', 'note'],
    dryRows
  )

  const summary = {
    generated_at: new Date().toISOString(),
    apply_mode: APPLY,
    total_valid: validRows.length,
    replace_primary: dryRows.filter(row => row.action === 'replace_primary').length,
    insert_primary: dryRows.filter(row => row.action === 'insert_primary').length,
    skip_already_primary: dryRows.filter(row => row.action === 'skip_already_primary').length,
  }

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), 'utf8')

  for (const row of dryRows) {
    const before = row.current_primary_topic_id || 'нет primary'
    console.log(`[${row.external_id}] ${before} -> ${row.next_topic_title} (${row.action})`)
  }
}

async function deletePrimary(taskId, topicId) {
  const { data, error } = await supabase
    .from('catalog_task_topics')
    .delete()
    .eq('task_id', taskId)
    .eq('topic_id', topicId)
    .eq('source', SOURCE_TAG)
    .select('task_id, topic_id')

  if (error) throw error
  return data || []
}

async function insertPrimary(taskId, topicId) {
  const existing = await supabase
    .from('catalog_task_topics')
    .select('task_id, topic_id, is_primary, source')
    .eq('task_id', taskId)
    .eq('topic_id', topicId)
    .limit(1)

  if (existing.error) throw existing.error

  if (existing.data?.length) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .update({ is_primary: true, source: SOURCE_TAG })
      .eq('task_id', taskId)
      .eq('topic_id', topicId)
      .select('task_id, topic_id')
    if (error) throw error
    return { mode: 'update_existing', rows: data || [] }
  }

  const { data, error } = await supabase
    .from('catalog_task_topics')
    .insert({ task_id: taskId, topic_id: topicId, is_primary: true, source: SOURCE_TAG })
    .select('task_id, topic_id')

  if (error) throw error
  return { mode: 'insert_new', rows: data || [] }
}

async function applyRows(validRows, snapshot) {
  const taskById = Object.fromEntries(snapshot.tasks.map(task => [task.task_id, task]))
  const logRows = []
  let fixed = 0
  let skipped = 0
  let errors = 0

  for (let index = 0; index < validRows.length; index++) {
    const row = validRows[index]
    const snap = taskById[row.task_id]
    const currentPrimary = getPrimaryLink(snap.existing_links || [], row.task_id)

    try {
      if (currentPrimary?.topic_id === row.next_topic_id) {
        skipped++
        logRows.push({
          external_id: row.external_id,
          action: 'skip_already_primary',
          details: row.next_topic_title,
        })
      } else if (!currentPrimary) {
        const inserted = await insertPrimary(row.task_id, row.next_topic_id)
        if (inserted.rows.length === 0) {
          errors++
          logRows.push({ external_id: row.external_id, action: 'error_insert_zero_rows', details: row.next_topic_title })
        } else {
          fixed++
          logRows.push({ external_id: row.external_id, action: inserted.mode, details: row.next_topic_title })
        }
      } else {
        const deleted = await deletePrimary(row.task_id, currentPrimary.topic_id)
        if (deleted.length === 0) {
          errors++
          logRows.push({ external_id: row.external_id, action: 'error_delete_zero_rows', details: `${currentPrimary.topic_id} -> ${row.next_topic_title}` })
        } else {
          const inserted = await insertPrimary(row.task_id, row.next_topic_id)
          if (inserted.rows.length === 0) {
            errors++
            logRows.push({ external_id: row.external_id, action: 'error_insert_zero_rows', details: row.next_topic_title })
          } else {
            fixed++
            logRows.push({ external_id: row.external_id, action: inserted.mode, details: `${currentPrimary.topic_id} -> ${row.next_topic_title}` })
          }
        }
      }
    } catch (error) {
      errors++
      logRows.push({ external_id: row.external_id, action: 'error_exception', details: formatError(error) })
    }

    const processed = index + 1
    if (APPLY && processed % 10 === 0) {
      console.log(`Обработано ${processed}/${validRows.length}...`)
    }
  }

  writeCsv(APPLY_LOG_CSV, ['external_id', 'action', 'details'], logRows)
  return { fixed, skipped, errors }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))

  const { rows, validRows, invalidReasons } = await prepareRows()
  console.log(`Input rows: ${rows.length}`)
  console.log(`Validated OK: ${validRows.length}`)
  console.log(`Validation FAIL: ${rows.length - validRows.length}`)

  if (Object.keys(invalidReasons).length > 0) {
    console.log('Invalid reasons:')
    for (const [reason, count] of Object.entries(invalidReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`)
    }
  }

  const snapshot = await createSnapshot(validRows)
  buildDryRun(validRows, snapshot)

  console.log(`Snapshot: ${SNAPSHOT_FILE}`)
  console.log(`Dry-run CSV: ${DRY_RUN_CSV}`)
  console.log(`Summary: ${SUMMARY_FILE}`)

  if (!APPLY) {
    console.log('\nDry-run only. Для применения добавьте --apply.')
    return
  }

  const result = await applyRows(validRows, snapshot)
  console.log(`Apply log: ${APPLY_LOG_CSV}`)
  console.log(`ГОТОВО: исправлено ${result.fixed}, пропущено ${result.skipped}, ошибок ${result.errors}`)
}

main().catch(error => {
  console.error('FATAL:')
  console.error(formatError(error))
  process.exit(1)
})
