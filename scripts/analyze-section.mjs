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
const DB_BATCH_SIZE = 50

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const INPUT_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')

function parseArgs(argv) {
  const args = argv.slice(2)
  const sectionIdx = args.indexOf('--section')
  if (sectionIdx === -1) {
    throw new Error('Нужно указать --section N')
  }

  const section = Number(args[sectionIdx + 1])
  if (!Number.isFinite(section) || section <= 0) {
    throw new Error('--section должен быть положительным числом')
  }

  return { section }
}

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
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size))
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

function getPrimaryTopicFromJsonl(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.find(topic => topic.is_primary) || topics[0] || null
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

  return Object.fromEntries(
    rows
      .filter(row => row.subject === SUBJECT && row.exam_type === EXAM_TYPE)
      .map(row => [row.external_id, row])
  )
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

  return rows
}

async function fetchTopicMap(topicIds) {
  const rows = []
  for (const batch of chunk(topicIds, DB_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from('catalog_topics')
      .select('id, title, external_id, subject, exam_type')
      .in('id', batch)

    if (error) throw error
    rows.push(...(data || []))
  }

  return Object.fromEntries(
    rows
      .filter(row => row.subject === SUBJECT && row.exam_type === EXAM_TYPE)
      .map(row => [row.id, row])
  )
}

function buildMarkdown(section, sectionRows, groupedTopics, averageConfidence) {
  const outputFile = path.join(REPORTS_DIR, `section-${section}-review.md`)
  const lines = [
    `# Section ${section} Review`,
    '',
  ]

  for (const group of groupedTopics) {
    lines.push(`## ${group.topicTitle} (${group.items.length})`)
    for (const item of group.items) {
      lines.push(`- [${item.external_id}] ${formatConfidence(item.confidence)} | ${truncate(item.statement_text, 150)}`)
    }
    lines.push('')
  }

  lines.push('## Сводка')
  lines.push(`- Задач в секции: ${sectionRows.length}`)
  lines.push(`- Разных current primary тем: ${groupedTopics.length}`)
  lines.push(`- Средний confidence: ${formatConfidence(averageConfidence)}`)
  lines.push('- Топ-5 тем:')
  for (const group of groupedTopics.slice(0, 5)) {
    lines.push(`- ${group.topicTitle}: ${group.items.length}`)
  }

  return { outputFile, markdown: `${lines.join('\n').trim()}\n` }
}

async function main() {
  const { section } = parseArgs(process.argv)
  const rows = readJsonl(INPUT_FILE).filter(row => row.section_exam_number === section)
  const externalIds = [...new Set(rows.map(row => row.external_id))]
  const taskMap = await fetchTaskMap(externalIds)
  const taskIds = [...new Set(Object.values(taskMap).map(task => task.id))]
  const livePrimaryLinks = await fetchLivePrimaryLinks(taskIds)
  const livePrimaryByTaskId = Object.fromEntries(livePrimaryLinks.map(link => [link.task_id, link]))
  const topicIds = [...new Set(livePrimaryLinks.map(link => link.topic_id))]
  const topicMap = await fetchTopicMap(topicIds)

  const enrichedRows = rows.map(row => {
    const task = taskMap[row.external_id]
    const livePrimaryLink = task ? livePrimaryByTaskId[task.id] : null
    const livePrimaryTopic = livePrimaryLink ? topicMap[livePrimaryLink.topic_id] : null
    const jsonlPrimary = getPrimaryTopicFromJsonl(row)
    return {
      ...row,
      live_primary_title: livePrimaryTopic?.title || 'Нет live primary',
      confidence: jsonlPrimary?.confidence ?? null,
    }
  })

  const groupsMap = new Map()
  for (const row of enrichedRows) {
    if (!groupsMap.has(row.live_primary_title)) {
      groupsMap.set(row.live_primary_title, [])
    }
    groupsMap.get(row.live_primary_title).push(row)
  }

  const groupedTopics = [...groupsMap.entries()]
    .map(([topicTitle, items]) => ({
      topicTitle,
      items: items
        .sort((left, right) => (left.external_id ?? 0) - (right.external_id ?? 0))
        .map(item => ({
          external_id: item.external_id,
          confidence: item.confidence,
          statement_text: item.statement_text,
        })),
    }))
    .sort((left, right) => right.items.length - left.items.length || left.topicTitle.localeCompare(right.topicTitle, 'ru'))

  const confidenceValues = enrichedRows
    .map(row => row.confidence)
    .filter(value => Number.isFinite(value))
  const averageConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0

  const { outputFile, markdown } = buildMarkdown(section, enrichedRows, groupedTopics, averageConfidence)
  fs.writeFileSync(outputFile, markdown, 'utf8')

  console.log(`Section: ${section}`)
  console.log(`Tasks: ${enrichedRows.length}`)
  console.log(`Distinct live primary topics: ${groupedTopics.length}`)
  console.log(`Average confidence: ${formatConfidence(averageConfidence)}`)
  console.log(`Markdown saved to ${outputFile}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
