import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY не задан.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })
const APPLY = process.argv.includes('--apply')
const SOURCE_TAG = 'ai_physics_v1'

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`MODE=${APPLY ? 'APPLY' : 'DRY_RUN'}`)
  console.log('='.repeat(60))

  const beforeResult = await supabase
    .from('catalog_task_topics')
    .select('*', { count: 'exact', head: true })
    .eq('source', SOURCE_TAG)

  if (beforeResult.error) throw beforeResult.error

  const count = beforeResult.count ?? 0
  console.log(`Rows with source='${SOURCE_TAG}': ${count}`)

  if (!APPLY) {
    console.log('Dry-run only. Для удаления добавьте --apply.')
    return
  }

  const deleteResult = await supabase
    .from('catalog_task_topics')
    .delete()
    .eq('source', SOURCE_TAG)

  if (deleteResult.error) throw deleteResult.error

  const afterResult = await supabase
    .from('catalog_task_topics')
    .select('*', { count: 'exact', head: true })
    .eq('source', SOURCE_TAG)

  if (afterResult.error) throw afterResult.error

  console.log(`Deleted rows: ${count}`)
  console.log(`Remaining rows with source='${SOURCE_TAG}': ${afterResult.count ?? 0}`)
}

main().catch(error => {
  console.error('FATAL:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
