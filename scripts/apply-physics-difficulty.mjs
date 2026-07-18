import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUBJECT = 'Физика'
const EXAM_TYPE = 'ЕГЭ'
const VALID_DIFFICULTIES = new Set(['лёгкая', 'средняя', 'сложная'])
const DB_BATCH_SIZE = 50

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const INPUT_FILE = path.join(REPORTS_DIR, 'classify-suggestions.jsonl')
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'difficulty-snapshot.json')
const DRY_RUN_CSV = path.join(REPORTS_DIR, 'difficulty-dry-run.csv')
const APPLY_LOG_CSV = path.join(REPORTS_DIR, 'difficulty-apply-log.csv')

const APPLY = process.argv.includes('--apply')

fs.mkdirSync(REPORTS_DIR, { recursive: true })

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .filter(line => !line.trim().startsWith('#'))
      .map(line => {
        const index = line.indexOf('=')
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
      }),
  )
}

const env = {
  ...loadEnvFile(path.join(__dirname, '..', '.env')),
  ...loadEnvFile(path.join(__dirname, '..', '.env.import.local')),
  ...process.env,
}

const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
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
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
}

function formatError(error) {
  if (error instanceof Error) return `${error.message}\n${error.stack || ''}`.trim()
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

function loadDifficultyCandidates() {
  const rows = readJsonl(INPUT_FILE)
  const stats = {
    total_rows: rows.length,
    zero_topics_skipped: 0,
    parse_failed_skipped: 0,
    missing_difficulty_skipped: 0,
    invalid_difficulty_skipped: 0,
    duplicates_merged: 0,
  }

  const deduped = new Map()

  for (const row of rows) {
    const topics = Array.isArray(row.suggestion?.topics) ? row.suggestion.topics : []
    if (topics.length === 0) {
      stats.zero_topics_skipped++
      continue
    }
    if (row.status === 'parse_failed' || row.suggestion?.validation_errors?.includes('parse_failed')) {
      stats.parse_failed_skipped++
      continue
    }

    const difficulty = row.suggestion?.difficulty
    if (!difficulty) {
      stats.missing_difficulty_skipped++
      continue
    }
    if (!VALID_DIFFICULTIES.has(difficulty)) {
      stats.invalid_difficulty_skipped++
      continue
    }

    if (deduped.has(row.external_id)) stats.duplicates_merged++
    deduped.set(row.external_id, {
      external_id: row.external_id,
      difficulty,
      section_exam_number: row.section_exam_number ?? null,
      section_title: row.section_title ?? '',
    })
  }

  return {
    candidates: [...deduped.values()],
    stats,
  }
}

async function fetchTaskMap(externalIds) {
  const taskRows = []
  const batches = chunk(externalIds, DB_BATCH_SIZE)
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id, external_id, subject, exam_type, difficulty')
      .in('external_id', batch)
    if (error) throw new Error(`catalog_tasks batch ${index + 1}/${batches.length} failed: ${formatError(error)}`)
    taskRows.push(...(data || []))
  }
  return Object.fromEntries(taskRows.map(row => [row.external_id, row]))
}

