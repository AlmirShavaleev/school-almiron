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
const EXCLUDED_SECTION_NUMBERS = new Set([18, 19])
const IMAGES_DIR = 'D:/школково спарсенные файлы/shkolkovo_physics_catalog/outputs/shkolkovo_physics_images'
const NORMALIZED_DIR = 'D:/школково спарсенные файлы/shkolkovo_physics_catalog/outputs/normalized_catalog'
const ASSETS_FILE = path.join(NORMALIZED_DIR, 'catalog_task_assets.jsonl')
const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const REPORT_FILE = path.join(REPORTS_DIR, 'recover-assets-report.json')
const REQUEST_DELAY_MS = 300
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 600

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null
const DRY_RUN = args.includes('--dry-run')

if (limitIdx !== -1 && (!Number.isFinite(LIMIT) || LIMIT <= 0)) {
  console.error('❌ --limit должен быть положительным числом.')
  process.exit(1)
}

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

function listLocalMedia(externalId) {
  const dir = path.join(IMAGES_DIR, String(externalId))
  if (!fs.existsSync(dir)) {
    return { png: [], svg: [] }
  }

  const files = fs.readdirSync(dir)
  return {
    png: files.filter(name => name.toLowerCase().endsWith('.png')),
    svg: files.filter(name => name.toLowerCase().endsWith('.svg')),
  }
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function groupAssetsByTask(rows) {
  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.task_external_id)) grouped.set(row.task_external_id, [])
    grouped.get(row.task_external_id).push(row)
  }
  return grouped
}

function selectCandidateTasks(tasks, assetsByTask, limit) {
  const preferredSections = [13, 11, 12, 14, 15, 16, 17, 4, 9, 5, 3, 2, 1]

  const candidates = tasks
    .filter(task => {
      const statementText = stripHtmlKeepImgAlt(task.statement_html)
      const assetRows = assetsByTask.get(task.external_id) || []
      const conditionPngRows = assetRows.filter(row =>
        row.kind === 'condition' &&
        /\.png$/i.test(row.local_path || '') &&
        row.source_url
      )
      const missingPngRows = conditionPngRows.filter(row => {
        const filename = path.basename(row.local_path)
        return !fs.existsSync(path.join(IMAGES_DIR, String(task.external_id), filename))
      })

      return statementText.includes('[PIC]') && missingPngRows.length > 0
    })
    .map(task => ({
      ...task,
      localMedia: listLocalMedia(task.external_id),
      assetRows: (assetsByTask.get(task.external_id) || []).filter(row => {
        if (!(row.kind === 'condition' && /\.png$/i.test(row.local_path || '') && row.source_url)) return false
        const filename = path.basename(row.local_path)
        return !fs.existsSync(path.join(IMAGES_DIR, String(task.external_id), filename))
      }),
    }))

  const bySection = new Map()
  for (const task of candidates) {
    const section = task.catalog_sections?.exam_number ?? null
    if (!bySection.has(section)) bySection.set(section, [])
    bySection.get(section).push(task)
  }

  const orderedSections = [
    ...preferredSections.filter(section => bySection.has(section)),
    ...[...bySection.keys()].filter(section => !preferredSections.includes(section)).sort((a, b) => a - b),
  ]

  const selected = []
  const selectedIds = new Set()

  for (const section of orderedSections) {
    const tasksInSection = bySection.get(section) || []
    if (tasksInSection.length === 0) continue
    const task = tasksInSection[0]
    selected.push(task)
    selectedIds.add(task.id)
    if (limit && selected.length >= limit) return selected
  }

  for (const section of orderedSections) {
    for (const task of bySection.get(section) || []) {
      if (limit && selected.length >= limit) return selected
      if (selectedIds.has(task.id)) continue
      selected.push(task)
      selectedIds.add(task.id)
    }
  }

  return limit ? selected.slice(0, limit) : selected
}

async function fetchCandidateTasks() {
  const { data, error } = await supabase
    .from('catalog_tasks')
    .select(`
      id,
      external_id,
      source_url,
      statement_html,
      catalog_sections!inner(
        exam_number,
        title
      )
    `)
    .eq('subject', SUBJECT)
    .eq('exam_type', EXAM_TYPE)

  if (error) throw error

  return (data || []).filter(row => !EXCLUDED_SECTION_NUMBERS.has(row.catalog_sections?.exam_number))
}

