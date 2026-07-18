/**
 * classify-physics-topics.mjs
 *
 * Пилотная классификация тем для задач Физики ЕГЭ.
 *
 * НИЧЕГО НЕ ПИШЕТ В БД:
 *   - только читает catalog_tasks / catalog_topics
 *   - только читает локальные PNG из IMAGES_DIR/<external_id>/
 *   - пишет staging-результат в reports/physics-ege/
 *
 * Требования к окружению:
 *   - SUPABASE_SERVICE_ROLE_KEY=<key>
 *   - ANTHROPIC_API_KEY=<key>
 *
 * Пример:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> ANTHROPIC_API_KEY=<key> \
 *   node scripts/classify-physics-topics.mjs --limit 20
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anthropicKey = process.env.ANTHROPIC_API_KEY

if (!serviceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY не задан.')
  process.exit(1)
}
if (!anthropicKey) {
  console.error('❌ ANTHROPIC_API_KEY не задан.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

const SUBJECT = 'Физика'
const EXAM_TYPE = 'ЕГЭ'
const TOPIC_EXTERNAL_ID_MIN = 900101
const TOPIC_EXTERNAL_ID_MAX = 900712
const EXCLUDED_SECTION_NUMBERS = new Set([18, 19])
const TASK_PAGE = 1000
const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const DEFAULT_SUGGESTIONS_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const EXPECTED_ALLOWED_TOPICS = 91
const IMAGES_DIR = 'D:/школково спарсенные файлы/shkolkovo_physics_catalog/outputs/shkolkovo_physics_images'
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5'
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_BETA = 'prompt-caching-2024-07-31'
const REALTIME_DELAY_MS = 150
const NETWORK_RETRY_DELAYS_MS = [2000, 5000, 10000]
const HAIKU_PRICING = {
  input_per_mtok_usd: 1,
  output_per_mtok_usd: 5,
  cache_write_per_mtok_usd: 1.25,
  cache_read_per_mtok_usd: 0.1,
}

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null
const DRY_RUN = args.includes('--dry-run')
const DEBUG_RAW = args.includes('--debug-raw')
const DIVERSE_SECTIONS = args.includes('--diverse-sections')
const externalIdsIdx = args.indexOf('--external-ids')
const fromFileIdx = args.indexOf('--from-file')
const outIdx = args.indexOf('--out')
const EXTERNAL_IDS_CLI = externalIdsIdx !== -1
  ? args[externalIdsIdx + 1]
      ?.split(',')
      .map(value => parseInt(value.trim(), 10))
      .filter(Number.isFinite) ?? []
  : []
const FROM_FILE = fromFileIdx !== -1 ? args[fromFileIdx + 1] : null
const OUT_FILE = outIdx !== -1 ? args[outIdx + 1] : DEFAULT_SUGGESTIONS_FILE

if (limitIdx !== -1 && (!Number.isFinite(LIMIT) || LIMIT <= 0)) {
  console.error('❌ --limit должен быть положительным числом.')
  process.exit(1)
}

if (externalIdsIdx !== -1 && EXTERNAL_IDS_CLI.length === 0) {
  console.error('❌ --external-ids должен содержать CSV-список numeric external_id.')
  process.exit(1)
}

if (fromFileIdx !== -1 && !FROM_FILE) {
  console.error('❌ --from-file требует путь к файлу.')
  process.exit(1)
}

if (outIdx !== -1 && !OUT_FILE) {
  console.error('❌ --out требует путь к output jsonl.')
  process.exit(1)
}

function deriveOutputPaths(outFilePath) {
  const parsed = path.parse(outFilePath)
  const ext = parsed.ext || '.jsonl'
  const stem = parsed.name
  const dir = parsed.dir || REPORTS_DIR
  return {
    suggestionsFile: outFilePath,
    summaryFile: path.join(dir, `${stem}-summary.json`),
    dryRunPreviewFile: path.join(dir, `${stem}-dry-run-preview.json`),
    rawDebugFile: path.join(dir, `${stem}-raw-response-debug.json`),
    failedTasksFile: path.join(dir, `${stem}-failed-tasks.json`),
    last403File: path.join(dir, `${stem}-last-403.json`),
    extension: ext,
  }
}

const OUTPUT_PATHS = deriveOutputPaths(OUT_FILE)
const SUGGESTIONS_FILE = OUTPUT_PATHS.suggestionsFile
const SUMMARY_FILE = OUTPUT_PATHS.summaryFile
const DRY_RUN_PREVIEW_FILE = OUTPUT_PATHS.dryRunPreviewFile
const RAW_DEBUG_FILE = OUTPUT_PATHS.rawDebugFile
const FAILED_TASKS_FILE = OUTPUT_PATHS.failedTasksFile
const LAST_403_FILE = OUTPUT_PATHS.last403File

function readExternalIdsFromFile(filePath) {
  const resolved = path.resolve(filePath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Не найден файл для --from-file: ${resolved}`)
  }

  const content = fs.readFileSync(resolved, 'utf8')
  const ids = content
    .split(/\r?\n/)
    .map(line => {
      const match = line.match(/^- \[(\d+)\] /)
      return match ? parseInt(match[1], 10) : null
    })
    .filter(Number.isFinite)

  return [...new Set(ids)]
}

const EXTERNAL_IDS = (() => {
  const ids = [...EXTERNAL_IDS_CLI]
  if (FROM_FILE) {
    ids.push(...readExternalIdsFromFile(FROM_FILE))
  }
  return [...new Set(ids)]
})()

fs.mkdirSync(REPORTS_DIR, { recursive: true })

function decodeHtmlEntities(input = '') {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
}

function stripHtmlKeepImgAlt(html = '') {
  const withAlt = String(html).replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, (_, alt) => {
    const cleanedAlt = decodeHtmlEntities(alt).replace(/\s+/g, ' ').trim()
    return cleanedAlt ? ` [${cleanedAlt}] ` : ' '
  })

  return decodeHtmlEntities(withAlt)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function ensureSingleLine(text = '') {
  return String(text).replace(/\s+/g, ' ').trim()
}

function hashStatement(text = '') {
  return crypto.createHash('sha1').update(ensureSingleLine(text)).digest('hex')
}

function hasPicMarker(text = '') {
  return String(text).includes('[PIC]')
}

function listImageFiles(externalId) {
  const dir = path.join(IMAGES_DIR, String(externalId))
  if (!fs.existsSync(dir)) {
    return { pngPaths: [], filteredOutSvg: [], otherFiles: [] }
  }

  const files = fs.readdirSync(dir).sort()
  const pngPaths = []
  const filteredOutSvg = []
  const otherFiles = []

  for (const name of files) {
    const lower = name.toLowerCase()
    const absPath = path.join(dir, name)
    if (lower.endsWith('.png')) {
      pngPaths.push(absPath)
    } else if (lower.endsWith('.svg')) {
      filteredOutSvg.push(absPath)
    } else {
      otherFiles.push(absPath)
    }
  }

  return { pngPaths, filteredOutSvg, otherFiles }
}

function toBase64Png(imagePath) {
  return fs.readFileSync(imagePath).toString('base64')
}

function estimateTextTokens(text = '') {
  return Math.ceil(String(text).length / 4)
}

function estimateImageTokens(fileBytes = 0) {
  return Math.ceil(fileBytes / 750)
}

function maskKey(value) {
  if (!value) return ''
  if (value.length <= 10) return `${value.slice(0, 2)}***${value.slice(-2)}`
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function parseClaudeJson(text) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1))
  }

  throw new Error('Claude response does not contain valid JSON')
}

function normalizeSuggestion(raw, allowedTopicIds) {
  const validDifficulties = new Set(['лёгкая', 'средняя', 'сложная'])
  const topics = Array.isArray(raw?.topics) ? raw.topics.slice(0, 3) : []

  const normalizedTopics = topics
    .map((topic, index) => ({
      topic_id: String(topic?.topic_id || ''),
      confidence: Number(topic?.confidence ?? 0),
      is_primary: Boolean(topic?.is_primary),
      position: index + 1,
    }))
    .filter(topic => allowedTopicIds.has(topic.topic_id))
    .map(topic => ({
      ...topic,
      confidence: Number.isFinite(topic.confidence)
        ? Math.max(0, Math.min(1, topic.confidence))
        : 0,
    }))
    .filter((topic, index) => topic.is_primary || index === 0 || topic.confidence >= 0.85)

  let validationErrors = []
  if (topics.length !== normalizedTopics.length) {
    validationErrors.push('invalid_topic_id_filtered')
  }
  if (normalizedTopics.length > 3) {
    validationErrors.push('too_many_topics')
  }

  let primaryCount = normalizedTopics.filter(topic => topic.is_primary).length
  if (normalizedTopics.length > 0 && primaryCount !== 1) {
    normalizedTopics.forEach((topic, index) => { topic.is_primary = index === 0 })
    primaryCount = 1
    validationErrors.push('primary_repaired')
  }

  const difficulty = validDifficulties.has(raw?.difficulty) ? raw.difficulty : 'средняя'
  if (!validDifficulties.has(raw?.difficulty)) {
    validationErrors.push('difficulty_repaired')
  }

  const difficultyConfidenceRaw = Number(raw?.difficulty_confidence ?? 0)
  const difficulty_confidence = Number.isFinite(difficultyConfidenceRaw)
    ? Math.max(0, Math.min(1, difficultyConfidenceRaw))
    : 0

  const reasoning = ensureSingleLine(raw?.reasoning || '')
  const needs_review = Boolean(raw?.needs_review) || normalizedTopics.length === 0 || validationErrors.length > 0

  return {
    topics: normalizedTopics.map(({ position, ...topic }) => topic),
    difficulty,
    difficulty_confidence,
    reasoning,
    needs_review,
    validation_errors: validationErrors,
  }
}

async function fetchAllCandidateTasks() {
  const rows = []
  let page = 0

  while (true) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select(`
        id,
        external_id,
        position,
        statement_html,
        source_url,
        catalog_sections!inner(
          id,
          title,
          exam_number
        )
      `)
      .eq('subject', SUBJECT)
      .eq('exam_type', EXAM_TYPE)
      .range(page * TASK_PAGE, page * TASK_PAGE + TASK_PAGE - 1)

    if (error) throw error
    if (!data?.length) break

    const filtered = data.filter(row => {
      const examNumber = row.catalog_sections?.exam_number
      return !EXCLUDED_SECTION_NUMBERS.has(examNumber)
    })

    rows.push(...filtered)

    if (LIMIT && rows.length >= LIMIT && !DIVERSE_SECTIONS) {
      return rows.slice(0, LIMIT)
    }

    if (data.length < TASK_PAGE) break
    page++
  }

  return rows
}

function prioritizeTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftMedia = getTaskMediaFlags(left)
    const rightMedia = getTaskMediaFlags(right)
    if (rightMedia.priorityScore !== leftMedia.priorityScore) return rightMedia.priorityScore - leftMedia.priorityScore

    const leftSection = left.catalog_sections?.exam_number ?? Number.MAX_SAFE_INTEGER
    const rightSection = right.catalog_sections?.exam_number ?? Number.MAX_SAFE_INTEGER
    if (leftSection !== rightSection) return leftSection - rightSection

    return (left.position ?? 0) - (right.position ?? 0)
  })
}

function getTaskMediaFlags(task) {
  const { pngPaths, filteredOutSvg } = listImageFiles(task.external_id)
  const statementText = stripHtmlKeepImgAlt(task.statement_html)
  const hasPic = hasPicMarker(statementText)
  const hasPng = pngPaths.length > 0
  const hasSvgOnly = hasPic && !hasPng && filteredOutSvg.length > 0
  const section = task.catalog_sections?.exam_number ?? null
  const preferredSections = new Set([4, 11, 12, 13, 14, 15, 16, 17])
  const priorityScore =
    (preferredSections.has(section) ? 100 : 0) +
    (hasPng ? 10 : 0) +
    (hasSvgOnly ? 5 : 0)

  return {
    statementText,
    hasPic,
    hasPng,
    hasSvgOnly,
    pngPaths,
    filteredOutSvg,
    priorityScore,
  }
}

function selectDiverseTasks(tasks, limit) {
  if (!limit || tasks.length <= limit) return tasks

  const prioritized = prioritizeTasks(tasks)
  const bySection = new Map()
  for (const task of prioritized) {
    const sectionNumber = task.catalog_sections?.exam_number ?? null
    if (!bySection.has(sectionNumber)) bySection.set(sectionNumber, [])
    bySection.get(sectionNumber).push(task)
  }

  const preferredSections = [11, 12, 13, 14, 15, 16, 17, 4]
  const sectionOrder = [
    ...preferredSections.filter(section => bySection.has(section)),
    ...[...bySection.keys()].filter(section => !preferredSections.includes(section)).sort((a, b) => a - b),
  ]

  const selected = []
  const selectedIds = new Set()
  const targetDistinctSections = Math.min(sectionOrder.length, Math.max(10, Math.min(12, limit)))
  const sectionsToUse = sectionOrder.slice(0, targetDistinctSections)

  const takeFromSection = (sectionNumber, count) => {
    const tasksInSection = bySection.get(sectionNumber) || []
    for (const task of tasksInSection) {
      if (selected.length >= limit) return
      if (selectedIds.has(task.id)) continue
      selected.push(task)
      selectedIds.add(task.id)
      if (count !== null) {
        count--
        if (count <= 0) return
      }
    }
  }

  for (const sectionNumber of sectionsToUse) {
    takeFromSection(sectionNumber, 2)
  }

  for (const sectionNumber of sectionsToUse) {
    if (selected.length >= limit) break
    takeFromSection(sectionNumber, 1)
  }

  if (selected.length < limit) {
    for (const task of prioritized) {
      if (selected.length >= limit) break
      if (selectedIds.has(task.id)) continue
      selected.push(task)
      selectedIds.add(task.id)
    }
  }

  return selected.slice(0, limit)
}

async function fetchTasksByExternalIds(externalIds) {
  const { data, error } = await supabase
    .from('catalog_tasks')
    .select(`
      id,
      external_id,
      position,
      statement_html,
      source_url,
      catalog_sections!inner(
        id,
        title,
        exam_number
      )
    `)
    .in('external_id', externalIds)

  if (error) throw error

  const filtered = (data || []).filter(row => {
    const examNumber = row.catalog_sections?.exam_number
    return !EXCLUDED_SECTION_NUMBERS.has(examNumber)
  })

  return externalIds
    .map(externalId => filtered.find(row => row.external_id === externalId))
    .filter(Boolean)
}

async function fetchAllowedTopics() {
  const { data, error } = await supabase
    .from('catalog_topics')
    .select('id, external_id, title')
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)
    .gte('external_id', TOPIC_EXTERNAL_ID_MIN)
    .lte('external_id', TOPIC_EXTERNAL_ID_MAX)
    .order('external_id')

  if (error) throw error
  return data || []
}

function buildTopicsPrompt(topics) {
  return topics
    .map(topic => `- ${topic.id} | external_id=${topic.external_id} | ${topic.title}`)
    .join('\n')
}

function buildPayloadForTask(task, topicPrompt, pngPaths) {
  const taskText = stripHtmlKeepImgAlt(task.statement_html)
  const content = [
    {
      type: 'text',
      text: [
        'Классифицируй задачу по темам физики ЕГЭ.',
        'Верни ТОЛЬКО валидный JSON-объект.',
        'Без markdown, без тройных кавычек, без текста до или после.',
        'Основную тему (is_primary) выбирай всегда.',
        'Сопутствующие темы добавляй ТОЛЬКО если задача явно комбинированная и для решения действительно нужны несколько тем.',
        'Простая моно-темная задача должна иметь ровно 1 тему.',
        'Перед добавлением 2-й или 3-й темы проверь: эта тема действительно НЕОБХОДИМА для решения, или она просто рядом по смыслу.',
        'Не добавляй сопутствующую тему, если уверенность в ней не выше 0.85.',
        'Максимум 3 темы.',
        'Если не уверен, ставь needs_review=true.',
        '',
        `TASK_EXTERNAL_ID: ${task.external_id}`,
        `SECTION_EXAM_NUMBER: ${task.catalog_sections?.exam_number ?? ''}`,
        `SECTION_TITLE: ${task.catalog_sections?.title ?? ''}`,
        `SOURCE_URL: ${task.source_url ?? ''}`,
        '',
        'ТЕКСТ ЗАДАЧИ:',
        taskText || '(пусто)',
        '',
        'Формат ответа:',
        '{"topics":[{"topic_id":"...","confidence":0.0,"is_primary":true}],"difficulty":"лёгкая|средняя|сложная","difficulty_confidence":0.0,"reasoning":"одна строка","needs_review":false}',
      ].join('\n'),
    },
  ]

  for (const pngPath of pngPaths) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: toBase64Png(pngPath),
      },
    })
  }

  content.push({
    type: 'text',
    text: 'Выбирай topic_id ТОЛЬКО из списка разрешённых тем из system prompt.',
  })

  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 900,
    temperature: 0,
    system: [
      {
        type: 'text',
        text: [
          'Ты аккуратный классификатор задач ЕГЭ по физике.',
          'Нельзя выдумывать новые topic_id.',
          'Если тема неочевидна или требуется ручная проверка, ставь needs_review=true.',
          'Ровно одна тема должна иметь is_primary=true, если topics не пустой.',
        ].join('\n'),
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: `Разрешённые темы:\n${topicPrompt}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content }],
  }

  return { payload, taskText }
}

function buildDryRunPreview(task, topicPrompt, pngPaths, filteredOutSvg, otherFiles, topics) {
  const { payload, taskText } = buildPayloadForTask(task, topicPrompt, pngPaths)
  const imageDebug = pngPaths.map(pngPath => {
    const stats = fs.statSync(pngPath)
    const base64 = toBase64Png(pngPath)
    return {
      file_name: path.basename(pngPath),
      file_size_bytes: stats.size,
      base64_length: base64.length,
      media_type: 'image/png',
    }
  })

  const systemText = payload.system.map(block => block.text).join('\n')
  const userTextBlocks = payload.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')

  const estimatedTokens = {
    system_text: estimateTextTokens(systemText),
    user_text: estimateTextTokens(userTextBlocks),
    images: imageDebug.reduce((sum, image) => sum + estimateImageTokens(image.file_size_bytes), 0),
  }

  return {
    external_id: task.external_id,
    section_exam_number: task.catalog_sections?.exam_number ?? null,
    section_title: task.catalog_sections?.title ?? '',
    source_url: task.source_url ?? null,
    cleaned_statement_text: taskText,
    attached_images: imageDebug,
    svg_filtered_out: filteredOutSvg.map(svgPath => path.basename(svgPath)),
    other_non_png_files_ignored: otherFiles.map(filePath => path.basename(filePath)),
    svg_were_filtered: filteredOutSvg.length > 0,
    allowed_topics_count: topics.length,
    approx_request_tokens: {
      ...estimatedTokens,
      total: estimatedTokens.system_text + estimatedTokens.user_text + estimatedTokens.images,
    },
    request_headers_preview: {
      'content-type': 'application/json',
      'x-api-key': maskKey(anthropicKey),
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': ANTHROPIC_BETA,
    },
    payload_preview: payload,
  }
}

function readExistingJsonl(filePath) {
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function readFailedTasks(filePath) {
  if (!fs.existsSync(filePath)) return []
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

function writeFailedTasks(filePath, failedTasks) {
  fs.writeFileSync(filePath, JSON.stringify(failedTasks, null, 2), 'utf-8')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getRetryAfterMs(response) {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const dateMs = Date.parse(header)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return null
}

function classifyFailure(error) {
  if (error?.name === 'ForbiddenAnthropicError') return 'forbidden'
  if (error?.name === 'RateLimitAnthropicError') return 'rate_limit'
  if (error?.name === 'NetworkAnthropicError') return 'network'
  if (error?.name === 'ParseFailedError') return 'parse_failed'
  if (error?.name === 'EmptyTopicsAnthropicError') return 'empty_topics'
  return 'other'
}

function buildFailureRecord(task, statementText, pngPaths, error) {
  return {
    external_id: task.external_id,
    task_id: task.id,
    section_exam_number: task.catalog_sections?.exam_number ?? null,
    section_title: task.catalog_sections?.title ?? '',
    source_url: task.source_url ?? null,
    statement_hash: hashStatement(statementText),
    png_count: pngPaths.length,
    error_type: classifyFailure(error),
    error_message: error instanceof Error ? error.message : String(error),
    failed_at: new Date().toISOString(),
  }
}

async function callAnthropicForTask(task, topicPrompt, pngPaths, rawDebugRows) {
  const { payload } = buildPayloadForTask(task, topicPrompt, pngPaths)
  const requestHeaders = {
    'content-type': 'application/json',
    'x-api-key': anthropicKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': ANTHROPIC_BETA,
  }

  for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt++) {
    let response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      })
    } catch (error) {
      if (attempt < NETWORK_RETRY_DELAYS_MS.length) {
        await sleep(NETWORK_RETRY_DELAYS_MS[attempt])
        continue
      }
      const networkError = new Error(error instanceof Error ? error.message : 'fetch failed')
      networkError.name = 'NetworkAnthropicError'
      throw networkError
    }

    if (response.status === 403) {
      const body = await response.text()
      const forbiddenError = new Error(`Anthropic 403: ${body.slice(0, 1000)}`)
      forbiddenError.name = 'ForbiddenAnthropicError'
      forbiddenError.response_body = body
      throw forbiddenError
    }

    if (response.status === 429) {
      const retryAfterMs = getRetryAfterMs(response) ?? NETWORK_RETRY_DELAYS_MS[Math.min(attempt, NETWORK_RETRY_DELAYS_MS.length - 1)]
      if (attempt < NETWORK_RETRY_DELAYS_MS.length) {
        await sleep(retryAfterMs)
        continue
      }
      const body = await response.text()
      const rateLimitError = new Error(`Anthropic 429: ${body.slice(0, 1000)}`)
      rateLimitError.name = 'RateLimitAnthropicError'
      rateLimitError.response_body = body
      throw rateLimitError
    }

    if (response.status >= 500) {
      if (attempt < NETWORK_RETRY_DELAYS_MS.length) {
        await sleep(NETWORK_RETRY_DELAYS_MS[attempt])
        continue
      }
      const body = await response.text()
      const networkError = new Error(`Anthropic ${response.status}: ${body.slice(0, 1000)}`)
      networkError.name = 'NetworkAnthropicError'
      throw networkError
    }

    if (!response.ok) {
      const body = await response.text()
      const otherError = new Error(`Anthropic ${response.status}: ${body.slice(0, 1000)}`)
      otherError.name = 'AnthropicHttpError'
      throw otherError
    }

    const json = await response.json()
    const text = (json?.content || [])
      .filter(block => block?.type === 'text')
      .map(block => block.text)
      .join('\n')

    const usage = json?.usage || {}
    const cacheUsage = {
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    }
    const normalizedUsage = {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      ...cacheUsage,
    }

    rawDebugRows.push({
      external_id: task.external_id,
      raw_envelope: json,
      raw_model_text: text,
      usage,
      attempt: attempt + 1,
      requested_topics_count: topicPrompt.split('\n').length,
      payload_system_topic_block_length: topicPrompt.length,
    })

    if (!text.trim()) {
      if (attempt < NETWORK_RETRY_DELAYS_MS.length) {
        await sleep(NETWORK_RETRY_DELAYS_MS[attempt])
        continue
      }
      const emptyTopicsError = new Error('Anthropic returned empty text response')
      emptyTopicsError.name = 'EmptyTopicsAnthropicError'
      emptyTopicsError.token_usage = normalizedUsage
      throw emptyTopicsError
    }

    let parsed
    try {
      parsed = parseClaudeJson(text)
    } catch (error) {
      const parseError = new Error(error instanceof Error ? error.message : 'parse_failed')
      parseError.name = 'ParseFailedError'
      parseError.raw_model_text = text
      parseError.token_usage = normalizedUsage
      throw parseError
    }

    const rawTopics = Array.isArray(parsed?.topics) ? parsed.topics : []
    if (rawTopics.length === 0) {
      if (attempt < NETWORK_RETRY_DELAYS_MS.length) {
        await sleep(NETWORK_RETRY_DELAYS_MS[attempt])
        continue
      }
      const emptyTopicsError = new Error('Anthropic returned topics=[] after retries')
      emptyTopicsError.name = 'EmptyTopicsAnthropicError'
      emptyTopicsError.raw_model_text = text
      emptyTopicsError.token_usage = normalizedUsage
      throw emptyTopicsError
    }

    return {
      parsed,
      raw_model_text: text,
      usage: normalizedUsage,
    }
  }

  const fallbackError = new Error('Anthropic request exhausted retries')
  fallbackError.name = 'NetworkAnthropicError'
  throw fallbackError
}

function buildSummary(results, topicsById) {
  const difficultyCounts = { лёгкая: 0, средняя: 0, сложная: 0 }
  const primaryTopicCounts = {}
  const allTopicCounts = {}
  const sectionCounts = {}
  let needsReview = 0
  let ok = 0
  let parseFailed = 0
  let classifierErrors = 0
  let hasPicNoPng = 0
  let totalTopics = 0
  let borderlineSecondaryTopics = 0
  let zeroTopics = 0
  const tokenTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
  const statementHashCounts = {}

  for (const row of results) {
    if (row.status === 'ok') ok++
    if (row.status === 'parse_failed') parseFailed++
    if (row.status === 'classifier_error') classifierErrors++
    if (row.has_pic_no_png) hasPicNoPng++
    if (row.suggestion.needs_review) needsReview++
    totalTopics += row.suggestion.topics.length
    if (row.suggestion.topics.length === 0) zeroTopics++
    const sectionKey = String(row.section_exam_number ?? 'unknown')
    sectionCounts[sectionKey] = (sectionCounts[sectionKey] || 0) + 1
    difficultyCounts[row.suggestion.difficulty] = (difficultyCounts[row.suggestion.difficulty] || 0) + 1
    tokenTotals.input_tokens += row.token_usage?.input_tokens ?? 0
    tokenTotals.output_tokens += row.token_usage?.output_tokens ?? 0
    tokenTotals.cache_creation_input_tokens += row.token_usage?.cache_creation_input_tokens ?? 0
    tokenTotals.cache_read_input_tokens += row.token_usage?.cache_read_input_tokens ?? 0
    const statementHash = row.statement_hash || hashStatement(row.statement_text)
    statementHashCounts[statementHash] = (statementHashCounts[statementHash] || 0) + 1

    for (const topic of row.suggestion.topics) {
      const label = topicsById[topic.topic_id]?.title || topic.topic_id
      allTopicCounts[label] = (allTopicCounts[label] || 0) + 1
      if (!topic.is_primary && topic.confidence >= 0.85 && topic.confidence < 0.9) {
        borderlineSecondaryTopics++
      }
      if (topic.is_primary) {
        primaryTopicCounts[label] = (primaryTopicCounts[label] || 0) + 1
      }
    }
  }

  const duplicateHashes = Object.values(statementHashCounts).filter(count => count > 1)
  const duplicatedTasks = duplicateHashes.reduce((sum, count) => sum + count, 0)
  const avgTopicsPerTask = results.length ? totalTopics / results.length : 0
  const estimatedCostUsd =
    (tokenTotals.input_tokens / 1_000_000) * HAIKU_PRICING.input_per_mtok_usd +
    (tokenTotals.output_tokens / 1_000_000) * HAIKU_PRICING.output_per_mtok_usd +
    (tokenTotals.cache_creation_input_tokens / 1_000_000) * HAIKU_PRICING.cache_write_per_mtok_usd +
    (tokenTotals.cache_read_input_tokens / 1_000_000) * HAIKU_PRICING.cache_read_per_mtok_usd

  return {
    generated_at: new Date().toISOString(),
    subject: SUBJECT,
    exam_type: EXAM_TYPE,
    model: ANTHROPIC_MODEL,
    limit: LIMIT,
    diverse_sections: DIVERSE_SECTIONS,
    processed: results.length,
    ok,
    parse_failed: parseFailed,
    classifier_errors: classifierErrors,
    needs_review: needsReview,
    has_pic_no_png: hasPicNoPng,
    zero_topic_rows: zeroTopics,
    token_usage: tokenTotals,
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(4)),
    average_topics_per_task: Number(avgTopicsPerTask.toFixed(2)),
    borderline_secondary_topics_085_to_089: borderlineSecondaryTopics,
    duplicate_statement_tasks: duplicatedTasks,
    duplicate_statement_groups: duplicateHashes.length,
    selected_sections_preview: results.map(row => ({
      external_id: row.external_id,
      section_exam_number: row.section_exam_number,
      section_title: row.section_title,
      png_count: row.png_count ?? 0,
      has_pic_no_png: Boolean(row.has_pic_no_png),
    })),
    difficulty_counts: difficultyCounts,
    section_counts: Object.entries(sectionCounts)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([section_exam_number, count]) => ({ section_exam_number: Number(section_exam_number), count })),
    primary_topic_counts: Object.entries(primaryTopicCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([title, count]) => ({ title, count })),
    all_topic_counts: Object.entries(allTopicCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([title, count]) => ({ title, count })),
  }
}

async function main() {
  console.log('=== Пилотная классификация тем — Физика ЕГЭ ===')
  if (LIMIT) console.log(`Лимит: ${LIMIT}`)
  if (EXTERNAL_IDS.length) console.log(`external_id filter: ${EXTERNAL_IDS.join(', ')}`)
  if (FROM_FILE) console.log(`external_id source file: ${path.resolve(FROM_FILE)}`)
  console.log(`Output JSONL: ${SUGGESTIONS_FILE}`)
  if (DRY_RUN) console.log('Режим: dry-run (без вызова Anthropic API)')
  if (DIVERSE_SECTIONS) console.log('Режим отбора: diverse sections с приоритетом PNG')

  const [fetchedTasks, topics] = await Promise.all([
    EXTERNAL_IDS.length ? fetchTasksByExternalIds(EXTERNAL_IDS) : fetchAllCandidateTasks(),
    fetchAllowedTopics(),
  ])

  if (topics.length === 0) {
    throw new Error('Не найден список целевых тем 900101..900712')
  }
  if (topics.length !== EXPECTED_ALLOWED_TOPICS) {
    throw new Error(`Ожидалось ${EXPECTED_ALLOWED_TOPICS} разрешённых тем, но из БД пришло ${topics.length}. Проверь catalog_topics и новые темы 900130/900131.`)
  }
  console.log(`Разрешённых тем в prompt: ${topics.length}`)

  const topicPrompt = buildTopicsPrompt(topics)
  const allowedTopicIds = new Set(topics.map(topic => topic.id))
  const topicsById = Object.fromEntries(topics.map(topic => [topic.id, topic]))
  const rawDebugRows = []
  const failedTasks = readFailedTasks(FAILED_TASKS_FILE)
  const existingRows = readExistingJsonl(SUGGESTIONS_FILE)
  const existingExternalIds = new Set(existingRows.map(row => row.external_id))
  const tasks = DIVERSE_SECTIONS && !EXTERNAL_IDS.length
    ? selectDiverseTasks(fetchedTasks, LIMIT)
    : fetchedTasks
  const pendingTasks = tasks.filter(task => !existingExternalIds.has(task.external_id))

  if (DRY_RUN) {
    const preview = pendingTasks.map(task => {
      const { pngPaths, filteredOutSvg, otherFiles } = listImageFiles(task.external_id)
      return buildDryRunPreview(task, topicPrompt, pngPaths, filteredOutSvg, otherFiles, topics)
    })

    fs.writeFileSync(DRY_RUN_PREVIEW_FILE, JSON.stringify(preview, null, 2), 'utf-8')
    console.log(`\nDry-run preview: ${DRY_RUN_PREVIEW_FILE}`)
    console.log(`Подготовлено задач: ${preview.length}`)
    return
  }

  const results = [...existingRows]
  for (let index = 0; index < pendingTasks.length; index++) {
    const task = pendingTasks[index]
    const { statementText, hasPic, hasPng, hasSvgOnly, pngPaths } = getTaskMediaFlags(task)
    const hasPicNoPng = hasPic && !hasPng

    try {
      const responseData = await callAnthropicForTask(task, topicPrompt, pngPaths, rawDebugRows)
      const suggestion = normalizeSuggestion(responseData.parsed, allowedTopicIds)

      const row = {
        status: 'ok',
        task_id: task.id,
        external_id: task.external_id,
        section_exam_number: task.catalog_sections?.exam_number ?? null,
        section_title: task.catalog_sections?.title ?? '',
        source_url: task.source_url ?? null,
        statement_text: statementText,
        statement_hash: hashStatement(statementText),
        png_count: pngPaths.length,
        png_files: pngPaths.map(p => path.basename(p)),
        has_pic_no_png: hasPicNoPng,
        has_svg_only: hasSvgOnly,
        token_usage: responseData.usage,
        suggestion,
      }

      fs.appendFileSync(SUGGESTIONS_FILE, JSON.stringify(row) + '\n', 'utf-8')
      results.push(row)
      console.log(`✓ ${index + 1}/${pendingTasks.length} ext=${task.external_id} topics=${suggestion.topics.length} review=${suggestion.needs_review}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failureType = classifyFailure(error)
      if (failureType === 'forbidden') {
        fs.writeFileSync(LAST_403_FILE, JSON.stringify({
          external_id: task.external_id,
          section_exam_number: task.catalog_sections?.exam_number ?? null,
          source_url: task.source_url ?? null,
          error_message: message,
          response_body: error?.response_body ?? null,
          failed_at: new Date().toISOString(),
        }, null, 2), 'utf-8')
        console.error(`✗ ${index + 1}/${pendingTasks.length} ext=${task.external_id}: ${message}`)
        throw error
      }

      const failureRecord = buildFailureRecord(task, statementText, pngPaths, error)
      failedTasks.push(failureRecord)
      writeFailedTasks(FAILED_TASKS_FILE, failedTasks)
      console.error(`✗ ${index + 1}/${pendingTasks.length} ext=${task.external_id}: ${message}`)

      if (failureType === 'parse_failed') {
        const row = {
          status: 'parse_failed',
          task_id: task.id,
          external_id: task.external_id,
          section_exam_number: task.catalog_sections?.exam_number ?? null,
          section_title: task.catalog_sections?.title ?? '',
          source_url: task.source_url ?? null,
          statement_text: statementText,
          statement_hash: hashStatement(statementText),
          png_count: pngPaths.length,
          png_files: pngPaths.map(p => path.basename(p)),
          has_pic_no_png: hasPicNoPng,
          has_svg_only: hasSvgOnly,
          token_usage: error?.token_usage ?? {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
          suggestion: {
            topics: [],
            difficulty: 'средняя',
            difficulty_confidence: 0,
            reasoning: '',
            needs_review: true,
            validation_errors: ['parse_failed'],
          },
          raw_model_text: error?.raw_model_text ?? '',
          classifier_error: message,
        }

        fs.appendFileSync(SUGGESTIONS_FILE, JSON.stringify(row) + '\n', 'utf-8')
        results.push(row)
      }
    }

    await new Promise(resolve => setTimeout(resolve, REALTIME_DELAY_MS))
  }

  const summary = buildSummary(results, topicsById)
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), 'utf-8')
  if (DEBUG_RAW) {
    fs.writeFileSync(RAW_DEBUG_FILE, JSON.stringify(rawDebugRows, null, 2), 'utf-8')
  }

  console.log(`\nJSONL:   ${SUGGESTIONS_FILE}`)
  console.log(`Summary: ${SUMMARY_FILE}`)
  console.log(`Failed:  ${FAILED_TASKS_FILE}`)
  if (DEBUG_RAW) {
    console.log(`Raw debug: ${RAW_DEBUG_FILE}`)
  }
  console.log(`Обработано всего: ${summary.processed}, новый прогон: ${pendingTasks.length}, needs_review: ${summary.needs_review}`)
  if (summary.processed > 0 && (summary.zero_topic_rows / summary.processed) > 0.05) {
    console.warn('WARNING: возможна деградация, проверь сеть/кеш')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
