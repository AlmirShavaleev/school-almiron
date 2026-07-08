/**
 * Полный аудит битых изображений каталога «Математика ЕГЭ»
 *
 * Выход:
 *   reports/math-ege-broken-images.jsonl
 *   reports/math-ege-broken-images-summary.json
 *
 * Запуск:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/audit-math-ege-images.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { createWriteStream, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')

const SUPABASE_URL  = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'
const SUBJECT       = 'Математика'
const EXAM_TYPE     = 'ЕГЭ'
const PAGE          = 1000
const ASSET_CHUNK   = 50   // safe chunk size for .in() to avoid URL truncation

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase   = serviceKey
  ? createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
  : createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } })

if (!serviceKey) {
  console.warn('⚠️  No SUPABASE_SERVICE_ROLE_KEY — using anon key (RLS applies)')
}

// ── Paginated fetch ────────────────────────────────────────────────────────────

async function fetchAll(table, fields, eq = {}, inField = null, inValues = null) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(fields)
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v)
    if (inField && inValues?.length) q = q.in(inField, inValues)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) { console.error(`  fetchAll(${table}): ${error.message}`); break }
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
  IMG_RE.lastIndex = 0
  while ((m = IMG_RE.exec(html)) !== null) {
    const src = (m[1] ?? m[2] ?? '').trim()
    if (src && !/^https?:\/\/|^\/\//.test(src)) srcs.push(src)
  }
  IMG_RE.lastIndex = 0
  return [...new Set(srcs)]
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function safeDecodeStoragePath(p) {
  try { return decodeURIComponent(p) } catch { return p }
}

/** Extract the basename (filename) from any src or storage_path */
function basename(p) {
  const withoutQH = p.split('?')[0].split('#')[0]
  let seg = withoutQH.split('/').pop() ?? p
  try { seg = decodeURIComponent(seg) } catch { /* keep */ }
  return seg
}

/** Decode HTML character entities in img src — mirrors frontend decodeHtmlEntitiesInSrc */
function decodeHtmlEntitiesInSrc(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** Mirror exactly what frontend resolveTaskHtml does (including HTML entity decoding) */
function findAsset(src, taskAssets) {
  const decodedSrc = decodeHtmlEntitiesInSrc(src)
  return taskAssets.find(a => {
    const decoded = safeDecodeStoragePath(a.storage_path)
    return decoded.endsWith(`/${decodedSrc}`)
        || a.storage_path.endsWith(`/${decodedSrc}`)
        || a.alt === decodedSrc
        || a.alt === src
  })
}

/** Detect if a src path is suspiciously encoded (double-encoded or unusual) */
function detectPathIssues(src) {
  const issues = []
  if (/%25/i.test(src))           issues.push('double_encoded')
  if (src.includes(' '))          issues.push('space_in_src')
  if (src.includes('\\'))         issues.push('backslash')
  if (src.startsWith('/'))        issues.push('absolute_path')
  if (src.includes('../'))        issues.push('relative_traversal')
  return issues
}

function getPublicUrl(sp) {
  const { data } = supabase.storage.from('catalog-assets').getPublicUrl(safeDecodeStoragePath(sp))
  return data.publicUrl
}

// ── HTTP checks ───────────────────────────────────────────────────────────────

async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    return res.status
  } catch { return 0 }
}