async function verifySupabaseAccess() {
  const { count, error } = await supabase
    .from('catalog_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)

  if (error) throw new Error(`Supabase connectivity check failed: ${formatError(error)}`)
  console.log(`Supabase connectivity OK, physics/ege tasks visible: ${count ?? 'unknown'}`)
}

async function validateCandidates(candidates) {
  const externalIds = [...new Set(candidates.map(candidate => candidate.external_id))]
  const taskMap = await fetchTaskMap(externalIds)

  const rows = []
  const validRows = []
  const invalidReasons = {}

  for (const candidate of candidates) {
    const errors = []
    const task = taskMap[candidate.external_id]

    if (!task) {
      errors.push('TASK_NOT_FOUND')
    } else if (task.subject !== SUBJECT || task.exam_type !== EXAM_TYPE) {
      errors.push(`TASK_WRONG_SUBJECT_EXAM:${task.subject}/${task.exam_type}`)
    }

    if (!VALID_DIFFICULTIES.has(candidate.difficulty)) {
      errors.push(`INVALID_DIFFICULTY:${candidate.difficulty}`)
    }

    const row = {
      external_id: candidate.external_id,
      task_id: task?.id ?? '',
      current_difficulty: task?.difficulty ?? '',
      next_difficulty: candidate.difficulty,
      section_exam_number: candidate.section_exam_number ?? '',
      section_title: candidate.section_title ?? '',
      validation_status: errors.length === 0 ? 'OK' : 'FAIL',
      validation_errors: errors.join('; '),
    }

    rows.push(row)
    if (errors.length === 0) {
      validRows.push(row)
    } else {
      for (const error of errors) invalidReasons[error] = (invalidReasons[error] || 0) + 1
    }
  }

  return { rows, validRows, invalidReasons }
}

function summarizeDifficulty(validRows) {
  return {
    лёгкая: validRows.filter(row => row.next_difficulty === 'лёгкая').length,
    средняя: validRows.filter(row => row.next_difficulty === 'средняя').length,
    сложная: validRows.filter(row => row.next_difficulty === 'сложная').length,
  }
}

async function createSnapshot(validRows) {
  const snapshot = {
    generated_at: new Date().toISOString(),
    affected_tasks: validRows.length,
    tasks: validRows.map(row => ({
      task_id: row.task_id,
      external_id: row.external_id,
      previous_difficulty: row.current_difficulty || null,
      next_difficulty: row.next_difficulty,
    })),
  }

  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8')
  return snapshot
}

function buildDryRunCsv(validRows) {
  writeCsv(
    DRY_RUN_CSV,
    ['external_id', 'task_id', 'current_difficulty', 'next_difficulty', 'section_exam_number', 'section_title'],
    validRows,
  )
}

async function applyRows(validRows) {
  const logRows = []

  for (const batch of chunk(validRows, DB_BATCH_SIZE)) {
    for (const row of batch) {
      const { error } = await supabase
        .from('catalog_tasks')
        .update({ difficulty: row.next_difficulty })
        .eq('id', row.task_id)
      if (error) throw new Error(`catalog_tasks update failed for ${row.external_id}: ${formatError(error)}`)
      logRows.push({
        external_id: row.external_id,
        task_id: row.task_id,
        previous_difficulty: row.current_difficulty,
        next_difficulty: row.next_difficulty,
        action: row.current_difficulty === row.next_difficulty ? 'unchanged' : 'updated',
      })
    }
  }

  writeCsv(
    APPLY_LOG_CSV,
    ['external_id', 'task_id', 'previous_difficulty', 'next_difficulty', 'action'],
    logRows,
  )

  return { logRows }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))

  const { candidates, stats } = loadDifficultyCandidates()
  console.log(`JSONL rows: ${stats.total_rows}`)
  console.log(`Skipped zero-topic: ${stats.zero_topics_skipped}`)
  console.log(`Skipped parse_failed: ${stats.parse_failed_skipped}`)
  console.log(`Skipped missing difficulty: ${stats.missing_difficulty_skipped}`)
  console.log(`Skipped invalid difficulty: ${stats.invalid_difficulty_skipped}`)
  console.log(`Duplicates merged: ${stats.duplicates_merged}`)
  console.log(`Difficulty candidates: ${candidates.length}`)

  await verifySupabaseAccess()

  const { rows, validRows, invalidReasons } = await validateCandidates(candidates)
  console.log(`Validated OK: ${validRows.length}`)
  console.log(`Validation FAIL: ${rows.length - validRows.length}`)

  if (Object.keys(invalidReasons).length > 0) {
    console.log('Invalid reasons:')
    for (const [reason, count] of Object.entries(invalidReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`)
    }
  }

  const summary = summarizeDifficulty(validRows)
  await createSnapshot(validRows)
  buildDryRunCsv(validRows)

  console.log(`Snapshot: ${SNAPSHOT_FILE}`)
  console.log(`Dry-run CSV: ${DRY_RUN_CSV}`)
  console.log(`Would update difficulty for tasks: ${validRows.length}`)
  console.log(`Difficulty distribution: лёгкая=${summary.лёгкая}, средняя=${summary.средняя}, сложная=${summary.сложная}`)

  if (!APPLY) {
    console.log('\nDry-run only. Для применения добавьте --apply.')
    return
  }

  await applyRows(validRows)
  console.log(`Apply log: ${APPLY_LOG_CSV}`)
}

main().catch(error => {
  console.error('FATAL:')
  console.error(formatError(error))
  process.exit(1)
})
