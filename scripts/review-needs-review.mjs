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
const OUTPUT_FILE = path.join(REPORTS_DIR, 'needs-review.md')

const SECTION_BY_TOPIC_BUCKET = {
  1: 'Механика',
  2: 'МКТ и термодинамика',
  3: 'Электростатика',
  4: 'Постоянный ток',
  5: 'Магнитное поле и электромагнитная индукция',
  6: 'Оптика',
  7: 'Квантовая физика',
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

function truncate(text = '', maxLength = 120) {
  const normalized = ensureSingleLine(text)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function formatConfidence(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
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
      external_id: externalId,
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

  if (error) {
    throw error
  }

  const rows = data || []
  const parentIds = [...new Set(rows.map(row => row.parent_id).filter(Boolean))]

  let parentMap = {}
  if (parentIds.length > 0) {
    const { data: parentRows, error: parentError } = await supabase
      .from('catalog_topics')
      .select('id, title')
      .in('id', parentIds)

    if (parentError) {
      throw parentError
    }

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

function buildGroups(rows, topicMap) {
  const groups = new Map()
  const sectionCounts = new Map()

  for (const row of rows) {
    const primaryTopic = getPrimaryTopic(row)
    const topicMeta = primaryTopic
      ? topicMap[primaryTopic.topic_id] || {
          title: primaryTopic.topic_id,
          parentTitle: 'Неизвестный раздел',
        }
      : {
          title: 'Без определённой темы',
          parentTitle: 'Неизвестный раздел',
        }

    const topicKey = primaryTopic?.topic_id || '__no_primary__'
    if (!groups.has(topicKey)) {
      groups.set(topicKey, {
        topicId: topicKey,
        title: topicMeta.title,
        parentTitle: topicMeta.parentTitle,
        items: [],
        confidences: [],
      })
    }

    const group = groups.get(topicKey)
    const confidence = Number(primaryTopic?.confidence ?? 0)
    group.items.push({
      external_id: row.external_id,
      statement: truncate(row.statement_text, 120),
      primaryTitle: topicMeta.title,
      confidence,
      difficulty: row.suggestion?.difficulty || 'не указана',
      reasoning: ensureSingleLine(row.suggestion?.reasoning || row.classifier_error || '—'),
      sectionTitle: topicMeta.parentTitle,
    })
    group.confidences.push(confidence)

    sectionCounts.set(topicMeta.parentTitle, (sectionCounts.get(topicMeta.parentTitle) || 0) + 1)
  }

  return { groups: [...groups.values()], sectionCounts }
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildMarkdown(rows, topicMap) {
  const { groups, sectionCounts } = buildGroups(rows, topicMap)

  for (const group of groups) {
    group.avgConfidence = average(group.confidences)
    group.items.sort((left, right) => (left.external_id ?? 0) - (right.external_id ?? 0))
  }

  groups.sort((left, right) => {
    if (right.items.length !== left.items.length) return right.items.length - left.items.length
    if (left.avgConfidence !== right.avgConfidence) return left.avgConfidence - right.avgConfidence
    return left.title.localeCompare(right.title, 'ru')
  })

  const themeLines = groups.map(group =>
    `- ${group.title} [${group.parentTitle}]: ${group.items.length} задач, avg conf ${formatConfidence(group.avgConfidence)}`
  )
  const sectionLines = [...sectionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ru'))
    .map(([section, count]) => `- ${section}: ${count}`)
  const lowConfidenceThemes = [...groups]
    .sort((left, right) => left.avgConfidence - right.avgConfidence || right.items.length - left.items.length)
    .slice(0, 10)
    .map(group => `- ${group.title} [${group.parentTitle}]: avg conf ${formatConfidence(group.avgConfidence)}, ${group.items.length} задач`)

  const blocks = []
  for (const group of groups) {
    blocks.push(`## ${group.title} (${group.items.length} задач)`)
    blocks.push(`_Раздел: ${group.parentTitle}. Средний confidence: ${formatConfidence(group.avgConfidence)}._`)
    for (const item of group.items) {
      blocks.push(`- [${item.external_id}] ${item.statement} | primary: ${item.primaryTitle} conf ${formatConfidence(item.confidence)} | ${item.difficulty} | ${item.reasoning}`)
    }
    blocks.push('')
  }

  const overallAvgConfidence = average(rows.map(row => Number(getPrimaryTopic(row)?.confidence ?? 0)))

  blocks.push('## Сводка')
  blocks.push(`- needs_review: ${rows.length}`)
  blocks.push(`- Средний confidence по primary теме: ${formatConfidence(overallAvgConfidence)}`)
  blocks.push('- Распределение по темам:')
  blocks.push(...themeLines)
  blocks.push('- Распределение по разделам:')
  blocks.push(...sectionLines)
  blocks.push('- Темы с наименьшим средним confidence:')
  blocks.push(...lowConfidenceThemes)

  return `${blocks.join('\n').trim()}\n`
}

async function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true })

  const rows = readJsonl(INPUT_FILE).filter(row => row?.suggestion?.needs_review === true)
  const localTopicMap = parseLocalTopicsCatalog()
  const topicIds = [...new Set(rows.map(getPrimaryTopic).filter(Boolean).map(topic => topic.topic_id))]

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

  const markdown = buildMarkdown(rows, topicMap)
  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8')

  console.log(`needs_review rows: ${rows.length}`)
  console.log(`Markdown saved to ${OUTPUT_FILE}`)
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
