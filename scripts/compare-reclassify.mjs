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
const OLD_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const NEW_FILE = path.join(REPORTS_DIR, 'reclassify-suggestions.jsonl')
const OUTPUT_FILE = path.join(REPORTS_DIR, 'reclassify-diff.md')
const SUBJECT = 'Физика'
const EXAM_TYPE = 'ЕГЭ'
const DB_BATCH_SIZE = 50
const NEW_TOPIC_EXTERNAL_IDS = new Set([900130, 900131])

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

function getPrimaryTopic(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.find(topic => topic.is_primary) || topics[0] || null
}

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
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

  const filtered = rows.filter(row => row.subject === SUBJECT && row.exam_type === EXAM_TYPE)
  return Object.fromEntries(filtered.map(row => [row.id, row]))
}

function buildMarkdown(changedRows, unchangedCount, topicMap) {
  const newTopicCounts = new Map()
  let movedToHooke = 0
  let movedToDensity = 0
  let movedToOther = 0
  const lines = [
    '# Reclassify Diff',
    '',
  ]

  for (const row of changedRows) {
    const oldMeta = topicMap[row.oldPrimary.topic_id] || { title: row.oldPrimary.topic_id, external_id: null }
    const newMeta = topicMap[row.newPrimary.topic_id] || { title: row.newPrimary.topic_id, external_id: null }

    newTopicCounts.set(newMeta.title, (newTopicCounts.get(newMeta.title) || 0) + 1)
    if (newMeta.external_id === 900130) movedToHooke++
    else if (newMeta.external_id === 900131) movedToDensity++
    else movedToOther++

    lines.push(`- [${row.external_id}] было: ${oldMeta.title} (${formatConfidence(row.oldPrimary.confidence)}) -> стало: ${newMeta.title} (${formatConfidence(row.newPrimary.confidence)}) | ${truncate(row.statement_text, 150)}`)
  }

  lines.push('')
  lines.push('## Сводка')
  lines.push(`- Изменилось: ${changedRows.length}`)
  lines.push(`- Осталось прежним: ${unchangedCount}`)
  lines.push(`- Ушло в 900130 "Сила упругости, закон Гука": ${movedToHooke}`)
  lines.push(`- Ушло в 900131 "Плотность вещества": ${movedToDensity}`)
  lines.push(`- Ушло в другие темы: ${movedToOther}`)
  lines.push('- Распределение новых primary-тем:')
  for (const [title, count] of [...newTopicCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))) {
    lines.push(`- ${title}: ${count}`)
  }

  return `${lines.join('\n').trim()}\n`
}

async function main() {
  const oldRows = readJsonl(OLD_FILE)
  const newRows = readJsonl(NEW_FILE)
  const oldByExternalId = new Map(oldRows.map(row => [row.external_id, row]))

  const changedRows = []
  let unchangedCount = 0
  const topicIds = new Set()

  for (const newRow of newRows) {
    const oldRow = oldByExternalId.get(newRow.external_id)
    if (!oldRow) continue

    const oldPrimary = getPrimaryTopic(oldRow)
    const newPrimary = getPrimaryTopic(newRow)
    if (!oldPrimary || !newPrimary) continue

    topicIds.add(oldPrimary.topic_id)
    topicIds.add(newPrimary.topic_id)

    if (oldPrimary.topic_id !== newPrimary.topic_id) {
      changedRows.push({
        external_id: newRow.external_id,
        oldPrimary,
        newPrimary,
        statement_text: newRow.statement_text || oldRow.statement_text || '',
      })
    } else {
      unchangedCount++
    }
  }

  const topicMap = await fetchTopicMap([...topicIds])
  changedRows.sort((left, right) => (left.external_id ?? 0) - (right.external_id ?? 0))

  const markdown = buildMarkdown(changedRows, unchangedCount, topicMap)
  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8')

  console.log(`changed primary: ${changedRows.length}`)
  console.log(`unchanged primary: ${unchangedCount}`)
  console.log(`moved to 900130/900131 or other topics resolved from live DB`)
  console.log(`Markdown saved to ${OUTPUT_FILE}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
