import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const INPUT_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const DRY_RUN_PREVIEW_FILE = path.join(REPORTS_DIR, 'dry-run-preview.json')
const OUTPUT_FILE = path.join(REPORTS_DIR, 'topic-gap-candidates.md')

const SECTION_BY_TOPIC_BUCKET = {
  1: 'Механика',
  2: 'МКТ и термодинамика',
  3: 'Электростатика',
  4: 'Постоянный ток',
  5: 'Магнитное поле и электромагнитная индукция',
  6: 'Оптика',
  7: 'Квантовая физика',
}

const GROUP_DEFS = [
  {
    key: 'hooke',
    title: '900130 Сила упругости, закон Гука',
    keywords: ['жёсткост', 'жесткост', 'пружин', 'закон гука', 'сила упругости', 'деформац', 'растяжен', 'н/м'],
  },
  {
    key: 'density',
    title: '900131 Плотность вещества',
    keywords: ['плотност', 'г/см', 'кг/м3', 'мензурк'],
  },
]

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

function getPrimaryTopic(row) {
  const topics = Array.isArray(row?.suggestion?.topics) ? row.suggestion.topics : []
  return topics.find(topic => topic.is_primary) || topics[0] || null
}

function matchesAnyKeyword(text, keywords) {
  const haystack = ensureSingleLine(text).toLowerCase()
  return keywords.some(keyword => haystack.includes(keyword))
}

function collectCandidates(rows, topicMap, groupDef) {
  const byCurrentTopic = new Map()
  let total = 0

  for (const row of rows) {
    const primaryTopic = getPrimaryTopic(row)
    if (!primaryTopic) continue
    if (!matchesAnyKeyword(row.statement_text, groupDef.keywords)) continue

    const topicMeta = topicMap[primaryTopic.topic_id] || {
      title: primaryTopic.topic_id,
      parentTitle: 'Неизвестный раздел',
    }

    const currentTopicKey = `${topicMeta.title} [${topicMeta.parentTitle}]`
    if (!byCurrentTopic.has(currentTopicKey)) {
      byCurrentTopic.set(currentTopicKey, [])
    }

    byCurrentTopic.get(currentTopicKey).push({
      external_id: row.external_id,
      confidence: Number(primaryTopic.confidence ?? 0),
      currentTopicTitle: topicMeta.title,
      statement: truncate(row.statement_text, 150),
    })
    total++
  }

  const groups = [...byCurrentTopic.entries()]
    .map(([currentTopicKey, items]) => ({
      currentTopicKey,
      items: items.sort((left, right) => {
        const confidenceDiff = left.confidence - right.confidence
        if (confidenceDiff !== 0) return confidenceDiff
        return (left.external_id ?? 0) - (right.external_id ?? 0)
      }),
    }))
    .sort((left, right) => {
      if (right.items.length !== left.items.length) return right.items.length - left.items.length
      return left.currentTopicKey.localeCompare(right.currentTopicKey, 'ru')
    })

  return { total, groups }
}

function buildMarkdown(resultsByGroup) {
  const lines = [
    '# Topic Gap Candidates',
    '',
    'Поиск кандидатов для новых тем 900130 "Сила упругости, закон Гука" и 900131 "Плотность вещества".',
    'Источник: reports/physics-ege/classify-suggestions.jsonl, только задачи с current primary.',
    '',
  ]

  for (const groupDef of GROUP_DEFS) {
    const result = resultsByGroup[groupDef.key]
    lines.push(`## ${groupDef.title} (${result.total} кандидатов)`)
    lines.push(`Ключевые слова: ${groupDef.keywords.join(', ')}`)
    lines.push('')

    for (const group of result.groups) {
      lines.push(`### Сейчас привязаны к: ${group.currentTopicKey} (${group.items.length})`)
      for (const item of group.items) {
        lines.push(`- [${item.external_id}] current primary: ${item.currentTopicTitle} | conf ${formatConfidence(item.confidence)} | ${item.statement}`)
      }
      lines.push('')
    }
  }

  lines.push('## Сводка')
  for (const groupDef of GROUP_DEFS) {
    const result = resultsByGroup[groupDef.key]
    lines.push(`- ${groupDef.title}: ${result.total} кандидатов`)
    for (const group of result.groups) {
      lines.push(`- ${group.currentTopicKey}: ${group.items.length}`)
    }
  }

  return `${lines.join('\n').trim()}\n`
}

function main() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true })

  const rows = readJsonl(INPUT_FILE)
  const withPrimary = rows.filter(row => getPrimaryTopic(row))
  const topicMap = parseLocalTopicsCatalog()

  const resultsByGroup = Object.fromEntries(
    GROUP_DEFS.map(groupDef => [groupDef.key, collectCandidates(withPrimary, topicMap, groupDef)])
  )

  const markdown = buildMarkdown(resultsByGroup)
  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8')

  console.log(`rows with primary: ${withPrimary.length}`)
  for (const groupDef of GROUP_DEFS) {
    console.log(`${groupDef.key}: ${resultsByGroup[groupDef.key].total}`)
  }
  console.log(`Markdown saved to ${OUTPUT_FILE}`)
}

try {
  main()
} catch (error) {
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
}
