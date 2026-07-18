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

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const INPUT_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const OUTPUT_FILE = path.join(REPORTS_DIR, 'pilot-review.md')

function truncate(text = '', maxLength = 200) {
  const normalized = String(text).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
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

async function fetchTopicMap(topicIds) {
  if (topicIds.length === 0) return {}

  const { data, error } = await supabase
    .from('catalog_topics')
    .select('id, title, parent_id')
    .in('id', topicIds)

  if (error) throw error

  const rows = data || []
  const parentIds = [...new Set(rows.map(row => row.parent_id).filter(Boolean))]

  let parentsById = {}
  if (parentIds.length > 0) {
    const { data: parentRows, error: parentError } = await supabase
      .from('catalog_topics')
      .select('id, title')
      .in('id', parentIds)

    if (parentError) throw parentError
    parentsById = Object.fromEntries((parentRows || []).map(row => [row.id, row]))
  }

  return Object.fromEntries(rows.map(row => [
    row.id,
    {
      title: row.title,
      parentTitle: row.parent_id ? parentsById[row.parent_id]?.title || 'Без родительского раздела' : 'Без родительского раздела',
    },
  ]))
}

function formatTopicLine(topic, topicMeta, isPrimary) {
  const star = isPrimary ? '★ ' : '  '
  const title = topicMeta?.title || topic.topic_id
  const parent = topicMeta?.parentTitle || 'Без родительского раздела'
  const confidence = Number.isFinite(topic.confidence) ? topic.confidence.toFixed(2) : '0.00'
  return `${star}${title} (conf ${confidence}) [${parent}]`
}

function buildMarkdown(rows, topicMap) {
  const sorted = [...rows].sort((left, right) => {
    const leftSection = left.section_exam_number ?? Number.MAX_SAFE_INTEGER
    const rightSection = right.section_exam_number ?? Number.MAX_SAFE_INTEGER
    if (leftSection !== rightSection) return leftSection - rightSection
    return (left.external_id ?? 0) - (right.external_id ?? 0)
  })

  const summary = {
    total: sorted.length,
    topicsTotal: 0,
    bySection: {},
    byDifficulty: {},
    needsReview: 0,
    parseFailed: 0,
  }

  const blocks = []

  for (const row of sorted) {
    const topics = Array.isArray(row.suggestion?.topics) ? row.suggestion.topics : []
    const primaryTopic = topics.find(topic => topic.is_primary)
    const secondaryTopics = topics.filter(topic => !topic.is_primary)
    const difficulty = row.suggestion?.difficulty || 'не указана'
    const difficultyConfidence = Number.isFinite(row.suggestion?.difficulty_confidence)
      ? row.suggestion.difficulty_confidence.toFixed(2)
      : '0.00'
    const reasoning = row.suggestion?.reasoning || '—'
    const sectionNumber = row.section_exam_number ?? '?'
    const sectionLabel = `№${sectionNumber}`

    summary.topicsTotal += topics.length
    summary.bySection[sectionLabel] = (summary.bySection[sectionLabel] || 0) + 1
    summary.byDifficulty[difficulty] = (summary.byDifficulty[difficulty] || 0) + 1
    if (row.suggestion?.needs_review) summary.needsReview++
    if (row.status === 'parse_failed' || row.suggestion?.validation_errors?.includes('parse_failed')) summary.parseFailed++

    const topicLines = []
    if (primaryTopic) {
      topicLines.push(`  ${formatTopicLine(primaryTopic, topicMap[primaryTopic.topic_id], true)}`)
    }
    for (const topic of secondaryTopics) {
      topicLines.push(`  ${formatTopicLine(topic, topicMap[topic.topic_id], false)}`)
    }
    if (topicLines.length === 0) {
      topicLines.push('  — тем нет')
    }

    blocks.push([
      '---',
      `[${row.external_id}] раздел №${sectionNumber}, картинок: ${row.png_count ?? 0}`,
      `Условие: ${truncate(row.statement_text)}`,
      'Темы:',
      ...topicLines,
      `Сложность: ${difficulty} (conf ${difficultyConfidence})`,
      `Обоснование: ${reasoning}`,
    ].join('\n'))
  }

  const avgTopics = summary.total > 0 ? (summary.topicsTotal / summary.total).toFixed(2) : '0.00'
  const sectionLines = Object.entries(summary.bySection)
    .sort((a, b) => Number(a[0].replace('№', '')) - Number(b[0].replace('№', '')))
    .map(([section, count]) => `- ${section}: ${count}`)
  const difficultyLines = Object.entries(summary.byDifficulty)
    .sort((a, b) => a[0].localeCompare(b[0], 'ru'))
    .map(([difficulty, count]) => `- ${difficulty}: ${count}`)

  const footer = [
    '---',
    '## Сводка',
    `- Задач: ${summary.total}`,
    `- Среднее число тем на задачу: ${avgTopics}`,
    `- needs_review: ${summary.needsReview}`,
    `- parse_failed: ${summary.parseFailed}`,
    '- Распределение по разделам:',
    ...sectionLines,
    '- Распределение по сложности:',
    ...difficultyLines,
  ].join('\n')

  return {
    markdown: [...blocks, footer].join('\n'),
    summary,
  }
}

async function main() {
  const rows = readJsonl(INPUT_FILE)
  const topicIds = [...new Set(
    rows.flatMap(row => Array.isArray(row.suggestion?.topics) ? row.suggestion.topics.map(topic => topic.topic_id) : [])
  )]

  const topicMap = await fetchTopicMap(topicIds)
  const { markdown } = buildMarkdown(rows, topicMap)

  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8')
  console.log(markdown)
  console.log(`\nMarkdown saved to ${OUTPUT_FILE}`)
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
