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
const OUTPUT_FILE = path.join(REPORTS_DIR, 'duplicate-topics.md')

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

function groupByStatementHash(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = row.statement_hash
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()]
    .map(([statementHash, items]) => ({ statementHash, items }))
    .filter(group => group.items.length > 1)
}

function buildMarkdown(disagreeingGroups, summary) {
  const lines = [
    '# Duplicate Topics',
    '',
  ]

  for (const group of disagreeingGroups) {
    lines.push(`## statement_hash: ${group.statementHash} (${group.items.length} задач)`)
    lines.push(truncate(group.items[0]?.statement_text || '', 150))
    for (const item of group.items) {
      lines.push(`- [${item.external_id}] ${item.live_primary_title} | conf ${formatConfidence(item.jsonl_primary_confidence)} | ${truncate(item.statement_text, 150)}`)
    }
    lines.push('')
  }

  lines.push('## Сводка')
  lines.push(`- Групп всего: ${summary.totalGroups}`)
  lines.push(`- Согласных: ${summary.agreeingGroups}`)
  lines.push(`- Расходящихся: ${summary.disagreeingGroups}`)
  lines.push(`- Процент согласия: ${summary.agreementPercent}%`)

  return `${lines.join('\n').trim()}\n`
}

async function main() {
  const rows = readJsonl(INPUT_FILE)
  const grouped = groupByStatementHash(rows)
  const externalIds = [...new Set(grouped.flatMap(group => group.items.map(item => item.external_id)))]

  const taskMap = await fetchTaskMap(externalIds)
  const taskIds = [...new Set(Object.values(taskMap).map(task => task.id))]
  const livePrimaryLinks = await fetchLivePrimaryLinks(taskIds)
  const livePrimaryByTaskId = Object.fromEntries(livePrimaryLinks.map(link => [link.task_id, link]))
  const topicIds = [...new Set(livePrimaryLinks.map(link => link.topic_id))]
  const topicMap = await fetchTopicMap(topicIds)

  const agreeingGroups = []
  const disagreeingGroups = []

  for (const group of grouped) {
    const enrichedItems = group.items.map(item => {
      const task = taskMap[item.external_id]
      const livePrimaryLink = task ? livePrimaryByTaskId[task.id] : null
      const livePrimaryTopic = livePrimaryLink ? topicMap[livePrimaryLink.topic_id] : null
      const jsonlPrimary = getPrimaryTopicFromJsonl(item)

      return {
        ...item,
        task_id: task?.id ?? null,
        live_primary_topic_id: livePrimaryLink?.topic_id ?? null,
        live_primary_title: livePrimaryTopic?.title || 'Нет live primary',
        jsonl_primary_confidence: jsonlPrimary?.confidence ?? null,
      }
    })

    const uniqueLivePrimaryTitles = new Set(enrichedItems.map(item => item.live_primary_title))
    if (uniqueLivePrimaryTitles.size <= 1) {
      agreeingGroups.push({ statementHash: group.statementHash, items: enrichedItems })
    } else {
      disagreeingGroups.push({ statementHash: group.statementHash, items: enrichedItems })
    }
  }

  disagreeingGroups.sort((left, right) => right.items.length - left.items.length || left.statementHash.localeCompare(right.statementHash))

  const totalGroups = grouped.length
  const summary = {
    totalGroups,
    agreeingGroups: agreeingGroups.length,
    disagreeingGroups: disagreeingGroups.length,
    agreementPercent: totalGroups > 0 ? ((agreeingGroups.length / totalGroups) * 100).toFixed(1) : '0.0',
  }

  const markdown = buildMarkdown(disagreeingGroups, summary)
  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8')

  console.log(`Duplicate groups total: ${summary.totalGroups}`)
  console.log(`Agreeing groups: ${summary.agreeingGroups}`)
  console.log(`Disagreeing groups: ${summary.disagreeingGroups}`)
  console.log(`Agreement: ${summary.agreementPercent}%`)
  console.log(`Markdown saved to ${OUTPUT_FILE}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
