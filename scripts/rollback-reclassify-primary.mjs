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
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'reclassify-apply-snapshot.json')
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

async function restoreTask(task) {
  const newTopicId = task.new_primary_topic_id
  const oldTopicId = task.old_primary_topic_id

  const deleteNew = await supabase
    .from('catalog_task_topics')
    .delete()
    .eq('task_id', task.task_id)
    .eq('topic_id', newTopicId)
    .eq('source', 'ai_physics_v1')

  if (deleteNew.error) throw deleteNew.error

  const oldLink = (task.existing_links || []).find(link => link.topic_id === oldTopicId)
  if (!oldLink) {
    throw new Error(`Snapshot does not contain old link for task_id=${task.task_id} topic_id=${oldTopicId}`)
  }

  const restoreOld = await supabase
    .from('catalog_task_topics')
    .upsert({
      task_id: task.task_id,
      topic_id: oldLink.topic_id,
      is_primary: oldLink.is_primary,
      source: oldLink.source,
    }, { onConflict: 'task_id,topic_id' })

  if (restoreOld.error) throw restoreOld.error
}

async function main() {
  const snapshot = readSnapshot()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))
  console.log(`Snapshot tasks: ${snapshot.tasks.length}`)

  if (!APPLY) {
    console.log('Dry-run only. Для восстановления добавьте --apply.')
    return
  }

  let restored = 0
  let errors = 0

  for (const task of snapshot.tasks) {
    try {
      await restoreTask(task)
      restored++
    } catch (error) {
      errors++
      console.error(`ROLLBACK ERROR ext=${task.external_id}: ${formatError(error)}`)
    }
  }

  console.log(`ГОТОВО: восстановлено ${restored}, ошибок ${errors}`)
}

main().catch(error => {
  console.error('FATAL:')
  console.error(formatError(error))
  process.exit(1)
})
