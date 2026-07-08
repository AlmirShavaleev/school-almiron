/**
 * Аудит изображений каталога «Физика ОГЭ»
 *
 * Выход:
 *   physics-oge-broken-images.jsonl        — список проблемных img
 *   physics-oge-broken-images-summary.json — сводка
 *
 * Запуск:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/audit-physics-oge-images.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUBJECT      = 'Физика'
const EXAM_TYPE    = 'ОГЭ'
const PAGE         = 1000

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) { console.error('❌  SUPABASE_SERVICE_ROLE_KEY не задан'); process.exit(1) }
const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

// ── Paginated fetch ───────────────────────────────────────────────────────────

async function fetchAll(table, fields, filters = {}) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(fields)
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
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

function safeDecodeStoragePath(p) {
  try { return decodeURIComponent(p) } catch { return p }
}

function getPublicUrl(sp) {
  const { data } = supabase.storage.from('catalog-assets').getPublicUrl(safeDecodeStoragePath(sp))
  return data.publicUrl
}

// ── HTTP HEAD check ───────────────────────────────────────────────────────────

async function checkUrl(url) {
  try { return (await fetch(url, { method: 'HEAD' })).status } catch { return 0 }
}

async function checkUrlsBatch(urls, concurrency = 10) {
  const results = new Map()
  const queue   = [...urls]
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const url = queue.shift()
      if (url) results.set(url, await checkUrl(url))
    }
  }))
  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍  Аудит изображений Физика ОГЭ...')

  console.log('  Загружаю задачи...')
  const tasks = await fetchAll('catalog_tasks',
    'id,external_id,statement_html,answer_html,solution_html,solution_plan_html,grade_criteria_html',
    { subject: SUBJECT, exam_type: EXAM_TYPE })
  console.log(`  Задач: ${tasks.length}`)

  console.log('  Загружаю assets...')
  const taskUuids = tasks.map(t => t.id)
  const allAssets = []
  // chunk 50 to avoid PostgREST URL length limits
  for (let i = 0; i < taskUuids.length; i += 50) {
    const chunk = taskUuids.slice(i, i + 50)
    const { data } = await supabase.from('catalog_task_assets')
      .select('id,task_id,kind,storage_path,alt,tex_session_id')
      .in('task_id', chunk)
    allAssets.push(...(data ?? []))
  }
  console.log(`  Assets в БД: ${allAssets.length}`)

  // Index by task_id, dedup by (task_id, storage_path)
  const seenAssets = new Set()
  const assetsByTask = {}
  for (const a of allAssets) {
    const key = `${a.task_id}:${a.storage_path}`
    if (seenAssets.has(key)) continue
    seenAssets.add(key)
    ;(assetsByTask[a.task_id] ??= []).push(a)
  }

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
        // malformed src check
        if (src.includes('../') || src.includes('\\') || src.startsWith('/')) {
          broken.push({ issue: 'malformed_src', external_id: task.external_id, img_src: src })
        }

        // Match: decoded path ends with src OR raw path ends with src OR alt === src
        const allMatches = [...new Map(
          taskAssets.filter(a => {
            const decoded = safeDecodeStoragePath(a.storage_path)
            return decoded.endsWith(`/${src}`)
                || a.storage_path.endsWith(`/${src}`)
                || a.alt === src
          }).map(a => [a.storage_path, a])
        ).values()]

        if (!allMatches.length) {
          noMatch++
          broken.push({
            issue:         'no_asset_match',
            external_id:   task.external_id,
            task_id:       task.id,
            html_field:    field,
            img_src:       src,
            asset_count_for_task: taskAssets.length,
            available_storage_paths: taskAssets.map(a => a.storage_path).slice(0, 5),
          })
        } else {
          withMatch++
          if (allMatches.length > 1) {
            broken.push({
              issue:       'ambiguous_match',
              external_id: task.external_id,
              img_src:     src,
              matches:     allMatches.map(a => a.storage_path),
            })
          }
          if (urlCheck.size < 500) urlCheck.add(getPublicUrl(allMatches[0].storage_path))
        }
      }
    }
  }

  console.log(`  Всего img: ${totalImg}, совпало: ${withMatch}, не найдено: ${noMatch}`)

  console.log(`  Проверяю HTTP для ${urlCheck.size} URLs...`)
  const statusMap = await checkUrlsBatch([...urlCheck], 10)
  const url404    = [...statusMap.entries()].filter(([, s]) => s !== 200).map(([url, status]) => ({ url, status }))
  console.log(`  404/error: ${url404.length}`)

  const jsonlLines = broken.map(e => JSON.stringify(e)).join('\n')
  writeFileSync('physics-oge-broken-images.jsonl', jsonlLines)

  const issueTypes = {}
  for (const b of broken) issueTypes[b.issue] = (issueTypes[b.issue] ?? 0) + 1

  const summary = {
    generated_at:          new Date().toISOString(),
    tasks_total:           tasks.length,
    assets_in_db:          allAssets.length,
    img_total:             totalImg,
    img_with_match:        withMatch,
    img_no_match:          noMatch,
    url_sample_checked:    urlCheck.size,
    url_404_or_error:      url404.length,
    issues_by_type:        issueTypes,
    sample_404s:           url404.slice(0, 10),
    broken_entries_total:  broken.length,
  }

  writeFileSync('physics-oge-broken-images-summary.json', JSON.stringify(summary, null, 2))

  console.log('\n📊  Итог:')
  console.log(JSON.stringify(summary, null, 2))
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
