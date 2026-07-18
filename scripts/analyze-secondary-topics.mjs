import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUBJECT = 'Физика'
const EXAM_TYPE = 'ЕГЭ'
const SOURCE_TAG = 'ai_physics_v1'
const DB_BATCH_SIZE = 50

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const CLASSIFY_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const RECLASSIFY_FILE = path.join(REPORTS_DIR, 'reclassify-suggestions.jsonl')
const OUTPUT_FILE = path.join(REPORTS_DIR, 'secondary-analysis.md')

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY не задан.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

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

function chunk(array, size) {
  const result = []
  for (let index = 0; index < array.length; index += size) {
    result.push(array.slice(index, index + size))
  }
  return result
}

function ensureSingleLine(text = '') {
  return String(text).replace(/\s+/g, ' ').trim()
}

function truncate(text = '', maxLength = 150) {
  const normalized = ensureSingleLine(text)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function formatConfidence(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
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

function formatTopic(topic) {
  if (!topic) return 'Нет темы [Без раздела]'
  return `${topic.title} [${topic.parent_title || 'Без раздела'}]`
}

function bucketConfidence(value) {
  if (!Number.isFinite(value)) return 'unknown'
  if (value >= 0.95) return '0.95+'
  if (value >= 0.9) return '0.90-0.94'
  if (value >= 0.85) return '0.85-0.89'
  return '<0.85'
}

function getPrimaryTopic(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.find(topic => topic.is_primary) || topics[0] || null
}

function getSecondaryTopics(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.filter(topic => !topic.is_primary)
}

function buildSuggestionMap(rows) {
  return new Map(rows.map(row => [row.task_id, row]))
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
    parent_title: row.parent_id ? parentMap[row.parent_id] || '' : '',
  }]))
}

function selectRows() {
  const classifyRows = readJsonl(CLASSIFY_FILE)
  const reclassifyRows = readJsonl(RECLASSIFY_FILE)
  const reclassifyByTaskId = buildSuggestionMap(reclassifyRows)
  const selected = []
  const seenTaskIds = new Set()

  for (const row of classifyRows) {
    const preferred = reclassifyByTaskId.get(row.task_id) || row
    selected.push(preferred)
    seenTaskIds.add(preferred.task_id)
  }

  for (const row of reclassifyRows) {
    if (!seenTaskIds.has(row.task_id)) {
      selected.push(row)
      seenTaskIds.add(row.task_id)
    }
  }

  return {
    classifyRows,
    reclassifyRows,
    selectedRows: selected,
    reclassifyTaskIds: new Set(reclassifyRows.map(row => row.task_id)),
  }
}

