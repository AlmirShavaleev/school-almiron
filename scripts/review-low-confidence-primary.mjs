import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const INPUT_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const DRY_RUN_PREVIEW_FILE = path.join(REPORTS_DIR, 'dry-run-preview.json')
const LOW_CONFIDENCE_OUTPUT_FILE = path.join(REPORTS_DIR, 'low-confidence-primary.md')
const NO_TOPIC_OUTPUT_FILE = path.join(REPORTS_DIR, 'no-topic-tasks.md')

const DEFAULT_THRESHOLD = 0.95
const SECTION_BY_TOPIC_BUCKET = {
  1: 'Механика',
  2: 'МКТ и термодинамика',
  3: 'Электростатика',
  4: 'Постоянный ток',
  5: 'Магнитное поле и электромагнитная индукция',
  6: 'Оптика',
  7: 'Квантовая физика',
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const thresholdIndex = args.indexOf('--threshold')
  let threshold = DEFAULT_THRESHOLD

  if (thresholdIndex !== -1) {
    threshold = Number(args[thresholdIndex + 1])
  }

  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('--threshold должен быть числом от 0 до 1')
  }

  return { threshold }
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

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function parseLocalTopicsCatalog() {
  if (!fs.existsSync(DRY_RUN_PREVIEW_FILE)) {
    return {}
  }

  const raw = JSON.parse(fs.readFileSync(DRY_RUN_PREVIEW_FILE, 'utf8'))
  const systemText = raw?.[0]?.payload_preview?.system?.[1]?.text ?? ''
  const lines = String(systemText).split(/\r?\n/)
  const topicMap = {}
  const lineRe = /^- ([0-9a-f-]+) \| external_id=(\d+) \| (.+)$/i

  for (const line of lines) {
    const match = lineRe.exec(line.trim())
    if (!match) continue

    const externalId = Number(match[2])
    const bucket = Math.floor((externalId - 900000) / 100)
    topicMap[match[1]] = {
      id: match[1],
      title: match[3],
      parentTitle: SECTION_BY_TOPIC_BUCKET[bucket] || 'Неизвестный раздел',
    }
  }

  return topicMap
}

async function fetchTopicMapFromSupabase(topicIds) {
  if (!serviceKey || topicIds.length === 0) return {}

  const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('catalog_topics')
    .select('id, title, parent_id')
    .in('id', topicIds)

  if (error) throw error

  const rows = data || []
  const parentIds = [...new Set(rows.map(row => row.parent_id).filter(Boolean))]

  let parentMap = {}
  if (parentIds.length > 0) {
    const { data: parentRows, error: parentError } = await supabase
      .from('catalog_topics')
      .select('id, title')
      .in('id', parentIds)

    if (parentError) throw parentError

    parentMap = Object.fromEntries((parentRows || []).map(row => [row.id, row.title]))
  }

  return Object.fromEntries(rows.map(row => [
    row.id,
    {
      id: row.id,
      title: row.title,
      parentTitle: row.parent_id ? parentMap[row.parent_id] || 'Без родительского раздела' : 'Без родительского раздела',
    },
  ]))
}

function getPrimaryTopic(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.find(topic => topic.is_primary) || topics[0] || null
}

