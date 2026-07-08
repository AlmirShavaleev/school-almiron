/**
 * Анализ пустых тем — Математика ЕГЭ
 * "Пустая тема" = тема без единой задачи в catalog_task_topics
 * НЕ ДЕЛАЕТ никаких изменений в БД
 */

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

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'math-ege')

// Признаки служебных тем (родительских контейнеров)
function isLikelyParentContainer(topic, children) {
  // У неё есть дочерние темы
  return children.length > 0
}

function isLikelyDuplicate(topic, allTopics) {
  // Точно такой же заголовок у другой темы в той же иерархии
  return allTopics.some(t => t.id !== topic.id && t.title === topic.title && t.parent_id === topic.parent_id)
}

function classifyEmpty(topic, children, siblings, allTopics, topicTaskCounts) {
  const hasChildren = children.length > 0
  const childrenHaveTasks = children.some(c => (topicTaskCounts[c.id] || 0) > 0)
  const isDuplicate = isLikelyDuplicate(topic, allTopics)
  const siblingCounts = siblings.map(s => topicTaskCounts[s.id] || 0)
  const avgSiblingTasks = siblingCounts.length > 0
    ? siblingCounts.reduce((a, b) => a + b, 0) / siblingCounts.length
    : 0

  if (isDuplicate) {
    return { verdict: 'DELETE_CANDIDATE', reason: 'Дубликат заголовка в той же группе' }
  }
  if (hasChildren && childrenHaveTasks) {
    return { verdict: 'KEEP', reason: 'Родительский контейнер — дочерние темы имеют задачи' }
  }
  if (hasChildren && !childrenHaveTasks) {
    return { verdict: 'MANUAL_REVIEW', reason: 'Родительский контейнер — дочерние темы тоже пусты' }
  }
  if (!topic.is_published) {
    return { verdict: 'HIDE_IN_UI', reason: 'Уже unpublished — скрыть из UI или удалить' }
  }
  if (avgSiblingTasks < 5) {
    return { verdict: 'MANUAL_REVIEW', reason: 'Сестринские темы тоже малонаселены — возможно весь раздел требует пересмотра' }
  }
  return { verdict: 'FILL_FROM_UNASSIGNED', reason: 'Изолированно пустая — кандидат на заполнение из 690 неназначенных задач' }
}

