/**
 * Загружает кирилличные PNG-файлы, пропущенные основным импортом.
 *
 * Supabase Storage принимает только [a-zA-Z0-9!-_.*()'] в именах объектов.
 * % и ~ отвергаются. Используем 'x' как escape-символ: %D0 → xD0.
 * Оригинальное имя файла сохраняется в поле alt для сопоставления в resolveHtml.
 *
 * Запуск:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/fix-cyrillic-assets.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/fix-cyrillic-assets.mjs --dry-run
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { join, resolve, extname } from 'path'

const SUPABASE_URL   = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const STORAGE_PREFIX = 'math-oge'
const BUCKET         = 'catalog-assets'
const SUBJECT        = 'Математика'
const EXAM_TYPE      = 'ОГЭ'
const CATALOG_DIR    = 'D:/школково спарсенные файлы/shkolkovo_oge_math_catalog/outputs/normalized_catalog'
const IMAGES_DIR     = resolve(CATALOG_DIR, '..', 'shkolkovo_oge_math_images')
const LOCAL_PREFIX   = '../shkolkovo_oge_math_images/'

const DRY_RUN    = process.argv.includes('--dry-run')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) { console.error('❌  SUPABASE_SERVICE_ROLE_KEY не задан'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
const db = supabase

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function cyrillicStoragePath(localPath) {
  const relative = localPath.startsWith(LOCAL_PREFIX)
    ? localPath.slice(LOCAL_PREFIX.length)
    : localPath
  const safe = relative.split('/').map(s => encodeURIComponent(s).replace(/%/g, 'x')).join('/')
  return `${STORAGE_PREFIX}/${safe}`
}

function mime(filename) {
  const ext = extname(filename).toLowerCase()
  return ext === '.svg' ? 'image/svg+xml'
       : ext === '.png' ? 'image/png'
       : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
       : 'application/octet-stream'
}

// catalog_task_assets.jsonl — плоские записи assets, одна на строку
const ASSETS_JSONL = join(CATALOG_DIR, 'catalog_task_assets.jsonl')

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔧  Загрузка кирилличных PNG (dry=${DRY_RUN})`)

  // Fetch task external_id → uuid mapping
  const PAGE = 1000
  const tasks = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await db.from('catalog_tasks')
      .select('id,external_id')
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
      .range(from, from + PAGE - 1)
    tasks.push(...(data ?? []))
    if ((data?.length ?? 0) < PAGE) break
  }
  const taskByExtId = {}
  for (const t of tasks) taskByExtId[String(t.external_id)] = t.id

  // Читаем catalog_task_assets.jsonl — плоские записи assets
  const CYRILLIC_RE = /[А-яЁё]/
  const cyrAssets   = []
  const lines       = readFileSync(ASSETS_JSONL, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const a = JSON.parse(line)
      const origFilename = (a.local_path ?? '').split('/').pop()
      if (CYRILLIC_RE.test(origFilename)) {
        const extId  = String(a.task_external_id ?? '')
        const taskId = taskByExtId[extId]
        cyrAssets.push({ ...a, taskId, extId, origFilename })
      }
    } catch { /* skip malformed */ }
  }

  console.log(`  Кирилличных assets найдено: ${cyrAssets.length}`)
  if (!cyrAssets.length) { console.log('  Нечего загружать.'); return }

  const unique = [...new Set(cyrAssets.map(a => a.origFilename))]
  console.log(`  Уникальных имён (${unique.length}): ${unique.slice(0, 5).join(', ')}${unique.length > 5 ? '...' : ''}`)

  if (DRY_RUN) { console.log('\n✅  --dry-run: запись пропущена'); return }

  let uploaded = 0, errors = 0
  const assetMeta = []

  for (const a of cyrAssets) {
    if (!a.taskId) { console.warn(`  ⚠  задача ${a.extId} не в БД — пропуск`); errors++; continue }

    const storagePath = cyrillicStoragePath(a.local_path)
    const relative    = a.local_path.startsWith(LOCAL_PREFIX)
      ? a.local_path.slice(LOCAL_PREFIX.length)
      : a.local_path
    const localFile   = join(IMAGES_DIR, ...relative.split('/'))

    if (!existsSync(localFile)) { console.warn(`  ⚠  файл не найден: ${localFile}`); errors++; continue }

    const content  = readFileSync(localFile)
    const mimeType = mime(a.origFilename)

    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await supabase.storage.from(BUCKET).upload(storagePath, content, {
        contentType: mimeType, upsert: true,
      })
      if (!error) break
      if (attempt === 3) { console.error(`\n  ✗  ${storagePath}: ${error.message}`); errors++; break }
      await sleep(500 * attempt)
    }

    assetMeta.push({
      task_id:        a.taskId,
      tex_session_id: a.tex_session_id ?? null,
      kind:           a.kind ?? 'condition',
      storage_path:   storagePath,
      alt:            a.origFilename,
      position:       a.position ?? 0,
    })
    uploaded++
    process.stdout.write(`\r  ↳  ${uploaded}/${cyrAssets.length} uploaded, ${errors} errors   `)
  }
  console.log()

  if (assetMeta.length) {
    const BATCH = 200
    for (let i = 0; i < assetMeta.length; i += BATCH) {
      const { error } = await db.from('catalog_task_assets')
        .upsert(assetMeta.slice(i, i + BATCH), { onConflict: 'task_id,storage_path' })
      if (error) { console.error(`  ✗  DB upsert batch ${i}: ${error.message}`); errors++ }
    }
    console.log(`  ✓  ${assetMeta.length} записей в catalog_task_assets`)
  }

  console.log(`\n✅  Готово: ${uploaded} загружено, ${errors} ошибок`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
