/**
 * compare-math-ege-source-vs-db.mjs
 * Сравнивает нормализованный локальный каталог с тем, что есть в БД.
 *
 * Источники:
 *   C:/Users/User/Documents/Codex/2026-06-22/new-chat/outputs/normalized_catalog/catalog_tasks.jsonl
 *   C:/Users/User/Documents/Codex/2026-06-22/new-chat/outputs/normalized_catalog/catalog_task_topics.jsonl
 *   C:/Users/User/Documents/Codex/2026-06-22/new-chat/outputs/normalized_catalog/catalog_task_assets.jsonl
 *
 * Генерирует:
 *   reports/math-ege/source-db-diff.jsonl
 *
 * Запуск:
 *   node scripts/compare-math-ege-source-vs-db.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, appendFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const SUPABASE_URL  = process.env.SUPABASE_URL ?? 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_ANON
const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })

const NORM_DIR = 'C:/Users/User/Documents/Codex/2026-06-22/new-chat/outputs/normalized_catalog'
const OUT_DIR  = join(process.cwd(), 'reports/math-ege')
const BATCH    = 1000

mkdirSync(OUT_DIR, { recursive: true })

function readJsonl(file) {
  const p = join(NORM_DIR, file)
  if (!existsSync(p)) { console.error(`❌  Not found: ${p}`); return [] }
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
}

function jsonl(file, obj) { appendFileSync(join(OUT_DIR, file), JSON.stringify(obj) + '\n') }

async function fetchAllDbTasks() {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id,external_id,statement_html,answer_html,solution_html,has_answer,has_solution,is_published')
      .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ')
      .range(from, from + BATCH - 1).order('external_id')
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...data)
    if (data.length < BATCH) break
    from += BATCH
  }
  return all
}

async function fetchDbAssets(taskIds) {
  const all = []
  for (let i = 0; i < taskIds.length; i += 50) {
    const ch = taskIds.slice(i, i + 50)
    const { data } = await supabase.from('catalog_task_assets').select('task_id,tex_session_id,kind,storage_path').in('task_id', ch)
    all.push(...(data ?? []))
  }
  return all
}

async function fetchDbTopics(taskIds) {
  const all = []
  for (let i = 0; i < taskIds.length; i += 50) {
    const ch = taskIds.slice(i, i + 50)
    const { data } = await supabase.from('catalog_task_topics').select('task_id,topic_id').in('task_id', ch)
    all.push(...(data ?? []))
  }
  return all
}

async function main() {
  console.log('🔍  Загрузка исходных данных...')
  const srcTasks = readJsonl('catalog_tasks.jsonl')
  const srcTopics = readJsonl('catalog_task_topics.jsonl')
  const srcAssets = readJsonl('catalog_task_assets.jsonl')
  console.log(`    source: ${srcTasks.length} tasks, ${srcTopics.length} task-topic links, ${srcAssets.length} assets`)

  console.log('🔍  Загрузка БД...')
  const dbTasks = await fetchAllDbTasks()
  const dbTaskIds = dbTasks.map(t => t.id)
  const dbAssets  = await fetchDbAssets(dbTaskIds)
  const dbTopics  = await fetchDbTopics(dbTaskIds)
  console.log(`    db: ${dbTasks.length} tasks, ${dbTopics.length} task-topic links, ${dbAssets.length} assets`)

  // Build lookups
  const dbByExtId = Object.fromEntries(dbTasks.map(t => [t.external_id, t]))
  const srcExtIds = new Set(srcTasks.map(t => t.external_id))
  const dbExtIds  = new Set(dbTasks.map(t => t.external_id))

  writeFileSync(join(OUT_DIR, 'source-db-diff.jsonl'), '')

  const diff = {
    generated_at: new Date().toISOString(),
    source_count: srcTasks.length, db_count: dbTasks.length,
    missing_in_db: 0, extra_in_db: 0,
    statement_html_diff: 0, answer_html_diff: 0, solution_html_diff: 0,
    has_answer_diff: 0, has_solution_diff: 0, is_published_diff: 0,
    missing_topic_links: 0, missing_assets: 0,
  }

  // Missing in DB
  for (const t of srcTasks) {
    if (!dbExtIds.has(t.external_id)) {
      diff.missing_in_db++
      jsonl('source-db-diff.jsonl', { type: 'missing_in_db', external_id: t.external_id, severity: 'critical' })
    }
  }

  // Extra in DB (not in source)
  for (const ext of dbExtIds) {
    if (!srcExtIds.has(ext)) {
      diff.extra_in_db++
      jsonl('source-db-diff.jsonl', { type: 'extra_in_db', external_id: ext, severity: 'medium' })
    }
  }

  // Field diffs
  for (const src of srcTasks) {
    const db = dbByExtId[src.external_id]
    if (!db) continue

    const checks = [
      { field: 'statement_html', key: 'statement_html_diff' },
      { field: 'answer_html',    key: 'answer_html_diff' },
      { field: 'solution_html',  key: 'solution_html_diff' },
    ]
    for (const c of checks) {
      const sv = (src[c.field] ?? '').trim()
      const dv = (db[c.field] ?? '').trim()
      if (sv !== dv) {
        diff[c.key]++
        jsonl('source-db-diff.jsonl', {
          type: `field_diff:${c.field}`, external_id: src.external_id,
          severity: 'medium',
          src_preview: sv.slice(0, 60), db_preview: dv.slice(0, 60),
        })
      }
    }
    if (src.has_answer !== db.has_answer) {
      diff.has_answer_diff++
      jsonl('source-db-diff.jsonl', { type: 'has_answer_diff', external_id: src.external_id, src: src.has_answer, db: db.has_answer, severity: 'high' })
    }
    if (src.has_solution !== db.has_solution) {
      diff.has_solution_diff++
      jsonl('source-db-diff.jsonl', { type: 'has_solution_diff', external_id: src.external_id, src: src.has_solution, db: db.has_solution, severity: 'high' })
    }
  }

  // Topic link coverage
  const srcTopicByTask = {}
  for (const r of srcTopics) {
    if (!srcTopicByTask[r.task_external_id]) srcTopicByTask[r.task_external_id] = []
    srcTopicByTask[r.task_external_id].push(r.topic_external_id)
  }
  const dbTopicTaskIds = new Set(dbTopics.map(r => r.task_id))

  for (const src of srcTasks) {
    if (!srcTopicByTask[src.external_id]) continue
    const db = dbByExtId[src.external_id]
    if (!db) continue
    if (!dbTopicTaskIds.has(db.id)) {
      diff.missing_topic_links++
      jsonl('source-db-diff.jsonl', {
        type: 'missing_topic_link', external_id: src.external_id,
        task_uuid: db.id, severity: 'high',
      })
    }
  }

  // Asset coverage: source assets vs DB assets by tex_session_id
  const dbSessionIds = new Set(dbAssets.map(a => a.tex_session_id))
  const srcSessionIds = new Set(srcAssets.map(a => a.tex_session_id))
  const missingSessions = [...srcSessionIds].filter(id => !dbSessionIds.has(id))
  diff.missing_assets = missingSessions.length

  if (missingSessions.length > 0) {
    jsonl('source-db-diff.jsonl', {
      type: 'missing_asset_sessions', count: missingSessions.length,
      sample_sessions: missingSessions.slice(0, 20),
      severity: 'high',
    })
  }

  writeFileSync(join(OUT_DIR, 'source-db-diff-summary.json'), JSON.stringify(diff, null, 2))

  console.log('\n📊  Diff результаты:')
  for (const [k, v] of Object.entries(diff)) {
    if (typeof v === 'number' && v > 0) console.log(`    ${k}: ${v}`)
  }
  console.log(`\n✅  Отчёт: reports/math-ege/source-db-diff.jsonl`)
}

main().catch(e => { console.error(e); process.exit(1) })
