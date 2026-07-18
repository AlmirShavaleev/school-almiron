import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SNAPSHOT_FILE = path.join(__dirname, '..', 'reports', 'physics-ege', 'difficulty-snapshot.json')
const APPLY = process.argv.includes('--apply')
const DB_BATCH_SIZE = 50

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

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size))
  return result
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`Не найден snapshot ${SNAPSHOT_FILE}`)
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))

  const snapshot = readSnapshot()
  const taskIds = snapshot.tasks.map(task => task.task_id)
  console.log(`Snapshot: ${SNAPSHOT_FILE}`)
  console.log(`Tasks in snapshot: ${taskIds.length}`)

  if (!APPLY) {
    console.log('Dry-run only. Для rollback добавьте --apply.')
    return
  }

  for (const batch of chunk(taskIds, DB_BATCH_SIZE)) {
    const { error } = await supabase
      .from('catalog_tasks')
      .update({ difficulty: null })
      .in('id', batch)
    if (error) throw error
  }

  console.log(`Rolled back difficulty to NULL for ${taskIds.length} tasks from snapshot.`)
}

main().catch(error => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
