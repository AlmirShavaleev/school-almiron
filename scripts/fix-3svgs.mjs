import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const BUCKET       = 'catalog-assets'
const PREFIX       = 'math-oge'
const IMAGES_BASE  = 'D:/школково спарсенные файлы/shkolkovo_oge_math_catalog/outputs/shkolkovo_oge_math_images'
const ASSETS_JSONL = 'D:/школково спарсенные файлы/shkolkovo_oge_math_catalog/outputs/normalized_catalog/catalog_task_assets.jsonl'

const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!key) { console.error('❌  SUPABASE_SERVICE_ROLE_KEY не задан'); process.exit(1) }
const sb = createClient(SUPABASE_URL, key, { auth: { persistSession: false } })

const FAILED = [
  { taskExtId: '332703', file: 'index-2282b151ebe30f00c01bb793e413336d.svg' },
  { taskExtId: '332703', file: 'index-83b053a56f0061834b857af450d85235.svg' },
  { taskExtId: '343118', file: 'index-2d5ad3d187fbaad6241ac6b4e6bb194f.svg' },
]

const { data: tasks } = await sb.from('catalog_tasks').select('id,external_id').in('external_id', ['332703','343118'])
const taskMap = {}
for (const t of tasks ?? []) taskMap[String(t.external_id)] = t.id

const assetLines = readFileSync(ASSETS_JSONL, 'utf8').split('\n').filter(Boolean)

let ok = 0, err = 0
for (const f of FAILED) {
  const storagePath = `${PREFIX}/${f.taskExtId}/${f.file}`
  const localFile   = `${IMAGES_BASE}/${f.taskExtId}/${f.file}`

  if (!existsSync(localFile)) { console.error(`✗ файл не найден: ${localFile}`); err++; continue }

  const content = readFileSync(localFile)
  const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, content, {
    contentType: 'image/svg+xml', upsert: true,
  })
  if (upErr) { console.error(`✗ upload ${f.file}: ${upErr.message}`); err++; continue }

  const rec = assetLines.map(l => { try { return JSON.parse(l) } catch { return null } })
    .find(a => a && String(a.task_external_id) === f.taskExtId && (a.local_path ?? '').endsWith(f.file))

  const { error: dbErr } = await sb.from('catalog_task_assets').upsert({
    task_id:        taskMap[f.taskExtId],
    tex_session_id: rec?.tex_session_id ?? null,
    kind:           rec?.kind ?? 'condition',
    storage_path:   storagePath,
    alt:            rec?.alt ?? null,
    position:       rec?.position ?? 0,
  }, { onConflict: 'task_id,storage_path' })

  if (dbErr) { console.error(`✗ db ${f.file}: ${dbErr.message}`); err++; continue }
  console.log(`✓ ${storagePath}`)
  ok++
}

console.log(`\n${ok === 3 ? '✅' : '⚠️'}  Готово: ${ok}/3 загружено, ${err} ошибок`)