async function checkUrlsBatch(urls, concurrency = 10) {
  const results = new Map()
  const queue   = [...urls]
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift()
      if (url) results.set(url, await checkUrl(url))
    }
  }))
  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍  Аудит изображений «Математика ЕГЭ»...')
  mkdirSync(join(ROOT, 'reports'), { recursive: true })

  // ── 1. Load tasks ────────────────────────────────────────────────────────────
  console.log('\n📥  Загружаю задачи...')
  const tasks = await fetchAll(
    'catalog_tasks',
    'id,external_id,statement_html,answer_html,solution_html,solution_plan_html,grade_criteria_html',
    { subject: SUBJECT, exam_type: EXAM_TYPE }
  )
  console.log(`  Задач загружено: ${tasks.length}`)
  if (tasks.length === 0) {
    console.error('  ❌  Задачи не найдены. Проверьте подключение или RLS.')
    process.exit(1)
  }

  // ── 2. Load assets in safe chunks ─────────────────────────────────────────
  console.log('\n📥  Загружаю assets (chunk=' + ASSET_CHUNK + ')...')
  const taskUuids = tasks.map(t => t.id)
  const allAssets = []

  for (let i = 0; i < taskUuids.length; i += ASSET_CHUNK) {
    const chunk = taskUuids.slice(i, i + ASSET_CHUNK)
    const rows  = await fetchAll(
      'catalog_task_assets',
      'id,task_id,kind,storage_path,alt,tex_session_id',
      {}, 'task_id', chunk
    )
    allAssets.push(...rows)
    if ((i / ASSET_CHUNK) % 50 === 0) {
      process.stdout.write(`\r  чанков: ${Math.ceil((i + ASSET_CHUNK) / ASSET_CHUNK)}/${Math.ceil(taskUuids.length / ASSET_CHUNK)}   `)
    }
  }
  console.log(`\n  Assets в БД: ${allAssets.length}`)

  // Index assets by task_id
  const assetsByTask = {}
  for (const a of allAssets) {
    ;(assetsByTask[a.task_id] ??= []).push(a)
  }

  // ── 3. Find specific known-broken tasks ──────────────────────────────────
  console.log('\n🔎  Ищу конкретные задачи (касательная AM и секущая AC)...')
  const knownBroken = tasks.filter(t =>
    t.statement_html?.includes('касательн') &&
    t.statement_html?.includes('секущ') &&
    (t.statement_html?.includes('36') || t.statement_html?.includes('34'))
  )
  console.log(`  Найдено задач с касательной/секущей: ${knownBroken.length}`)
  for (const t of knownBroken.slice(0, 5)) {
    const srcs   = extractImgSrcs(t.statement_html)
    const assets = assetsByTask[t.id] ?? []
    console.log(`  external_id=${t.external_id} id=${t.id}`)
    console.log(`    img srcs в statement: ${JSON.stringify(srcs)}`)
    console.log(`    assets count: ${assets.length}`)
    for (const a of assets) {
      console.log(`    asset: kind=${a.kind} session=${a.tex_session_id} path=${a.storage_path}`)
    }
  }

  // ── 4. Analyze every img src ─────────────────────────────────────────────
  console.log('\n🔍  Анализирую все <img> во всех HTML-полях...')
  const broken   = []
  const urlToCheck = new Map() // url → asset storage_path
  let   totalImg = 0, noMatch = 0, withMatch = 0, okCount = 0

  const HTML_FIELDS = [
    'statement_html',
    'answer_html',
    'solution_html',
    'solution_plan_html',
    'grade_criteria_html',
  ]

  for (const task of tasks) {
    const taskAssets = assetsByTask[task.id] ?? []

    for (const field of HTML_FIELDS) {
      const srcs = extractImgSrcs(task[field])
      totalImg += srcs.length

      for (const src of srcs) {
        const pathIssues = detectPathIssues(src)
        if (pathIssues.length) {
          broken.push({
            issue:       'malformed_src',
            sub_issues:  pathIssues,
            external_id: task.external_id,
            task_id:     task.id,
            html_field:  field,
            img_src:     src,
          })
        }

        const decodedSrc = decodeHtmlEntitiesInSrc(src)
        const allMatches = taskAssets.filter(a => {
          const decoded = safeDecodeStoragePath(a.storage_path)
          return decoded.endsWith(`/${decodedSrc}`)
              || a.storage_path.endsWith(`/${decodedSrc}`)
              || a.alt === decodedSrc
              || a.alt === src
        })

        if (allMatches.length === 0) {
          noMatch++
          // Try basename-only match to detect wrong_tex_session issues
          const bname = basename(src)
          const basenameMatches = taskAssets.filter(a => basename(a.storage_path) === bname)

          broken.push({
            issue:         'no_asset_match',
            external_id:   task.external_id,
            task_id:       task.id,
            html_field:    field,
            img_src:       src,
            img_basename:  bname,
            task_asset_count: taskAssets.length,
            basename_matches: basenameMatches.map(a => ({
              storage_path:   a.storage_path,
              kind:           a.kind,
              tex_session_id: a.tex_session_id,
            })),
            available_paths: taskAssets.slice(0, 8).map(a => a.storage_path),
          })
        } else if (allMatches.length > 1) {
          withMatch++
          broken.push({
            issue:       'ambiguous_match',
            external_id: task.external_id,
            task_id:     task.id,
            html_field:  field,
            img_src:     src,
            match_count: allMatches.length,
            matches:     allMatches.map(a => ({ storage_path: a.storage_path, kind: a.kind, tex_session_id: a.tex_session_id })),
          })
          // Still check the first match URL
          const url = getPublicUrl(allMatches[0].storage_path)
          if (urlToCheck.size < 1000) urlToCheck.set(url, allMatches[0].storage_path)
        } else {
          withMatch++
          okCount++
          const url = getPublicUrl(allMatches[0].storage_path)
          if (urlToCheck.size < 1000) urlToCheck.set(url, allMatches[0].storage_path)
        }
      }
    }
  }

  console.log(`  Всего img: ${totalImg}`)
  console.log(`  Совпало:   ${withMatch} (из них ambiguous: ${broken.filter(b => b.issue === 'ambiguous_match').length})`)
  console.log(`  Не найдено (no_asset_match): ${noMatch}`)

  // ── 5. Manual verification of 5 specific tasks ───────────────────────────
  console.log('\n🔬  Ручная проверка: прямые .eq() запросы для 5 задач...')
  const sample5 = tasks.filter(t => (assetsByTask[t.id] ?? []).length > 0).slice(0, 5)
  let manualMismatch = 0
  for (const t of sample5) {
    const { data: directAssets, error: de } = await supabase
      .from('catalog_task_assets')
      .select('id,task_id,kind,storage_path,alt,tex_session_id')
      .eq('task_id', t.id)
    if (de) { console.error(`    task ${t.id}: ${de.message}`); continue }
    const fromChunk   = (assetsByTask[t.id] ?? []).length
    const fromDirect  = (directAssets ?? []).length
    if (fromChunk !== fromDirect) {
      manualMismatch++
      console.warn(`  ⚠️  task ${t.external_id}: chunk=${fromChunk} direct=${fromDirect} MISMATCH`)
    } else {
      console.log(`  ✓  task ext=${t.external_id}: assets chunk=${fromChunk} direct=${fromDirect} OK`)
    }
  }
  if (manualMismatch > 0) {
    broken.push({ issue: 'asset_not_returned_due_to_pagination', detail: `${manualMismatch} of 5 sampled tasks had fewer assets from .in() than from direct .eq()` })
  }

  // ── 6. HTTP checks (sample up to 1000 URLs) ──────────────────────────────
  console.log(`\n🌐  Проверяю HTTP статусы для ${urlToCheck.size} URLs...`)
  const statusMap = await checkUrlsBatch([...urlToCheck.keys()], 12)
  const url404    = [...statusMap.entries()]
    .filter(([, s]) => s !== 200)
    .map(([url, status]) => ({ url, status, storage_path: urlToCheck.get(url) }))
  console.log(`  HTTP != 200: ${url404.length}`)

  for (const entry of url404.slice(0, 20)) {
    broken.push({
      issue:        'url_404',
      url:          entry.url,
      http_status:  entry.status,
      storage_path: entry.storage_path,
    })
  }

  // ── 7. Write JSONL ────────────────────────────────────────────────────────
  const jsonlPath = join(ROOT, 'reports', 'math-ege-broken-images.jsonl')
  const ws = createWriteStream(jsonlPath)
  for (const entry of broken) ws.write(JSON.stringify(entry) + '\n')
  await new Promise(r => ws.end(r))

  // ── 8. Summary ────────────────────────────────────────────────────────────
  const issueTypes = {}
  for (const b of broken) issueTypes[b.issue] = (issueTypes[b.issue] ?? 0) + 1

  // Categorise no_asset_match: did they have a basename match in a different session?
  const noMatchEntries = broken.filter(b => b.issue === 'no_asset_match')
  const wrongSession   = noMatchEntries.filter(b => b.basename_matches?.length > 0).length
  const trulyMissing   = noMatchEntries.filter(b => b.basename_matches?.length === 0 && b.task_asset_count > 0).length
  const taskHasNoAssets= noMatchEntries.filter(b => b.task_asset_count === 0).length

  const summary = {
    generated_at:           new Date().toISOString(),
    subject:                SUBJECT,
    exam_type:              EXAM_TYPE,
    tasks_total:            tasks.length,
    assets_in_db:           allAssets.length,
    asset_chunk_size_used:  ASSET_CHUNK,
    img_total:              totalImg,
    img_with_match:         withMatch,
    img_no_match:           noMatch,
    no_match_wrong_session: wrongSession,
    no_match_truly_missing: trulyMissing,
    no_match_task_has_no_assets: taskHasNoAssets,
    url_sample_checked:     urlToCheck.size,
    url_404_or_error:       url404.length,
    issues_by_type:         issueTypes,
    manual_mismatch_count:  manualMismatch,
    broken_entries_total:   broken.length,
    sample_404s:            url404.slice(0, 10),
    known_broken_tasks_found: knownBroken.length,
    known_broken_task_ids:  knownBroken.map(t => ({ external_id: t.external_id, id: t.id })),
  }

  const summaryPath = join(ROOT, 'reports', 'math-ege-broken-images-summary.json')
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

  console.log('\n📊  Итоговая сводка:')
  console.log(`  Задач:              ${tasks.length}`)
  console.log(`  Assets в БД:        ${allAssets.length}`)
  console.log(`  Всего <img>:        ${totalImg}`)
  console.log(`  Совпало с asset:    ${withMatch}`)
  console.log(`  no_asset_match:     ${noMatch}  (wrong_session=${wrongSession}, truly_missing=${trulyMissing}, no_assets=${taskHasNoAssets})`)
  console.log(`  HTTP != 200:        ${url404.length}`)
  console.log(`  broken entries:     ${broken.length}`)
  console.log(`\n  По типам:`)
  for (const [type, count] of Object.entries(issueTypes)) {
    console.log(`    ${type}: ${count}`)
  }
  console.log(`\n📄  JSONL:    ${jsonlPath}`)
  console.log(`📄  Summary:  ${summaryPath}`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