function buildMarkdown(summary, crossMatrix, suspiciousRows) {
  const lines = [
    '# Secondary Topics Analysis',
    '',
    '## Сводка',
    `- Всего сопутствующих связей: ${summary.totalSecondary}`,
    `- Конфликтуют с live primary (topic_id совпадает): ${summary.conflicts}`,
    `- Устаревшие (staging primary != live primary): ${summary.stale}`,
    `- Задач затронуто: ${summary.affectedTasks}`,
    '- Confidence:',
    `- 0.85-0.89: ${summary.confidenceBuckets['0.85-0.89']}`,
    `- 0.90-0.94: ${summary.confidenceBuckets['0.90-0.94']}`,
    `- 0.95+: ${summary.confidenceBuckets['0.95+']}`,
    '- Разделы:',
    `- same-раздел: ${summary.sameSection}`,
    `- cross-раздел: ${summary.crossSection}`,
    '',
    '## Cross-раздельность',
  ]

  if (crossMatrix.length === 0) {
    lines.push('_Cross-раздельных связей нет_')
  } else {
    for (const row of crossMatrix) {
      lines.push(`- ${row.primarySection} -> ${row.secondarySection}: ${row.count}`)
    }
  }

  lines.push('')
  lines.push('## Подозрительные')

  if (suspiciousRows.length === 0) {
    lines.push('_Подозрительных связей нет_')
  } else {
    for (const row of suspiciousRows) {
      lines.push(`- [${row.external_id}] primary: ${formatTopic(row.livePrimaryTopic)} -> сопутствующая: ${formatTopic(row.secondaryTopic)} conf ${formatConfidence(row.confidence)} | ${truncate(row.statement_text, 150)}`)
    }
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const { selectedRows, classifyRows, reclassifyRows, reclassifyTaskIds } = selectRows()
  const taskIds = [...new Set(selectedRows.map(row => row.task_id).filter(Boolean))]
  const livePrimaryByTaskId = await fetchLivePrimaryLinks(taskIds)

  const topicIds = new Set()
  for (const row of selectedRows) {
    const stagingPrimary = getPrimaryTopic(row)
    const secondaries = getSecondaryTopics(row)
    const livePrimary = livePrimaryByTaskId[row.task_id]

    if (stagingPrimary?.topic_id) topicIds.add(stagingPrimary.topic_id)
    if (livePrimary?.topic_id) topicIds.add(livePrimary.topic_id)
    for (const secondary of secondaries) {
      if (secondary?.topic_id) topicIds.add(secondary.topic_id)
    }
  }

  const topicMap = await fetchTopicMap([...topicIds])
  const analysisRows = []

  for (const row of selectedRows) {
    const stagingPrimaryLink = getPrimaryTopic(row)
    const secondaries = getSecondaryTopics(row)
    const livePrimaryLink = livePrimaryByTaskId[row.task_id] || null
    const livePrimaryTopic = livePrimaryLink ? topicMap[livePrimaryLink.topic_id] || null : null
    const stagingPrimaryTopic = stagingPrimaryLink ? topicMap[stagingPrimaryLink.topic_id] || null : null

    for (const secondaryLink of secondaries) {
      const secondaryTopic = topicMap[secondaryLink.topic_id] || null
      const sameSection = Boolean(
        livePrimaryTopic?.parent_id &&
        secondaryTopic?.parent_id &&
        livePrimaryTopic.parent_id === secondaryTopic.parent_id
      )
      const conflict = Boolean(livePrimaryLink && secondaryLink.topic_id === livePrimaryLink.topic_id)
      const stale = Boolean(livePrimaryLink && stagingPrimaryLink && livePrimaryLink.topic_id !== stagingPrimaryLink.topic_id)

      analysisRows.push({
        task_id: row.task_id,
        external_id: row.external_id,
        source_file: reclassifyTaskIds.has(row.task_id) ? 'reclassify' : 'classify',
        statement_text: row.statement_text || '',
        confidence: secondaryLink.confidence,
        sameSection,
        conflict,
        stale,
        livePrimaryTopic,
        stagingPrimaryTopic,
        secondaryTopic,
      })
    }
  }

  const confidenceBuckets = {
    '0.85-0.89': 0,
    '0.90-0.94': 0,
    '0.95+': 0,
  }
  let conflicts = 0
  let stale = 0
  let sameSection = 0
  let crossSection = 0
  const affectedTasks = new Set()
  const crossMatrixMap = new Map()

  for (const row of analysisRows) {
    affectedTasks.add(row.task_id)
    if (row.conflict) conflicts++
    if (row.stale) stale++

    const bucket = bucketConfidence(row.confidence)
    if (bucket in confidenceBuckets) confidenceBuckets[bucket]++

    if (row.sameSection) {
      sameSection++
    } else {
      crossSection++
      const primarySection = row.livePrimaryTopic?.parent_title || 'Без live раздела'
      const secondarySection = row.secondaryTopic?.parent_title || 'Без раздела'
      const key = `${primarySection} -> ${secondarySection}`
      crossMatrixMap.set(key, (crossMatrixMap.get(key) || 0) + 1)
    }
  }

  const crossMatrix = [...crossMatrixMap.entries()]
    .map(([pair, count]) => {
      const [primarySection, secondarySection] = pair.split(' -> ')
      return { primarySection, secondarySection, count }
    })
    .sort((left, right) => right.count - left.count || left.primarySection.localeCompare(right.primarySection, 'ru') || left.secondarySection.localeCompare(right.secondarySection, 'ru'))

  const suspiciousRows = analysisRows
    .filter(row => !row.sameSection && Number.isFinite(row.confidence) && row.confidence < 0.9)
    .sort((left, right) => (left.external_id ?? 0) - (right.external_id ?? 0))

  const summary = {
    totalSecondary: analysisRows.length,
    conflicts,
    stale,
    affectedTasks: affectedTasks.size,
    confidenceBuckets,
    sameSection,
    crossSection,
    classifyRows: classifyRows.length,
    reclassifyRows: reclassifyRows.length,
    selectedRows: selectedRows.length,
  }

  const markdown = buildMarkdown(summary, crossMatrix, suspiciousRows)
  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8')

  console.log(`classify rows: ${classifyRows.length}`)
  console.log(`reclassify rows: ${reclassifyRows.length}`)
  console.log(`selected rows: ${selectedRows.length}`)
  console.log(`secondary links: ${summary.totalSecondary}`)
  console.log(`conflicts: ${summary.conflicts}`)
  console.log(`stale: ${summary.stale}`)
  console.log(`cross-section: ${summary.crossSection}`)
  console.log(`suspicious: ${suspiciousRows.length}`)
  console.log(`Markdown saved to ${OUTPUT_FILE}`)
}

main().catch(error => {
  console.error(formatError(error))
  process.exit(1)
})
