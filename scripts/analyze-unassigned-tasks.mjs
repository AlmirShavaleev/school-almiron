/**
 * Анализ 690 задач без темы — Математика ЕГЭ
 * Метод: находим соседних задач по позиции в разделе, у которых тема есть
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
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY не задан. Запустите:\n  SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/analyze-unassigned-tasks.mjs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'math-ege')
fs.mkdirSync(REPORTS_DIR, { recursive: true })

function stripHtml(html = '') {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

function extractCatalogId(sourceUrl = '') {
  const m = sourceUrl.match(/\/catalog\/(\d+)\/\d+/)
  return m ? parseInt(m[1]) : null
}

// catalog_id → раздел shkolkovo (из source URL)
const CATALOG_ID_MAP = {
  3: '№1. Планиметрия',
  5: '№6. Простейшие уравнения',
  9: '№7. Преобразования и вычисления',
  10: '№9. Стереометрия',
  11: '№10. Текстовые задачи',
  12: '№11. Вероятность',
  13: '№12. Производная',
  14: '№13. Геометрический смысл',
  15: '№15. Неравенства',
  16: '№17. Планиметрия',
  17: '№16. Стереометрия',
  18: '№18. Задачи с параметром',
  19: '№19. Задачи на теорию чисел',
}

async function fetchAllInBatches(ids, fetcher) {
  const results = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const rows = await fetcher(chunk)
    results.push(...rows)
  }
  return results
}

async function main() {
  console.log('=== Анализ задач без темы — Математика ЕГЭ ===\n')

  // 1. Все задачи Математики ЕГЭ — пагинация по 1000
  console.log('Загружаю все задачи...')
  const allTasksRaw = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id, external_id, position, section_id, source_url')
      .eq('subject', 'Математика')
      .eq('exam_type', 'ЕГЭ')
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    allTasksRaw.push(...data)
    if (data.length < 1000) break
    page++
  }
  console.log(`Всего задач: ${allTasksRaw.length}`)

  // 2. Все связи task→topic — пагинация
  console.log('Загружаю task_topics...')
  const topicLinks = []
  let tpage = 0
  while (true) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id')
      .range(tpage * 1000, tpage * 1000 + 999)
    if (error) throw error
    topicLinks.push(...data)
    if (data.length < 1000) break
    tpage++
  }
  console.log(`Связей task→topic: ${topicLinks.length}`)

  const taskTopicMap = {}
  for (const link of topicLinks) {
    taskTopicMap[link.task_id] = link.topic_id
  }

  // 3. Все темы
  const { data: topicsRaw, error: e3 } = await supabase
    .from('catalog_topics')
    .select('id, external_id, title, parent_id, position')
    .eq('subject', 'Математика')
    .eq('exam_type', 'ЕГЭ')
  if (e3) throw e3

  const topicById = {}
  for (const t of topicsRaw) topicById[t.id] = t
  console.log(`Тем: ${topicsRaw.length}`)

  // 4. Разделяем задачи: с темой и без
  const withTopic = allTasksRaw.filter(t => taskTopicMap[t.id])
  const withoutTopic = allTasksRaw.filter(t => !taskTopicMap[t.id])
  console.log(`\nС темой: ${withTopic.length}, Без темы: ${withoutTopic.length}`)

  // 5. Группируем задачи по section_id (для поиска соседей)
  const tasksBySection = {}
  for (const t of allTasksRaw) {
    const sid = t.section_id
    if (!tasksBySection[sid]) tasksBySection[sid] = []
    tasksBySection[sid].push(t)
  }
  for (const sid of Object.keys(tasksBySection)) {
    tasksBySection[sid].sort((a, b) => a.position - b.position)
  }

  // 6. Получаем полные данные для 690 задач без темы (statement_html, section title)
  console.log('\nЗагружаю данные 690 задач без темы...')
  const unassignedIds = withoutTopic.map(t => t.id)
  const fullData = []
  for (let i = 0; i < unassignedIds.length; i += 50) {
    const chunk = unassignedIds.slice(i, i + 50)
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select(`
        id, external_id, position, source_url,
        statement_html,
        catalog_sections!inner(title)
      `)
      .in('id', chunk)
    if (error) throw error
    fullData.push(...data)
  }

  const fullDataMap = {}
  for (const d of fullData) fullDataMap[d.id] = d

  // 7. Для каждой задачи без темы ищем соседей с темой
  console.log('\nАнализирую соседей...')

  const WINDOW = 10 // смотрим ±10 позиций

  const analysisRows = []

  for (const task of withoutTopic) {
    const sectionTasks = tasksBySection[task.section_id] || []
    const idx = sectionTasks.findIndex(t => t.id === task.id)

    // Соседние задачи с темами
    const neighbors = []
    for (let d = 1; d <= WINDOW && neighbors.length < 6; d++) {
      const prev = idx - d >= 0 ? sectionTasks[idx - d] : null
      const next = idx + d < sectionTasks.length ? sectionTasks[idx + d] : null
      if (prev && taskTopicMap[prev.id]) {
        neighbors.push({ task: prev, dist: -d, topic_id: taskTopicMap[prev.id] })
      }
      if (next && taskTopicMap[next.id]) {
        neighbors.push({ task: next, dist: +d, topic_id: taskTopicMap[next.id] })
      }
    }

    // Считаем наиболее частую тему среди ближайших соседей
    const topicCounts = {}
    for (const n of neighbors) {
      topicCounts[n.topic_id] = (topicCounts[n.topic_id] || 0) + 1
    }
    const sortedTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1])

    let proposed_topic_id = null
    let proposed_topic_name = null
    let confidence = 'low'
    let detection_method = 'no_neighbors'
    let alternative_topics = []

    if (sortedTopics.length > 0) {
      const [bestTopicId, bestCount] = sortedTopics[0]
      const topic = topicById[bestTopicId]
      proposed_topic_id = bestTopicId
      proposed_topic_name = topic?.title || 'UNKNOWN'

      // Ближайший сосед с этой темой
      const minDist = neighbors
        .filter(n => n.topic_id === bestTopicId)
        .reduce((min, n) => Math.min(min, Math.abs(n.dist)), WINDOW + 1)

      const total = neighbors.length
      const agree = bestCount
      const isConsensus = agree >= total * 0.8 && total >= 3

      if (minDist <= 2 && isConsensus) {
        confidence = 'high'
        detection_method = 'neighbor_consensus'
      } else if (minDist <= 5 && agree >= 2) {
        confidence = 'medium'
        detection_method = 'neighbor_majority'
      } else {
        confidence = 'low'
        detection_method = 'nearest_neighbor'
      }

      alternative_topics = sortedTopics
        .slice(1, 4)
        .map(([tid]) => topicById[tid]?.title || tid)
    }

    // Родительская тема
    const parentTopic = proposed_topic_id && topicById[proposed_topic_id]?.parent_id
      ? topicById[topicById[proposed_topic_id].parent_id]
      : null

    const fd = fullDataMap[task.id] || {}
    const catalogId = extractCatalogId(task.source_url)
    const sourceSection = CATALOG_ID_MAP[catalogId] || `catalog/${catalogId}`

    analysisRows.push({
      task_id: task.id,
      external_id: task.external_id,
      exam_number: (fd.catalog_sections?.title || '').match(/№(\d+)/)?.[1] || '',
      section_title: fd.catalog_sections?.title || '',
      statement_preview: stripHtml(fd.statement_html),
      source_url: task.source_url,
      source_catalog_id: catalogId,
      source_section: sourceSection,
      position: task.position,
      proposed_topic_id,
      proposed_topic_name,
      proposed_parent_topic: parentTopic?.title || '',
      confidence,
      detection_method,
      alternative_topics: alternative_topics.join(' | '),
      neighbors_found: neighbors.length,
      neighbors_agree: sortedTopics[0]?.[1] || 0,
      review_status: confidence === 'high' ? 'AUTO_SAFE' : 'NEEDS_REVIEW',
      comment: '',
    })
  }

  // 8. Статистика
  const byConfidence = { high: 0, medium: 0, low: 0 }
  const bySection = {}
  for (const r of analysisRows) {
    byConfidence[r.confidence]++
    bySection[r.section_title] = (bySection[r.section_title] || 0) + 1
  }

  console.log('\n--- Результаты ---')
  console.log(`HIGH confidence (AUTO_SAFE): ${byConfidence.high}`)
  console.log(`MEDIUM confidence: ${byConfidence.medium}`)
  console.log(`LOW confidence: ${byConfidence.low}`)
  console.log('\nПо разделам:')
  for (const [sec, cnt] of Object.entries(bySection).sort((a, b) => b[1] - a[1])) {
    const hc = analysisRows.filter(r => r.section_title === sec && r.confidence === 'high').length
    console.log(`  ${sec}: ${cnt} задач (${hc} high)`)
  }

  // 9. Записываем reports

  // JSONL
  const jsonlPath = path.join(REPORTS_DIR, 'unassigned-tasks-analysis.jsonl')
  const jsonlLines = analysisRows.map(r => JSON.stringify(r))
  fs.writeFileSync(jsonlPath, jsonlLines.join('\n') + '\n', 'utf-8')
  console.log(`\nЗаписан: ${jsonlPath}`)

  // CSV
  const csvHeaders = [
    'task_id', 'external_id', 'exam_number', 'section_title',
    'statement_preview', 'source_url', 'source_section',
    'proposed_topic_id', 'proposed_topic_name', 'proposed_parent_topic',
    'confidence', 'detection_method', 'alternative_topics',
    'neighbors_found', 'neighbors_agree', 'review_status', 'comment'
  ]
  const csvEsc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csvLines = [
    csvHeaders.join(','),
    ...analysisRows.map(r => csvHeaders.map(h => csvEsc(r[h])).join(','))
  ]
  const csvPath = path.join(REPORTS_DIR, 'unassigned-tasks-review.csv')
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf-8')
  console.log(`Записан: ${csvPath}`)

  // Summary MD
  const autoSafe = analysisRows.filter(r => r.review_status === 'AUTO_SAFE')
  const needsReview = analysisRows.filter(r => r.review_status === 'NEEDS_REVIEW')

  // Топ предложенных тем
  const topicProposalCounts = {}
  for (const r of analysisRows) {
    if (r.proposed_topic_name) {
      topicProposalCounts[r.proposed_topic_name] = (topicProposalCounts[r.proposed_topic_name] || 0) + 1
    }
  }
  const topTopics = Object.entries(topicProposalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  const mdLines = [
    '# Отчёт: 690 задач без темы — Математика ЕГЭ',
    '',
    `_Дата анализа: 2026-06-25_`,
    '',
    '## Общая статистика',
    '',
    `| Параметр | Значение |`,
    `|---|---|`,
    `| Всего задач без темы | ${analysisRows.length} |`,
    `| HIGH confidence (AUTO_SAFE) | ${byConfidence.high} |`,
    `| MEDIUM confidence | ${byConfidence.medium} |`,
    `| LOW confidence | ${byConfidence.low} |`,
    `| Нет соседей для анализа | ${analysisRows.filter(r => r.detection_method === 'no_neighbors').length} |`,
    '',
    '## По разделам',
    '',
    '| Раздел | Всего | HIGH | MEDIUM | LOW |',
    '|---|---|---|---|---|',
    ...Object.entries(bySection)
      .sort((a, b) => b[1] - a[1])
      .map(([sec]) => {
        const rows = analysisRows.filter(r => r.section_title === sec)
        const h = rows.filter(r => r.confidence === 'high').length
        const m = rows.filter(r => r.confidence === 'medium').length
        const l = rows.filter(r => r.confidence === 'low').length
        return `| ${sec} | ${rows.length} | ${h} | ${m} | ${l} |`
      }),
    '',
    '## Топ предложенных тем',
    '',
    '| Тема | Кол-во задач |',
    '|---|---|',
    ...topTopics.map(([name, cnt]) => `| ${name} | ${cnt} |`),
    '',
    '## Метод определения',
    '',
    '- **neighbor_consensus** — 80%+ соседей в радиусе ≤2 позиций указывают на одну тему → HIGH',
    '- **neighbor_majority** — большинство соседей в радиусе ≤5, ≥2 голоса → MEDIUM',
    '- **nearest_neighbor** — только ближайший сосед → LOW',
    '- **no_neighbors** — нет соседей с темой → LOW',
    '',
    '## Пример AUTO_SAFE задач (первые 10)',
    '',
    '| external_id | Раздел | Предложенная тема | Метод |',
    '|---|---|---|---|',
    ...autoSafe.slice(0, 10).map(r =>
      `| ${r.external_id} | ${r.section_title} | ${r.proposed_topic_name} | ${r.detection_method} |`
    ),
    '',
    '## Задачи без предложенной темы',
    '',
    ...analysisRows
      .filter(r => !r.proposed_topic_id)
      .map(r => `- external_id=${r.external_id} | ${r.section_title} | ${r.source_url}`),
    '',
    '## Следующие шаги (ожидают подтверждения)',
    '',
    `1. Просмотреть CSV: \`reports/math-ege/unassigned-tasks-review.csv\``,
    `2. Подтвердить AUTO_SAFE задачи (${autoSafe.length} шт.) — допускают пакетный INSERT в catalog_task_topics`,
    `3. Вручную назначить NEEDS_REVIEW задачи (${needsReview.length} шт.)`,
    `4. Для задач без темы — проверить соседей вручную или оставить без темы`,
    '',
    '> **СТОП**: Никаких изменений в БД до получения подтверждения.',
  ]

  const mdPath = path.join(REPORTS_DIR, 'unassigned-tasks-summary.md')
  fs.writeFileSync(mdPath, mdLines.join('\n') + '\n', 'utf-8')
  console.log(`Записан: ${mdPath}`)

  console.log('\n✓ Анализ завершён. Ожидайте подтверждения перед применением.')
}

main().catch(err => { console.error(err); process.exit(1) })