function buildLowConfidenceMarkdown(rows, topicMap, threshold) {
  const themeCounts = new Map()
  const sectionCounts = new Map()
  const confidenceByTheme = new Map()
  const blocks = []

  for (const row of rows) {
    const primaryTopic = getPrimaryTopic(row)
    const topicMeta = topicMap[primaryTopic.topic_id] || {
      title: primaryTopic.topic_id,
      parentTitle: 'Неизвестный раздел',
    }

    themeCounts.set(topicMeta.title, (themeCounts.get(topicMeta.title) || 0) + 1)
    sectionCounts.set(topicMeta.parentTitle, (sectionCounts.get(topicMeta.parentTitle) || 0) + 1)
    if (!confidenceByTheme.has(topicMeta.title)) {
      confidenceByTheme.set(topicMeta.title, [])
    }
    confidenceByTheme.get(topicMeta.title).push(Number(primaryTopic.confidence ?? 0))

    blocks.push(`[${row.external_id}] conf ${formatConfidence(primaryTopic.confidence)} | primary: ${topicMeta.title} [${topicMeta.parentTitle}] | ${row.suggestion?.difficulty || 'не указана'}`)
    blocks.push(truncate(row.statement_text, 150))
    blocks.push(ensureSingleLine(row.suggestion?.reasoning || row.classifier_error || '—'))
    blocks.push('')
  }

  const themeLines = [...themeCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
    .map(([theme, count]) => {
      const values = confidenceByTheme.get(theme) || []
      return `- ${theme}: ${count}, avg conf ${formatConfidence(average(values))}`
    })

  const sectionLines = [...sectionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
    .map(([section, count]) => `- ${section}: ${count}`)

  const lines = [
    `# Low Confidence Primary Topics`,
    '',
    `Порог: primary confidence < ${formatConfidence(threshold)}`,
    `Задач ниже порога: ${rows.length}`,
    '',
    ...blocks,
    '## Сводка',
    `- Ниже порога: ${rows.length}`,
    '- Распределение по темам:',
    ...themeLines,
    '- Распределение по разделам:',
    ...sectionLines,
  ]

  return `${lines.join('\n').trim()}\n`
}

function buildNoTopicMarkdown(rows) {
  const blocks = [
    '# Tasks Without Live Topic',
    '',
    `Задач без темы в live: ${rows.length}`,
    '',
  ]

  for (const row of rows) {
    blocks.push(`- [${row.external_id}] ${truncate(row.statement_text, 150)}`)
    blocks.push(`  ${ensureSingleLine(row.statement_text)}`)
    blocks.push('')
  }

  return `${blocks.join('\n').trim()}\n`
}

async function main() {
  const { threshold } = parseArgs(process.argv)
  fs.mkdirSync(REPORTS_DIR, { recursive: true })

  const rows = readJsonl(INPUT_FILE)
  const noTopicRows = rows.filter(row => {
    const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
    return topics.length === 0
  })

  const lowConfidenceRows = rows
    .map(row => ({ row, primaryTopic: getPrimaryTopic(row) }))
    .filter(({ primaryTopic }) => primaryTopic && Number(primaryTopic.confidence ?? 0) < threshold)
    .sort((left, right) => {
      const confidenceDiff = Number(left.primaryTopic.confidence ?? 0) - Number(right.primaryTopic.confidence ?? 0)
      if (confidenceDiff !== 0) return confidenceDiff
      return (left.row.external_id ?? 0) - (right.row.external_id ?? 0)
    })
    .map(({ row }) => row)

  const localTopicMap = parseLocalTopicsCatalog()
  const topicIds = [...new Set(lowConfidenceRows.map(getPrimaryTopic).filter(Boolean).map(topic => topic.topic_id))]

  let topicMap = localTopicMap
  if (serviceKey) {
    try {
      topicMap = {
        ...localTopicMap,
        ...(await fetchTopicMapFromSupabase(topicIds)),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`⚠️  Не удалось резолвить темы из Supabase, использую локальный справочник: ${message}`)
    }
  }

  const lowConfidenceMarkdown = buildLowConfidenceMarkdown(lowConfidenceRows, topicMap, threshold)
  const noTopicMarkdown = buildNoTopicMarkdown(noTopicRows)

  fs.writeFileSync(LOW_CONFIDENCE_OUTPUT_FILE, lowConfidenceMarkdown, 'utf8')
  fs.writeFileSync(NO_TOPIC_OUTPUT_FILE, noTopicMarkdown, 'utf8')

  console.log(`threshold: ${formatConfidence(threshold)}`)
  console.log(`low-confidence primary rows: ${lowConfidenceRows.length}`)
  console.log(`no-topic rows: ${noTopicRows.length}`)
  console.log(`Markdown saved to ${LOW_CONFIDENCE_OUTPUT_FILE}`)
  console.log(`Markdown saved to ${NO_TOPIC_OUTPUT_FILE}`)
}

main().catch(error => {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    try {
      console.error(JSON.stringify(error, null, 2))
    } catch {
      console.error(String(error))
    }
  }
  process.exit(1)
})
