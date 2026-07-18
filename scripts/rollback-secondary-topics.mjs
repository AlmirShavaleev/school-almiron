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

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'physics-ege')
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'secondary-apply-snapshot.json')
const SOURCE_TAG = 'ai_physics_v1'
const APPLY = process.argv.includes('--apply')

function formatError(error) {
  if (error instanceof Error) return `${error.message}\n${error.stack || ''}`.trim()
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`Не найден snapshot ${SNAPSHOT_FILE}`)
  }
  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
}

async function rollbackRow(row) {
  const result = await supabase
    .from('catalog_task_topics')
    .delete()
    .eq('task_id', row.task_id)
    .eq('topic_id', row.topic_id)
    .eq('source', SOURCE_TAG)
    .eq('is_primary', false)
    .select('task_id, topic_id')

  if (result.error) throw result.error
  return result.data?.length ?? 0
}

async function main() {
  const snapshot = readSnapshot()
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : []

  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))
  console.log(`Snapshot rows: ${rows.length}`)

  if (!APPLY) {
    console.log('Dry-run only. Для удаления добавьте --apply.')
    return
  }

  let deleted = 0
  let missing = 0
  let errors = 0

  for (const row of rows) {
    try {
      const deletedCount = await rollbackRow(row)
      if (deletedCount > 0) deleted += deletedCount
      else missing++
    } catch (error) {
      errors++
      console.error(`ROLLBACK ERROR ext=${row.external_id} topic=${row.topic_title}: ${formatError(error)}`)
    }
  }

  console.log(`ГОТОВО: удалено ${deleted}, не найдено ${missing}, ошибок ${errors}`)
}

main().catch(error => {
  console.error('FATAL:')
  console.error(formatError(error))
  process.exit(1)
})