async function downloadAsset(url, targetPath) {
  let attempt = 0
  let retrySuccess = false
  let lastError = null

  while (attempt <= MAX_RETRIES) {
    if (attempt > 0) {
      const backoffMs = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))
      await new Promise(resolve => setTimeout(resolve, backoffMs))
    }

    try {
      const response = await fetch(url)
      const httpStatus = response.status

      if (httpStatus === 404) {
        return { ok: false, httpStatus, saved: false, attempts: attempt + 1, retrySuccess }
      }

      if (!response.ok) {
        if (httpStatus >= 500 && attempt < MAX_RETRIES) {
          attempt++
          continue
        }
        return { ok: false, httpStatus, saved: false, attempts: attempt + 1, retrySuccess }
      }

      const bytes = Buffer.from(await response.arrayBuffer())
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, bytes)
      return { ok: true, httpStatus, saved: true, bytes: bytes.length, attempts: attempt + 1, retrySuccess: attempt > 0 }
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES) {
        attempt++
        retrySuccess = true
        continue
      }
      return {
        ok: false,
        httpStatus: null,
        saved: false,
        attempts: attempt + 1,
        retrySuccess,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    ok: false,
    httpStatus: null,
    saved: false,
    attempts: MAX_RETRIES + 1,
    retrySuccess,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  }
}

async function main() {
  console.log('=== Recover Physics Assets ===')
  console.log(`Лимит задач: ${LIMIT ?? 'all'}`)
  if (DRY_RUN) console.log('Режим: dry-run')

  const assetRows = readJsonl(ASSETS_FILE)
  const assetsByTask = groupAssetsByTask(assetRows)
  const tasks = await fetchCandidateTasks()
  const selectedTasks = selectCandidateTasks(tasks, assetsByTask, LIMIT)

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    requested_limit: LIMIT,
    selected_tasks: [],
    summary: {
      selected_tasks: selectedTasks.length,
      asset_urls_total: 0,
      http_200: 0,
      http_404: 0,
      http_other_error: 0,
      retry_successes: 0,
      final_failures: 0,
      files_saved: 0,
      tasks_with_local_png_after: 0,
      failed_tasks: [],
    },
  }

  for (let taskIndex = 0; taskIndex < selectedTasks.length; taskIndex++) {
    const task = selectedTasks[taskIndex]
    const taskDir = path.join(IMAGES_DIR, String(task.external_id))
    const attempts = []

    for (const asset of task.assetRows) {
      const filename = path.basename(asset.local_path)
      const targetPath = path.join(taskDir, filename)
      const existedBefore = fs.existsSync(targetPath)

      report.summary.asset_urls_total++

      if (DRY_RUN) {
        attempts.push({
          source_url: asset.source_url,
          target_path: targetPath,
          existed_before: existedBefore,
          skipped: existedBefore ? 'already_exists' : 'dry_run',
        })
        continue
      }

      if (existedBefore) {
        attempts.push({
          source_url: asset.source_url,
          target_path: targetPath,
          existed_before: true,
          skipped: 'already_exists',
        })
        continue
      }

      try {
        const result = await downloadAsset(asset.source_url, targetPath)
        if (result.retrySuccess) report.summary.retry_successes++
        if (result.httpStatus === 200) report.summary.http_200++
        else if (result.httpStatus === 404) report.summary.http_404++
        else report.summary.http_other_error++
        if (result.saved) report.summary.files_saved++
        if (!result.saved && !result.ok) report.summary.final_failures++

        attempts.push({
          source_url: asset.source_url,
          target_path: targetPath,
          existed_before: false,
          http_status: result.httpStatus,
          saved: result.saved,
          bytes: result.bytes ?? 0,
          attempts_count: result.attempts ?? 1,
          retry_success: Boolean(result.retrySuccess),
          error: result.error ?? null,
        })

        if (!result.saved && !result.ok) {
          report.summary.failed_tasks.push({
            external_id: task.external_id,
            section_exam_number: task.catalog_sections?.exam_number ?? null,
            source_url: task.source_url ?? null,
            asset_url: asset.source_url,
            target_path: targetPath,
            http_status: result.httpStatus,
            error: result.error ?? null,
          })
        }
      } catch (error) {
        report.summary.http_other_error++
        report.summary.final_failures++
        attempts.push({
          source_url: asset.source_url,
          target_path: targetPath,
          existed_before: false,
          http_status: null,
          saved: false,
          error: error instanceof Error ? error.message : String(error),
        })
        report.summary.failed_tasks.push({
          external_id: task.external_id,
          section_exam_number: task.catalog_sections?.exam_number ?? null,
          source_url: task.source_url ?? null,
          asset_url: asset.source_url,
          target_path: targetPath,
          http_status: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (!DRY_RUN) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS))
      }
    }

    const localAfter = listLocalMedia(task.external_id)
    if (localAfter.png.length > 0) report.summary.tasks_with_local_png_after++

    report.selected_tasks.push({
      external_id: task.external_id,
      section_exam_number: task.catalog_sections?.exam_number ?? null,
      section_title: task.catalog_sections?.title ?? '',
      source_url: task.source_url ?? null,
      png_count_after: localAfter.png.length,
      attempts,
    })

    if ((taskIndex + 1) % 25 === 0 || taskIndex + 1 === selectedTasks.length) {
      console.log(`Прогресс: ${taskIndex + 1}/${selectedTasks.length} задач`)
      fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
    }
  }

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report.summary, null, 2))
  console.log(`Report: ${REPORT_FILE}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
