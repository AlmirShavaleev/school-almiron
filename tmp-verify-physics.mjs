/** Разовая сверка: что в базе против того, что сейчас на диске. */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = 'D:/Школково 2026-2027 Основная папка/Физика ЕГЭ'
const COURSE = 'daf8c6a3-e37f-465d-ac3e-fcadb055342a'

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}
const env = { ...readEnvFile('.env'), ...readEnvFile('.env.import.local') }
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const label = n => (n.match(/^\d+\s+(.+)\.pdf$/i)?.[1] ?? n.replace(/\.pdf$/i, '')).trim()

// ── диск ──
const disk = new Map()   // "модуль|тема|метка" → размер
for (const mod of readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory())) {
  const modTitle = mod.name.replace(/^\d+\s+/, '')
  for (const lesson of readdirSync(join(ROOT, mod.name), { withFileTypes: true })) {
    if (!lesson.isDirectory() || !/^Урок\s+\d+\s+-\s+/.test(lesson.name)) continue
    const topic = Number(lesson.name.match(/^Урок\s+(\d+)/)[1])
    const dir = join(ROOT, mod.name, lesson.name)
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile() || !/\.pdf$/i.test(f.name)) continue
      disk.set(`${modTitle}|${topic}|${label(f.name)}`, statSync(join(dir, f.name)).size)
    }
  }
}

// ── база ──
const { data: modules } = await db.from('modules').select('id, title').eq('course_id', COURSE)
const dbFiles = new Map()
for (const m of modules) {
  const { data: topics } = await db.from('topics').select("id, order_index").eq("module_id", m.id)
  for (const t of topics) {
    const { data: mats } = await db.from('topic_material_items')
      .select('file_name, size_bytes').eq('topic_id', t.id)
    for (const r of mats) dbFiles.set(`${m.title}|${t.order_index}|${label(r.file_name ?? '')}`, Number(r.size_bytes))
    const { data: hw } = await db.from('topic_homework').select('id').eq('topic_id', t.id)
    if (hw?.length) {
      const { data: hwf } = await db.from('topic_homework_files')
        .select('original_filename, size_bytes').eq('homework_id', hw[0].id)
      for (const r of hwf) dbFiles.set(`${m.title}|${t.order_index}|${label(r.original_filename)}`, Number(r.size_bytes))
    }
  }
}

const onlyDb = [...dbFiles.keys()].filter(k => !disk.has(k))
const onlyDisk = [...disk.keys()].filter(k => !dbFiles.has(k))
const sizeDiff = [...dbFiles.entries()].filter(([k, v]) => disk.has(k) && disk.get(k) !== v)

console.log(`на диске: ${disk.size}   в базе: ${dbFiles.size}`)
console.log(`\nЕСТЬ В БАЗЕ, НЕТ НА ДИСКЕ (${onlyDb.length}):`)
onlyDb.forEach(k => console.log('  · ' + k))
console.log(`\nЕСТЬ НА ДИСКЕ, НЕТ В БАЗЕ (${onlyDisk.length}):`)
onlyDisk.forEach(k => console.log('  · ' + k))
console.log(`\nРАЗМЕР РАЗОШЁЛСЯ (${sizeDiff.length}):`)
sizeDiff.forEach(([k, v]) => console.log(`  · ${k}: база ${v}, диск ${disk.get(k)}`))