async function main() {
  console.log('=== Анализ пустых тем — Математика ЕГЭ ===\n')

  // 1. Все темы
  const { data: allTopics, error: e1 } = await supabase
    .from('catalog_topics')
    .select('id, external_id, title, parent_id, position, is_published')
    .eq('subject', 'Математика')
    .eq('exam_type', 'ЕГЭ')
  if (e1) throw e1
  console.log(`Всего тем: ${allTopics.length}`)

  // 2. Количество задач на тему (из task_topics)
  const topicTaskCounts = {}
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('topic_id')
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    for (const r of data) {
      topicTaskCounts[r.topic_id] = (topicTaskCounts[r.topic_id] || 0) + 1
    }
    if (data.length < 1000) break
    page++
  }

  // 3. Индексы
  const topicById = {}
  for (const t of allTopics) topicById[t.id] = t

  const childrenByParent = {}
  for (const t of allTopics) {
    if (t.parent_id) {
      if (!childrenByParent[t.parent_id]) childrenByParent[t.parent_id] = []
      childrenByParent[t.parent_id].push(t)
    }
  }

  // 4. Пустые темы (нет задач напрямую)
  const emptyTopics = allTopics.filter(t => !topicTaskCounts[t.id])
  console.log(`Пустых тем: ${emptyTopics.length}`)

  // 5. Классификация каждой
  const rows = []
  for (const topic of emptyTopics) {
    const children = childrenByParent[topic.id] || []
    const parent = topic.parent_id ? topicById[topic.parent_id] : null
    const siblings = parent
      ? (childrenByParent[parent.id] || []).filter(s => s.id !== topic.id)
      : allTopics.filter(t => !t.parent_id && t.id !== topic.id)

    const { verdict, reason } = classifyEmpty(topic, children, siblings, allTopics, topicTaskCounts)

    // Подсчитываем задачи в потомках (рекурсивно 1 уровень)
    const childTasksTotal = children.reduce((s, c) => s + (topicTaskCounts[c.id] || 0), 0)

    rows.push({
      topic_id: topic.id,
      external_id: topic.external_id,
      title: topic.title,
      parent_id: topic.parent_id || '',
      parent_title: parent?.title || '',
      position: topic.position,
      is_published: topic.is_published,
      child_count: children.length,
      child_task_total: childTasksTotal,
      verdict,
      reason,
    })
  }

  // 6. Статистика
  const byVerdict = {}
  for (const r of rows) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1

  console.log('\n--- Результаты ---')
  for (const [v, cnt] of Object.entries(byVerdict).sort()) {
    console.log(`  ${v}: ${cnt}`)
  }

  // 7. CSV
  const csvHeaders = [
    'topic_id', 'external_id', 'title', 'parent_title',
    'position', 'is_published', 'child_count', 'child_task_total',
    'verdict', 'reason'
  ]
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csvPath = path.join(REPORTS_DIR, 'empty-topics-analysis.csv')
  fs.writeFileSync(csvPath, [
    csvHeaders.join(','),
    ...rows.map(r => csvHeaders.map(h => esc(r[h])).join(','))
  ].join('\n') + '\n', 'utf-8')
  console.log(`\nЗаписан: ${csvPath}`)

  // 8. Summary MD
  const KEEP = rows.filter(r => r.verdict === 'KEEP')
  const FILL = rows.filter(r => r.verdict === 'FILL_FROM_UNASSIGNED')
  const HIDE = rows.filter(r => r.verdict === 'HIDE_IN_UI')
  const DELETE = rows.filter(r => r.verdict === 'DELETE_CANDIDATE')
  const MANUAL = rows.filter(r => r.verdict === 'MANUAL_REVIEW')

  const md = [
    '# Отчёт: Пустые темы — Математика ЕГЭ',
    '',
    `_Дата анализа: 2026-06-25_`,
    '',
    '## Общая статистика',
    '',
    '| Вердикт | Количество | Описание |',
    '|---|---|---|',
    `| KEEP | ${KEEP.length} | Родительские контейнеры с задачами в дочерних |`,
    `| FILL_FROM_UNASSIGNED | ${FILL.length} | Кандидаты на заполнение из 690 неназначенных |`,
    `| HIDE_IN_UI | ${HIDE.length} | Unpublished — скрыть или удалить |`,
    `| DELETE_CANDIDATE | ${DELETE.length} | Дубликаты заголовков |`,
    `| MANUAL_REVIEW | ${MANUAL.length} | Требуют ручного рассмотрения |`,
    `| **Итого** | **${rows.length}** | |`,
    '',
    '## KEEP — родительские контейнеры',
    '',
    KEEP.length === 0 ? '_нет_' : KEEP.map(r => `- **${r.title}** (ext=${r.external_id}) — ${r.child_count} дочерних тем, ${r.child_task_total} задач в потомках`).join('\n'),
    '',
    '## FILL_FROM_UNASSIGNED — кандидаты на заполнение',
    '',
    FILL.length === 0 ? '_нет_' : FILL.slice(0, 30).map(r => `- **${r.title}** (ext=${r.external_id}) | родитель: ${r.parent_title || '—'}`).join('\n'),
    FILL.length > 30 ? `\n_...и ещё ${FILL.length - 30} тем — см. CSV_` : '',
    '',
    '## HIDE_IN_UI — unpublished темы',
    '',
    HIDE.length === 0 ? '_нет_' : HIDE.map(r => `- **${r.title}** (ext=${r.external_id}) | published=${r.is_published}`).join('\n'),
    '',
    '## DELETE_CANDIDATE — дубликаты',
    '',
    DELETE.length === 0 ? '_нет_' : DELETE.map(r => `- **${r.title}** (ext=${r.external_id}) | родитель: ${r.parent_title || '—'}`).join('\n'),
    '',
    '## MANUAL_REVIEW',
    '',
    MANUAL.length === 0 ? '_нет_' : MANUAL.map(r => `- **${r.title}** (ext=${r.external_id}) | ${r.reason}`).join('\n'),
    '',
    '## Связь с 690 задачами без темы',
    '',
    `Из ${FILL.length} тем-кандидатов на заполнение можно попробовать назначить задачи`,
    'из списка \`unassigned-tasks-review.csv\` где confidence=medium/high и предложенная тема',
    'совпадает с одной из этих пустых тем.',
    '',
    '## Следующие шаги (ожидают подтверждения)',
    '',
    `1. KEEP (${KEEP.length}) — оставить как есть, не трогать`,
    `2. FILL_FROM_UNASSIGNED (${FILL.length}) — заполнить из неназначенных после утверждения Ч1`,
    `3. HIDE_IN_UI (${HIDE.length}) — установить is_published=false (уже false)`,
    `4. DELETE_CANDIDATE (${DELETE.length}) — удалить дубликаты после ручной проверки`,
    `5. MANUAL_REVIEW (${MANUAL.length}) — ручной просмотр`,
    '',
    '> **СТОП**: Никаких изменений в БД до получения подтверждения.',
  ]

  const mdPath = path.join(REPORTS_DIR, 'empty-topics-summary.md')
  fs.writeFileSync(mdPath, md.join('\n') + '\n', 'utf-8')
  console.log(`Записан: ${mdPath}`)

  console.log('\n✓ Анализ завершён.')
}

main().catch(err => { console.error(err); process.exit(1) })
