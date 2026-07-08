/**
 * Точечное восстановление 8 кирилличных PNG-файлов для Math EGE.
 *
 * Файлы есть локально, но не были загружены в Supabase Storage при импорте.
 * Записи также отсутствуют в catalog_task_assets.
 *
 * Запуск (dry-run):
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/restore-missing-ege-pngs.mjs --dry-run
 *
 * Запуск (реальный):
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/restore-missing-ege-pngs.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'

const SUPABASE_URL    = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const STORAGE_PREFIX  = 'math-ege'
const BUCKET          = 'catalog-assets'
const IMAGES_DIR      = 'C:/Users/User/Documents/Codex/2026-06-22/new-chat/outputs/shkolkovo_math_images'

const DRY_RUN    = process.argv.includes('--dry-run')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!serviceKey) { console.error('❌  SUPABASE_SERVICE_ROLE_KEY не задан'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
const db = supabase

// ── Helpers ───────────────────────────────────────────────────────────────────

function cyrillicStoragePath(sessionId, filename) {
  const safeName = encodeURIComponent(filename).replace(/%/g, 'x')
  return `${STORAGE_PREFIX}/${sessionId}/${safeName}`
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── File list to restore ──────────────────────────────────────────────────────
//
// task_external_id  task_id (UUID)                         session   kind       filename
// ─────────────────────────────────────────────────────────────────────────────────────
// 43564  ad841b2a-fb94-442d-9ae0-10950e0d746f  83289  condition  б.png
// 43564  ad841b2a-fb94-442d-9ae0-10950e0d746f  83288  solution   о-б.png
// 43571  71dbdef1-0ae1-4b82-9d38-1ed855aab360  83304  condition  в.png
// 43571  71dbdef1-0ae1-4b82-9d38-1ed855aab360  83303  solution   о-в.png
// 43702  eebfeb85-3f94-4eca-a097-6f172fb979b7  83518  condition  г.png
// 43702  eebfeb85-3f94-4eca-a097-6f172fb979b7  83517  solution   о-г.png
// 43705  b3788b48-a1a3-4701-8fab-59e54dcb81e8  83523  condition  д.png
// 43705  b3788b48-a1a3-4701-8fab-59e54dcb81e8  83522  solution   о-д.png

const FILES = [
  // ── Round 1: Cyrillic single-letter filenames (б/в/г/д) ──
  { ext_id: 43564, task_id: 'ad841b2a-fb94-442d-9ae0-10950e0d746f', session: 83289, kind: 'condition', filename: 'б.png',        position: 1 },
  { ext_id: 43564, task_id: 'ad841b2a-fb94-442d-9ae0-10950e0d746f', session: 83288, kind: 'solution',  filename: 'о-б.png',      position: 1 },
  { ext_id: 43571, task_id: '71dbdef1-0ae1-4b82-9d38-1ed855aab360', session: 83304, kind: 'condition', filename: 'в.png',        position: 1 },
  { ext_id: 43571, task_id: '71dbdef1-0ae1-4b82-9d38-1ed855aab360', session: 83303, kind: 'solution',  filename: 'о-в.png',      position: 1 },
  { ext_id: 43702, task_id: 'eebfeb85-3f94-4eca-a097-6f172fb979b7', session: 83518, kind: 'condition', filename: 'г.png',        position: 1 },
  { ext_id: 43702, task_id: 'eebfeb85-3f94-4eca-a097-6f172fb979b7', session: 83517, kind: 'solution',  filename: 'о-г.png',      position: 1 },
  { ext_id: 43705, task_id: 'b3788b48-a1a3-4701-8fab-59e54dcb81e8', session: 83523, kind: 'condition', filename: 'д.png',        position: 1 },
  { ext_id: 43705, task_id: 'b3788b48-a1a3-4701-8fab-59e54dcb81e8', session: 83522, kind: 'solution',  filename: 'о-д.png',      position: 1 },
  // ── Round 2: additional Cyrillic filenames found in re-audit ──
  { ext_id: 36428,  task_id: '8d747e8d-bc0a-495f-9f09-4755804d0a9b', session: 70228,  kind: 'solution',  filename: 'парыч-1.jpg',  position: 1 },
  { ext_id: 148821, task_id: '0a7fa083-7772-4bd1-9ae8-c3de00903276', session: 315119, kind: 'solution',  filename: 'тетраэдр1.png', position: 1 },
  { ext_id: 148823, task_id: '24ed90fc-6614-45dd-ba62-e63f78217931', session: 315128, kind: 'solution',  filename: 'тетраэдр2.png', position: 1 },
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔧  Восстановление ${FILES.length} PNG-файлов Math EGE (dry=${DRY_RUN})\n`)

  const results = []

  for (const f of FILES) {
    const localFile   = `${IMAGES_DIR}/${f.session}/${f.filename}`
    const storagePath = cyrillicStoragePath(f.session, f.filename)

    console.log(`\n── ext=${f.ext_id} | ${f.filename} (${f.kind}) ──────────────────`)
    console.log(`   local:   ${localFile}`)
    console.log(`   storage: ${storagePath}`)

    // 1. Check local file exists
    if (!existsSync(localFile)) {
      console.error(`   ❌  Файл не найден локально: ${localFile}`)
      results.push({ ...f, status: 'local_missing' })
      continue
    }
    const fileBuffer = readFileSync(localFile)
    console.log(`   ✓  Файл найден локально (${fileBuffer.length} байт)`)

    if (DRY_RUN) {
      console.log(`   [dry-run] Пропуск загрузки в Storage`)
      console.log(`   [dry-run] Пропуск вставки в catalog_task_assets`)
      results.push({ ...f, storagePath, status: 'dry_run' })
      continue
    }

    // 2. Upload to Storage (upsert=true so safe to re-run)
    const ext = f.filename.split('.').pop().toLowerCase()
    const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                      : ext === 'svg' ? 'image/svg+xml'
                      : 'image/png'
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: true,
      })
    if (uploadErr) {
      console.error(`   ❌  Storage upload failed: ${uploadErr.message}`)
      results.push({ ...f, storagePath, status: 'upload_error', error: uploadErr.message })
      continue
    }
    console.log(`   ✓  Загружено в Storage`)

    // 3. Verify public URL returns 200
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
    const publicUrl = urlData.publicUrl
    const resp = await fetch(publicUrl, { method: 'HEAD' })
    if (!resp.ok) {
      console.error(`   ❌  HTTP ${resp.status} для ${publicUrl}`)
      results.push({ ...f, storagePath, publicUrl, status: `http_${resp.status}` })
      continue
    }
    console.log(`   ✓  HTTP ${resp.status} ─ URL рабочий`)

    // 4. Check if DB record already exists
    const { data: existing } = await db
      .from('catalog_task_assets')
      .select('id')
      .eq('task_id', f.task_id)
      .eq('storage_path', storagePath)
      .maybeSingle()

    if (existing) {
      console.log(`   ℹ️  Запись в catalog_task_assets уже существует (id=${existing.id})`)
      results.push({ ...f, storagePath, publicUrl, status: 'already_exists' })
      continue
    }

    // 5. Insert into catalog_task_assets
    // IMPORTANT: alt stores the ORIGINAL Cyrillic filename (e.g. "б.png"), not "PIC".
    // resolveHtml matches via: a.alt === decodedSrc (where decodedSrc = src attr from HTML)
    // The storage_path uses x-encoding (б.png → xD0xB1.png) which safeDecodeStoragePath
    // does NOT reverse, so the only working match path is alt === src.
    const record = {
      task_id:        f.task_id,
      tex_session_id: f.session,
      kind:           f.kind,
      storage_path:   storagePath,
      alt:            f.filename,   // original Cyrillic name: "б.png", "о-б.png", etc.
      position:       f.position,
    }
    const { error: insertErr } = await db
      .from('catalog_task_assets')
      .insert(record)

    if (insertErr) {
      console.error(`   ❌  DB insert failed: ${insertErr.message}`)
      results.push({ ...f, storagePath, publicUrl, status: 'db_error', error: insertErr.message })
      continue
    }
    console.log(`   ✓  Запись добавлена в catalog_task_assets`)

    results.push({ ...f, storagePath, publicUrl, status: 'success' })
    await sleep(200)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n\n══════════ ИТОГ ══════════')
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'dry_run' ? '🔵' : r.status === 'already_exists' ? 'ℹ️' : '❌'
    console.log(`${icon}  ext=${r.ext_id} | ${r.filename} (${r.kind}) → ${r.status}`)
    if (r.storagePath) console.log(`      storage_path: ${r.storagePath}`)
    if (r.error) console.log(`      error: ${r.error}`)
  }

  const ok  = results.filter(r => r.status === 'success' || r.status === 'already_exists').length
  const err = results.filter(r => !['success','already_exists','dry_run'].includes(r.status)).length
  console.log(`\n${ok}/${FILES.length} успешно, ${err} ошибок`)
}

main().catch(e => { console.error(e); process.exit(1) })
