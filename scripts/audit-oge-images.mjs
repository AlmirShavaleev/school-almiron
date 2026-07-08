/**
 * Полный аудит битых изображений каталога «Математика ОГЭ»
 *
 * Выход:
 *   broken_oge_images.jsonl         — список всех проблемных img
 *   broken_oge_images_summary.json  — сводка
 *
 * Запуск:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/audit-oge-images.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { createWriteStream } from 'fs'
import { join } from 'path'

const SUPABASE_URL  = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'
const SUBJECT       = 'Математика'
const EXAM_TYPE     = 'ОГЭ'
const PAGE          = 1000

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase   = serviceKey
  ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
  : createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })

// ── Paginated fetch ────────────────────────────────────────────────────────────

async function fetchAll(table, fields, eq = {}, inField = null, inValues = null) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(fields)
    for (const [k,v] of Object.entries(eq)) q = q.eq(k, v)
    if (inField && inValues) q = q.in(inField, inValues)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) { console.error(`fetchAll ${table}: ${error.message}`); break }
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) break
  }
  return rows
}

// ── IMG SRC extractor ─────────────────────────────────────────────────────────

const IMG_RE = /<img\b[^>]*\bsrc=(?:"([^"]*)"|'([^']*)')/gi

function extractImgSrcs(html) {
  if (!html) return []
  const srcs = []
  let m
  while ((m = IMG_RE.exec(html)) !== null) {
    const src = (m[1] ?? m[2] ?? '').trim()
    if (src && !/^https?:\/\//.test(src)) srcs.push(src)
  }
  IMG_RE.lastIndex = 0
  return [...new Set(srcs)]
}

// ── Normalize basename for matching ──────────────────────────────────────────

function normalizeSrc(src) {
  // extract basename (last path segment, no query/hash)
  const withoutQH = src.split('?')[0].split('#')[0]
  return withoutQH.split('/').pop() ?? src
}

function storageBasename(storagePath) {
  try {
    return decodeURIComponent(storagePath.split('/').pop() ?? storagePath)
  } catch { return storagePath.split('/').pop() ?? storagePath }
}

// ── Public URL ────────────────────────────────────────────────────────────────

function safeDecodeStoragePath(p) {
  try { return decodeURIComponent(p) } catch { return p }
}

function getPublicUrl(sp) {
  const { data } = supabase.storage.from('catalog-assets').getPublicUrl(safeDecodeStoragePath(sp))
  return data.publicUrl
}

// ── HTTP HEAD check (batch, limited concurrency) ─────────────────────────────

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.status
  } catch { return 0 }
}

async function checkUrlsBatch(urls, concurrency = 10) {
  const results = new Map()
  const queue   = [...urls]
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const url = queue.shift()
      if (url) results.set(url, await checkUrl(url))
    }
  })
  await Promise.all(workers)
  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍  Аудит изображений Математика ОГЭ...')

  // 1. Fetch all OGE tasks
  console.log('  Загружаю задачи...')
  const tasks = await fetchAll('catalog_tasks',
    'id,external_id,statement_html,answer_html,solution_html,solution_plan_html,grade_criteria_html',
    { subject: SUBJECT, exam_type: EXAM_TYPE })
  console.log(`  Задач: ${tasks.length}`)

  // 2. Fetch all OGE assets (with alt for Cyrillic matching)
  console.log('  Загружаю assets...')
  const taskUuids = tasks.map(t => t.id)
  // chunk 50: Supabase .in() is URL-based — 200 UUIDs × 37 chars approaches URL limits
  const allAssets = []
  for (let i = 0; i < taskUuids.length; i += 50) {
    const chunk = taskUuids.slice(i, i + 50)
    const rows  = await fetchAll('catalog_task_assets',
      'id,task_id,kind,storage_path,alt,tex_session_id', {}, 'task_id', chunk)
    allAssets.push(...rows)
  }
  console.log(`  Assets в БД: ${allAssets.length}`)

  // Index assets by task_id
  const assetsByTask = {}
  for (const a of allAssets) {
    ;(assetsByTask[a.task_id] ??= []).push(a)
  }

  // 3. Analyze every img src
  const broken   = []
  const urlCheck = new Set()
  let   totalImg = 0, noMatch = 0, withMatch = 0

  for (const task of tasks) {
    const htmlFields = [
      { field: 'statement_html',      html: task.statement_html },
      { field: 'answer_html',         html: task.answer_html },
      { field: 'solution_html',       html: task.solution_html },
      { field: 'solution_plan_html',  html: task.solution_plan_html },
      { field: 'grade_criteria_html', html: task.grade_criteria_html },
    ]
    const taskAssets = assetsByTask[task.id] ?? []

    for (const { field, html } of htmlFields) {
      const srcs = extractImgSrcs(html)
      totalImg += srcs.length

      for (const src of srcs) {
        const base = normalizeSrc(src)

        // Mirror the exact three conditions used in CatalogTopicPage resolveHtml
        const match = taskAssets.find(a => {
          const decoded = safeDecodeStoragePath(a.storage_path)
          return decoded.endsWith(`/${src}`)
              || a.storage_path.endsWith(`/${src}`)
              || a.alt === src
        })

        if (!match) {
          noMatch++
          broken.push({
            issue:         'no_asset_match',
            external_id:   task.external_id,
            task_id:       task.id,
            html_field:    field,
            img_src:       src,
            asset_count_for_task: taskAssets.length,
            available_storage_paths: taskAssets.map(a => a.storage_path).slice(0,5),
          })
        } else {
          withMatch++
          // Check for ambiguous matches
          const allMatches = [...new Map(
            taskAssets.filter(a => {
              const decoded = safeDecodeStoragePath(a.storage_path)
              return decoded.endsWith(`/${src}`)
                  || a.storage_path.endsWith(`/${src}`)
                  || a.alt === src
            }).map(a => [a.storage_path, a])
          ).values()]
          if (allMatches.length > 1) {
            broken.push({
              issue:       'ambiguous_match',
              external_id: task.external_id,
              img_src:     src,
              matches:     allMatches.map(a => a.storage_path),
            })
          }
          // Queue URL check for a sample
          if (urlCheck.size < 500) urlCheck.add(getPublicUrl(match.storage_path))
        }

        // Check for malformed src
        if (src.includes('../') || src.includes('\\') || src.startsWith('/')) {
          broken.push({
            issue:       'malformed_src',
            external_id: task.external_id,
            img_src:     src,
          })
        }
      }
    }
  }

  console.log(`  Всего img: ${totalImg}, совпало: ${withMatch}, не найдено: ${noMatch}`)

  // 4. HTTP status checks (sample)
  console.log(`  Проверяю HTTP статусы для ${urlCheck.size} URLs...`)
  const statusMap = await checkUrlsBatch([...urlCheck], 10)
  const url404 = [...statusMap.entries()].filter(([,s]) => s !== 200).map(([url, status]) => ({ url, status }))
  console.log(`  404/error: ${url404.length}`)

  // 5. Write JSONL report
  const jsonlPath = join(process.cwd(), 'broken_oge_images.jsonl')
  const jsonlStream = createWriteStream(jsonlPath)
  for (const entry of broken) jsonlStream.write(JSON.stringify(entry) + '\n')
  jsonlStream.end()

  // 6. Summary
  const issueTypes = {}
  for (const b of broken) issueTypes[b.issue] = (issueTypes[b.issue] ?? 0) + 1

  const summary = {
    generated_at:    new Date().toISOString(),
    tasks_total:     tasks.length,
    assets_in_db:    allAssets.length,
    img_total:       totalImg,
    img_with_match:  withMatch,
    img_no_match:    noMatch,
    url_sample_checked: urlCheck.size,
    url_404_or_error: url404.length,
    issues_by_type:  issueTypes,
    sample_404s:     url404.slice(0, 10),
    broken_entries_total: broken.length,
  }

  const summaryPath = join(process.cwd(), 'broken_oge_images_summary.json')
  await import('fs').then(fs => fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)))

  console.log('\n📊  Итог:')
  console.log(JSON.stringify(summary, null, 2))
  console.log(`\n📄  JSONL: ${jsonlPath}`)
  console.log(`📄  Summary: ${summaryPath}`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
