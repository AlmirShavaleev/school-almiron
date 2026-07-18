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
const APPLY_BATCH_SIZE = 100

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const CLASSIFY_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const RECLASSIFY_FILE = path.join(REPORTS_DIR, 'reclassify-suggestions.jsonl')
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'secondary-apply-snapshot.json')
const DRY_RUN_CSV = path.join(REPORTS_DIR, 'secondary-apply-dry-run.csv')
const APPLY_LOG_CSV = path.join(REPORTS_DIR, 'secondary-apply-log.csv')

const APPLY = process.argv.includes('--apply')

const STOP_LIST = new Set([
  '128834::Работа и мощность тока, закон Джоуля-Ленца',
  '123010::Магнитный поток',
  '102432::Движение заряда в магнитном поле',
  '136980::Движение заряда в магнитном поле',
  '165573::Движение заряда в магнитном поле',
])

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
  for (let index = 0; index < array.length; index += size) {
    result.push(array.slice(index, index + size))
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

function buildSuggestionMap(rows) {
  return new Map(rows.map(row => [row.task_id, row]))
}

function getPrimaryTopic(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.find(topic => topic.is_primary) || topics[0] || null
}

function getSecondaryTopics(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.filter(topic => !topic.is_primary)
}

function selectRows() {
  const classifyRows = readJsonl(CLASSIFY_FILE)
  const reclassifyRows = readJsonl(RECLASSIFY_FILE)
  const reclassifyByTaskId = buildSuggestionMap(reclassifyRows)
  const selectedRows = []
  const seenTaskIds = new Set()

  for (const row of classifyRows) {
    const preferred = reclassifyByTaskId.get(row.task_id) || row
    selectedRows.push(preferred)
    seenTaskIds.add(preferred.task_id)
  }

  for (const row of reclassifyRows) {
    if (!seenTaskIds.has(row.task_id)) {
      selectedRows.push(row)
      seenTaskIds.add(row.task_id)
    }
  }

  return {
    classifyRows,
    reclassifyRows,
    selectedRows,
    reclassifyTaskIds: new Set(reclassifyRows.map(row => row.task_id)),
  }
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

async function fetchLivePrimaryLinks(taskIds) {
  const rows = []
  for (const batch of chunk(taskIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id, is_primary, source')
      .in('task_id', batch)
      .eq('source', SOURCE_TAG)
      .eq('is_primary', true)

    if (error) throw error
    rows.push(...(data || []))
  }

  return Object.fromEntries(rows.map(row => [row.task_id, row]))
}

async function fetchTopicMap(topicIds) {
  if (topicIds.length === 0) return {}

  const topicRows = []
  for (const batch of chunk(topicIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_topics')
      .select('id, title, external_id, parent_id, subject, exam_type')
      .in('id', batch)

    if (error) throw error
    topicRows.push(...(data || []))
  }

  const filtered = topicRows.filter(row => row.subject === SUBJECT && row.exam_type === EXAM_TYPE)
  const parentIds = [...new Set(filtered.map(row => row.parent_id).filter(Boolean))]
  const parentRows = []

  for (const batch of chunk(parentIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_topics')
      .select('id, title')
      .in('id', batch)

    if (error) throw error
    parentRows.push(...(data || []))
  }

  const parentMap = Object.fromEntries(parentRows.map(row => [row.id, row.title]))
  return Object.fromEntries(filtered.map(row => [row.id, {
    ...row,
    parent_topic_title: row.parent_id ? parentMap[row.parent_id] || '' : '',
  }]))
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

function collectRawCandidates(selectedRows, reclassifyTaskIds, livePrimaryByTaskId, topicMap) {
  const rawCandidates = []

  for (const row of selectedRows) {
    const stagingPrimaryLink = getPrimaryTopic(row)
    const secondaries = getSecondaryTopics(row)
    const livePrimaryLink = livePrimaryByTaskId[row.task_id] || null
    const livePrimaryTopic = livePrimaryLink ? topicMap[livePrimaryLink.topic_id] || null : null
    const stagingPrimaryTopic = stagingPrimaryLink ? topicMap[stagingPrimaryLink.topic_id] || null : null

    for (const secondaryLink of secondaries) {
      const secondaryTopic = topicMap[secondaryLink.topic_id] || null
      rawCandidates.push({
        source_file: reclassifyTaskIds.has(row.task_id) ? 'reclassify' : 'classify',
        task_id: row.task_id,
        external_id: row.external_id,
        section_exam_number: row.section_exam_number ?? '',
        section_title: row.section_title ?? '',
        statement_text: row.statement_text || '',
        staging_primary_topic_id: stagingPrimaryLink?.topic_id ?? '',
        live_primary_topic_id: livePrimaryLink?.topic_id ?? '',
        live_primary_title: livePrimaryTopic?.title || '',
        live_primary_parent_title: livePrimaryTopic?.parent_topic_title || '',
        topic_id: secondaryLink.topic_id,
        secondary_topic_title: secondaryTopic?.title || '',
        secondary_parent_title: secondaryTopic?.parent_topic_title || '',
        confidence: secondaryLink.confidence,
        same_section: Boolean(
          livePrimaryTopic?.parent_id &&
          secondaryTopic?.parent_id &&
          livePrimaryTopic.parent_id === secondaryTopic.parent_id
        ),
        is_conflict: Boolean(livePrimaryLink && secondaryLink.topic_id === livePrimaryLink.topic_id),
        is_stale: Boolean(livePrimaryLink && stagingPrimaryLink && livePrimaryLink.topic_id !== stagingPrimaryLink.topic_id),
        is_stop_list: STOP_LIST.has(`${row.external_id}::${secondaryTopic?.title || ''}`),
      })
    }
  }

  return rawCandidates
}

function dedupeCandidates(rawCandidates) {
  const deduped = new Map()
  let duplicateCount = 0

  for (const candidate of rawCandidates) {
    const key = `${candidate.task_id}::${candidate.topic_id}`
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, candidate)
      continue
    }

    duplicateCount++
    if ((candidate.confidence ?? -Infinity) > (existing.confidence ?? -Infinity)) {
      deduped.set(key, candidate)
    }
  }

  return {
    dedupedCandidates: [...deduped.values()],
    duplicateCount,
  }
}

function buildExistingPairSet(existingLinks) {
  return new Set(existingLinks.map(link => `${link.task_id}::${link.topic_id}`))
}

async function prepareCandidates() {
  const { classifyRows, reclassifyRows, selectedRows, reclassifyTaskIds } = selectRows()
  const taskIds = [...new Set(selectedRows.map(row => row.task_id).filter(Boolean))]
  const externalIds = [...new Set(selectedRows.map(row => row.external_id).filter(value => Number.isFinite(value)))]

  const taskMapByExternalId = await fetchTaskMap(externalIds)
  const livePrimaryByTaskId = await fetchLivePrimaryLinks(taskIds)

  const topicIds = new Set()
  for (const row of selectedRows) {
    const stagingPrimary = getPrimaryTopic(row)
    const livePrimary = livePrimaryByTaskId[row.task_id]
    if (stagingPrimary?.topic_id) topicIds.add(stagingPrimary.topic_id)
    if (livePrimary?.topic_id) topicIds.add(livePrimary.topic_id)
    for (const secondary of getSecondaryTopics(row)) {
      if (secondary?.topic_id) topicIds.add(secondary.topic_id)
    }
  }

  const topicMap = await fetchTopicMap([...topicIds])
  const rawCandidates = collectRawCandidates(selectedRows, reclassifyTaskIds, livePrimaryByTaskId, topicMap)
  const { dedupedCandidates, duplicateCount } = dedupeCandidates(rawCandidates)

  const existingLinks = await fetchExistingLinks(taskIds)
  const existingPairSet = buildExistingPairSet(existingLinks)
  const existingLinksByTaskId = {}
  for (const link of existingLinks) {
    if (!existingLinksByTaskId[link.task_id]) existingLinksByTaskId[link.task_id] = []
    existingLinksByTaskId[link.task_id].push(link)
  }

  const rows = []
  const validRows = []
  const invalidReasons = {}
  const excludedCounts = {
    conflict: 0,
    stale: 0,
    stop_list: 0,
    already_exists: 0,
  }

  for (const candidate of dedupedCandidates) {
    const errors = []
    const exclusions = []
    const task = taskMapByExternalId[candidate.external_id]
    const topic = topicMap[candidate.topic_id] || null

    if (!task) {
      errors.push('TASK_NOT_FOUND')
    } else if (task.subject !== SUBJECT || task.exam_type !== EXAM_TYPE) {
      errors.push(`TASK_WRONG_SUBJECT_EXAM:${task.subject}/${task.exam_type}`)
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

    if (candidate.is_conflict) exclusions.push('EXCLUDED_CONFLICT')
    if (candidate.is_stale) exclusions.push('EXCLUDED_STALE')
    if (candidate.is_stop_list) exclusions.push('EXCLUDED_STOP_LIST')
    if (task && existingPairSet.has(`${task.id}::${candidate.topic_id}`)) exclusions.push('ALREADY_EXISTS_LIVE')

    const validationStatus = errors.length === 0 && exclusions.length === 0 ? 'OK' : 'SKIP'
    const row = {
      source_file: candidate.source_file,
      external_id: candidate.external_id,
      task_id: task?.id ?? candidate.task_id ?? '',
      topic_id: candidate.topic_id,
      secondary_topic_title: topic?.title ?? candidate.secondary_topic_title,
      secondary_parent_title: topic?.parent_topic_title ?? candidate.secondary_parent_title,
      live_primary_title: candidate.live_primary_title,
      live_primary_parent_title: candidate.live_primary_parent_title,
      confidence: candidate.confidence,
      same_section: candidate.same_section ? 'same' : 'cross',
      section_exam_number: candidate.section_exam_number,
      section_title: candidate.section_title,
      validation_status: validationStatus,
      validation_errors: errors.join('; '),
      skip_reason: exclusions.join('; '),
    }

    rows.push(row)

    if (errors.length > 0) {
      for (const error of errors) {
        invalidReasons[error] = (invalidReasons[error] || 0) + 1
      }
      continue
    }

    if (exclusions.length > 0) {
      for (const exclusion of exclusions) {
        if (exclusion === 'EXCLUDED_CONFLICT') excludedCounts.conflict++
        if (exclusion === 'EXCLUDED_STALE') excludedCounts.stale++
        if (exclusion === 'EXCLUDED_STOP_LIST') excludedCounts.stop_list++
        if (exclusion === 'ALREADY_EXISTS_LIVE') excludedCounts.already_exists++
      }
      continue
    }

    validRows.push({
      ...row,
      existing_links: existingLinksByTaskId[task.id] || [],
    })
  }

  return {
    classifyRows,
    reclassifyRows,
    selectedRows,
    rawCandidates,
    dedupedCandidates,
    duplicateCount,
    rows,
    validRows,
    invalidReasons,
    excludedCounts,
  }
}

function createSnapshot(validRows, meta) {
  const snapshot = {
    generated_at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    source: SOURCE_TAG,
    subject: SUBJECT,
    exam_type: EXAM_TYPE,
    total_rows_selected: meta.selectedRows.length,
    total_secondary_raw: meta.rawCandidates.length,
    total_secondary_deduped: meta.dedupedCandidates.length,
    dedupe_duplicates_removed: meta.duplicateCount,
    excluded_counts: meta.excludedCounts,
    valid_rows: validRows.length,
    tasks_affected: new Set(validRows.map(row => row.task_id)).size,
    rows: validRows.map(row => ({
      task_id: row.task_id,
      external_id: row.external_id,
      topic_id: row.topic_id,
      topic_title: row.secondary_topic_title,
      confidence: row.confidence,
      same_section: row.same_section,
      source_file: row.source_file,
      existing_links: row.existing_links,
    })),
  }

  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8')
  return snapshot
}

function buildDryRunCsv(rows) {
  writeCsv(
    DRY_RUN_CSV,
    [
      'source_file',
      'external_id',
      'task_id',
      'topic_id',
      'secondary_topic_title',
      'secondary_parent_title',
      'live_primary_title',
      'live_primary_parent_title',
      'confidence',
      'same_section',
      'section_exam_number',
      'section_title',
      'validation_status',
      'validation_errors',
      'skip_reason',
    ],
    rows,
  )
}

function summarizeByTopic(validRows) {
  const counts = {}
  for (const row of validRows) {
    const label = row.secondary_topic_title || row.topic_id
    counts[label] = (counts[label] || 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .map(([title, count]) => ({ title, count }))
}

async function applyRows(validRows) {
  const logRows = []
  let inserted = 0
  let skipped = 0
  let errors = 0

  const batches = chunk(validRows, APPLY_BATCH_SIZE)
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    const records = batch.map(row => ({
      task_id: row.task_id,
      topic_id: row.topic_id,
      is_primary: false,
      source: SOURCE_TAG,
    }))

    const { data, error } = await supabase
      .from('catalog_task_topics')
      .upsert(records, { onConflict: 'task_id,topic_id', ignoreDuplicates: true })
      .select('task_id, topic_id')

    if (error) {
      errors += batch.length
      for (const row of batch) {
        logRows.push({
          external_id: row.external_id,
          task_id: row.task_id,
          topic_id: row.topic_id,
          topic_title: row.secondary_topic_title,
          confidence: row.confidence,
          action: 'ERROR',
          error: error.message,
        })
      }
    } else {
      const insertedSet = new Set((data || []).map(row => `${row.task_id}::${row.topic_id}`))
      for (const row of batch) {
        const key = `${row.task_id}::${row.topic_id}`
        const wasInserted = insertedSet.has(key)
        if (wasInserted) inserted++
        else skipped++
        logRows.push({
          external_id: row.external_id,
          task_id: row.task_id,
          topic_id: row.topic_id,
          topic_title: row.secondary_topic_title,
          confidence: row.confidence,
          action: wasInserted ? 'INSERTED' : 'SKIPPED_ALREADY_EXISTS',
          error: '',
        })
      }
    }

    const processed = Math.min((index + 1) * APPLY_BATCH_SIZE, validRows.length)
    console.log(`Processed ${processed}/${validRows.length} secondary links`)
  }

  writeCsv(
    APPLY_LOG_CSV,
    ['external_id', 'task_id', 'topic_id', 'topic_title', 'confidence', 'action', 'error'],
    logRows,
  )

  return { inserted, skipped, errors, logRows }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))

  await verifySupabaseAccess()

  const prepared = await prepareCandidates()
  const snapshot = createSnapshot(prepared.validRows, prepared)
  buildDryRunCsv(prepared.rows)

  console.log(`classify rows: ${prepared.classifyRows.length}`)
  console.log(`reclassify rows: ${prepared.reclassifyRows.length}`)
  console.log(`selected rows: ${prepared.selectedRows.length}`)
  console.log(`raw secondary links: ${prepared.rawCandidates.length}`)
  console.log(`deduped secondary links: ${prepared.dedupedCandidates.length}`)
  console.log(`dedupe removed duplicates: ${prepared.duplicateCount}`)
  console.log(`excluded conflict: ${prepared.excludedCounts.conflict}`)
  console.log(`excluded stale: ${prepared.excludedCounts.stale}`)
  console.log(`excluded stop-list: ${prepared.excludedCounts.stop_list}`)
  console.log(`excluded already exists live: ${prepared.excludedCounts.already_exists}`)
  console.log(`validated OK (would insert): ${prepared.validRows.length}`)
  console.log(`tasks affected: ${snapshot.tasks_affected}`)

  if (Object.keys(prepared.invalidReasons).length > 0) {
    console.log('Validation FAIL reasons:')
    for (const [reason, count] of Object.entries(prepared.invalidReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`)
    }
  }

  const byTopic = summarizeByTopic(prepared.validRows)
  console.log(`Snapshot: ${SNAPSHOT_FILE}`)
  console.log(`Dry-run CSV: ${DRY_RUN_CSV}`)
  console.log('Top topics by growth:')
  for (const row of byTopic.slice(0, 20)) {
    console.log(`  ${row.title}: +${row.count}`)
  }

  if (!APPLY) {
    console.log('\nDry-run only. Для применения добавьте --apply.')
    return
  }

  const result = await applyRows(prepared.validRows)
  console.log(`Apply log: ${APPLY_LOG_CSV}`)
  console.log(`ГОТОВО: залито ${result.inserted}, пропущено ${result.skipped}, ошибок ${result.errors}`)
}

main().catch(error => {
  console.error('FATAL:')
  console.error(formatError(error))
  process.exit(1)
})
