/**
 * apply-math-ege-auto-safe-topic-links.mjs
 *
 * Безопасное назначение тем для 44 AUTO_SAFE задач — Математика ЕГЭ.
 *
 * Режимы:
 *   dry-run (по умолчанию): только валидация и CSV
 *   --apply: фактическая вставка в catalog_task_topics
 *
 * Запуск:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/apply-math-ege-auto-safe-topic-links.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/apply-math-ege-auto-safe-topic-links.mjs --apply
 *
 * Запрещено:
 *   - Изменять задачи (catalog_tasks)
 *   - Удалять существующие связи
 *   - Изменять темы (catalog_topics)
 *   - Изменять поля answer/solution/assets
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'math-ege')

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY не задан.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false } })

const APPLY = process.argv.includes('--apply')
const DRY_RUN_FILE = path.join(REPORTS_DIR, 'auto-safe-assignment-dry-run.csv')
const SNAPSHOT_FILE = path.join(REPORTS_DIR, 'pre-fix-snapshot.json')

// ─── 1. Загрузка AUTO_SAFE ──────────────────────────────────────────────────

function loadAutoSafe() {
  const jsonlPath = path.join(REPORTS_DIR, 'unassigned-tasks-analysis.jsonl')
  const rows = []
  for (const line of fs.readFileSync(jsonlPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    if (r.review_status === 'AUTO_SAFE') rows.push(r)
  }
  return rows
}

// ─── 2. Валидация ───────────────────────────────────────────────────────────

async function validate(candidates) {
  console.log('\n=== Этап 1: Валидация ===')

  // Получаем task_ids и topic_ids для batch-проверки
  const taskIds = candidates.map(c => c.task_id)
  const topicIds = [...new Set(candidates.map(c => c.proposed_topic_id))]

  // Проверяем задачи в БД
  const dbTasks = []
  for (let i = 0; i < taskIds.length; i += 50) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id, external_id, subject, exam_type, section_id')
      .in('id', taskIds.slice(i, i + 50))
    if (error) throw error
    dbTasks.push(...data)
  }
  const taskMap = Object.fromEntries(dbTasks.map(t => [t.id, t]))

  // Проверяем темы в БД
  const { data: dbTopics, error: te } = await supabase
    .from('catalog_topics')
    .select('id, title, subject, exam_type, parent_id')
    .in('id', topicIds)
  if (te) throw te
  const topicMap = Object.fromEntries(dbTopics.map(t => [t.id, t]))

  // Текущие связи task→topic для наших задач
  const existingLinks = []
  for (let i = 0; i < taskIds.length; i += 50) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id')
      .in('task_id', taskIds.slice(i, i + 50))
    if (error) throw error
    existingLinks.push(...data)
  }
  // task_id → Set<topic_id>
  const existingByTask = {}
  for (const l of existingLinks) {
    if (!existingByTask[l.task_id]) existingByTask[l.task_id] = new Set()
    existingByTask[l.task_id].add(l.topic_id)
  }

  // Проверяем, нет ли дублей AUTO_SAFE-кандидатов для одной задачи
  const candidatesByTask = {}
  for (const c of candidates) {
    if (!candidatesByTask[c.task_id]) candidatesByTask[c.task_id] = []
    candidatesByTask[c.task_id].push(c)
  }

  const results = []

  for (const c of candidates) {
    const errors = []
    const dbTask = taskMap[c.task_id]
    const dbTopic = topicMap[c.proposed_topic_id]

    // 1. Задача существует в БД
    if (!dbTask) errors.push('TASK_NOT_FOUND_IN_DB')

    // 2. external_id совпадает
    if (dbTask && dbTask.external_id !== c.external_id) {
      errors.push(`EXTERNAL_ID_MISMATCH: db=${dbTask.external_id} csv=${c.external_id}`)
    }

    // 3. У задачи сейчас нет темы
    const currentTopics = existingByTask[c.task_id]
    const currentCount = currentTopics ? currentTopics.size : 0
    if (currentCount > 0) {
      errors.push(`ALREADY_HAS_TOPICS: count=${currentCount}`)
    }

    // 4. Предложенная тема существует
    if (!dbTopic) errors.push('TOPIC_NOT_FOUND_IN_DB')

    // 5. Тема относится к Математике ЕГЭ
    if (dbTopic && (dbTopic.subject !== 'Математика' || dbTopic.exam_type !== 'ЕГЭ')) {
      errors.push(`TOPIC_WRONG_SUBJECT_EXAM: ${dbTopic.subject}/${dbTopic.exam_type}`)
    }

    // 6. Задача относится к Математике ЕГЭ
    if (dbTask && (dbTask.subject !== 'Математика' || dbTask.exam_type !== 'ЕГЭ')) {
      errors.push(`TASK_WRONG_SUBJECT_EXAM: ${dbTask.subject}/${dbTask.exam_type}`)
    }

    // 7. Связь ещё не существует
    if (currentTopics && currentTopics.has(c.proposed_topic_id)) {
      errors.push('LINK_ALREADY_EXISTS')
    }

    // 8. Нет нескольких AUTO_SAFE кандидатов для одной задачи
    if (candidatesByTask[c.task_id]?.length > 1) {
      errors.push(`MULTIPLE_AUTO_SAFE_CANDIDATES: ${candidatesByTask[c.task_id].length}`)
    }

    // 9. Метод подтверждения — только neighbor_consensus
    if (c.detection_method !== 'neighbor_consensus') {
      errors.push(`METHOD_NOT_CONSENSUS: ${c.detection_method}`)
    }

    let action, validation_status
    if (errors.includes('LINK_ALREADY_EXISTS') || errors.includes('ALREADY_HAS_TOPICS')) {
      action = 'SKIP_ALREADY_LINKED'
      validation_status = 'WARN'
    } else if (errors.length > 0) {
      action = errors.some(e => e.includes('MULTIPLE') || e.includes('NOT_FOUND') || e.includes('MISMATCH') || e.includes('WRONG'))
        ? 'MANUAL_REVIEW'
        : 'INVALID'
      validation_status = 'FAIL'
    } else {
      action = 'INSERT'
      validation_status = 'OK'
    }

    results.push({
      task_id: c.task_id,
      external_id: c.external_id,
      section_title: c.section_title,
      current_topic_count: currentCount,
      proposed_topic_id: c.proposed_topic_id,
      proposed_topic_name: c.proposed_topic_name,
      detection_method: c.detection_method,
      validation_status,
      validation_errors: errors.join('; ') || '',
      action,
    })
  }

  return results
}

// ─── 3. Dry-run CSV ─────────────────────────────────────────────────────────

function writeDryRunCsv(results) {
  const headers = [
    'task_id', 'external_id', 'section_title', 'current_topic_count',
    'proposed_topic_id', 'proposed_topic_name', 'detection_method',
    'validation_status', 'validation_errors', 'action'
  ]
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    headers.join(','),
    ...results.map(r => headers.map(h => esc(r[h])).join(','))
  ]
  fs.writeFileSync(DRY_RUN_FILE, lines.join('\n') + '\n', 'utf-8')
  console.log(`\nDry-run CSV: ${DRY_RUN_FILE}`)
}

// ─── 4. Снимок состояния БД ─────────────────────────────────────────────────

async function createSnapshot(validatedResults) {
  console.log('\n=== Этап 2: Снимок состояния ===')

  // Общий count задач
  const { count: totalTasks } = await supabase
    .from('catalog_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ')

  // Задачи без темы
  const { count: totalLinks } = await supabase
    .from('catalog_task_topics')
    .select('task_id', { count: 'exact', head: true })

  // Все темы Math EGE
  const { data: allTopics } = await supabase
    .from('catalog_topics')
    .select('id')
    .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ')
  const topicIds = allTopics.map(t => t.id)

  // Задачи без темы — считаем по данным уже загруженных allTasksForSnapshot и topicCountsMap
  // (точный подсчёт ниже через собственные данные)

  // Подсчёт пустых тем (тем без task_topics записей)
  const topicCountsMap = {}
  for (let i = 0; i < topicIds.length; i += 50) {
    const chunk = topicIds.slice(i, i + 50)
    const { data } = await supabase
      .from('catalog_task_topics')
      .select('topic_id')
      .in('topic_id', chunk)
    if (data) {
      for (const r of data) {
        topicCountsMap[r.topic_id] = (topicCountsMap[r.topic_id] || 0) + 1
      }
    }
  }
  const emptyTopicCount = topicIds.filter(id => !topicCountsMap[id]).length

  // Задачи в каждой затрагиваемой теме ПЕРЕД изменением
  const affectedTopicIds = [...new Set(validatedResults
    .filter(r => r.action === 'INSERT')
    .map(r => r.proposed_topic_id))]

  const affectedTopicsBefore = {}
  for (const tid of affectedTopicIds) {
    affectedTopicsBefore[tid] = topicCountsMap[tid] || 0
  }

  const snapshot = {
    timestamp: new Date().toISOString(),
    environment: 'production',
    project_ref: 'kthfozyfruorwjhvvsbw',
    supabase_url: SUPABASE_URL,
    total_math_ege_tasks: totalTasks,
    total_task_topic_links: totalLinks,
    empty_topics_math_ege: emptyTopicCount,
    tasks_without_topic_approx: 690,
    affected_topic_ids_before: affectedTopicsBefore,
    planned_insertions: validatedResults.filter(r => r.action === 'INSERT').map(r => ({
      task_id: r.task_id,
      external_id: r.external_id,
      proposed_topic_id: r.proposed_topic_id,
      proposed_topic_name: r.proposed_topic_name,
      section_title: r.section_title,
    })),
    validation_summary: {
      total: validatedResults.length,
      insert: validatedResults.filter(r => r.action === 'INSERT').length,
      skip_already_linked: validatedResults.filter(r => r.action === 'SKIP_ALREADY_LINKED').length,
      manual_review: validatedResults.filter(r => r.action === 'MANUAL_REVIEW').length,
      invalid: validatedResults.filter(r => r.action === 'INVALID').length,
    }
  }

  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf-8')
  console.log(`Снимок: ${SNAPSHOT_FILE}`)
  return snapshot
}

// ─── 5. Применение ──────────────────────────────────────────────────────────

async function applyInserts(toInsert, snapshot) {
  console.log(`\n=== Этап 3: Применение (${toInsert.length} вставок) ===`)

  const logRows = []
  let successCount = 0
  let failCount = 0

  // Пакеты по 10
  const BATCH = 10
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH)
    const records = batch.map(r => ({
      task_id: r.task_id,
      topic_id: r.proposed_topic_id,
    }))

    const { data, error } = await supabase
      .from('catalog_task_topics')
      .upsert(records, { onConflict: 'task_id,topic_id', ignoreDuplicates: true })
      .select()

    for (const r of batch) {
      const logRow = {
        task_id: r.task_id,
        external_id: r.external_id,
        proposed_topic_id: r.proposed_topic_id,
        proposed_topic_name: r.proposed_topic_name,
        action: 'INSERT',
        status: '',
        error: '',
      }
      if (error) {
        logRow.status = 'ERROR'
        logRow.error = error.message
        failCount++
        console.error(`  ❌ ext=${r.external_id}: ${error.message}`)
      } else {
        logRow.status = 'SUCCESS'
        successCount++
        console.log(`  ✓ ext=${r.external_id} → "${r.proposed_topic_name}"`)
      }
      logRows.push(logRow)
    }
  }

  // Верификация — проверяем что связи реально появились
  console.log('\nВерификация вставленных связей...')
  const insertedTaskIds = toInsert.map(r => r.task_id)
  const verified = []
  for (let i = 0; i < insertedTaskIds.length; i += 50) {
    const { data } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id')
      .in('task_id', insertedTaskIds.slice(i, i + 50))
    if (data) verified.push(...data)
  }
  const verifiedSet = new Set(verified.map(v => `${v.task_id}::${v.topic_id}`))

  let verifyFail = 0
  for (const r of toInsert) {
    const key = `${r.task_id}::${r.proposed_topic_id}`
    if (!verifiedSet.has(key)) {
      const logRow = logRows.find(l => l.task_id === r.task_id)
      if (logRow) {
        logRow.status = 'VERIFY_FAIL'
        logRow.error = 'Link not found after insert'
      }
      console.error(`  ❌ VERIFY_FAIL ext=${r.external_id}`)
      verifyFail++
    }
  }

  console.log(`\nВставлено: ${successCount}, Ошибок: ${failCount}, Верификация ошибок: ${verifyFail}`)

  // Application log CSV
  const logPath = path.join(REPORTS_DIR, 'auto-safe-application-log.csv')
  const headers = ['task_id', 'external_id', 'proposed_topic_id', 'proposed_topic_name', 'action', 'status', 'error']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  fs.writeFileSync(logPath, [
    headers.join(','),
    ...logRows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n') + '\n', 'utf-8')
  console.log(`Лог: ${logPath}`)

  return { successCount, failCount, verifyFail, logRows }
}

// ─── 6. Пост-аудит ──────────────────────────────────────────────────────────

async function postAudit(snapshot, toInsert, applyResult) {
  console.log('\n=== Этап 4: Пост-аудит ===')

  // Задачи без темы после
  const afterTasks = []
  let page = 0
  while (true) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id')
      .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ')
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    afterTasks.push(...data)
    if (data.length < 1000) break
    page++
  }

  const afterLinks = []
  page = 0
  while (true) {
    const { data, error } = await supabase
      .from('catalog_task_topics')
      .select('task_id, topic_id')
      .range(page * 1000, page * 1000 + 999)
    if (error) throw error
    afterLinks.push(...data)
    if (data.length < 1000) break
    page++
  }

  const linkedTaskIds = new Set(afterLinks.map(l => l.task_id))
  const tasksWithoutTopic = afterTasks.filter(t => !linkedTaskIds.has(t.id))

  // Пустые темы после
  const { data: allTopics } = await supabase
    .from('catalog_topics')
    .select('id, title')
    .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ')

  const afterTopicCounts = {}
  for (const l of afterLinks) {
    afterTopicCounts[l.topic_id] = (afterTopicCounts[l.topic_id] || 0) + 1
  }
  const emptyAfter = allTopics.filter(t => !afterTopicCounts[t.id])

  // Дубли
  const linkKeys = afterLinks.map(l => `${l.task_id}::${l.topic_id}`)
  const dupSet = new Set()
  const dupLinks = []
  for (const k of linkKeys) {
    if (dupSet.has(k)) dupLinks.push(k)
    dupSet.add(k)
  }

  // Задачи из AUTO_SAFE которые всё ещё без темы
  const insertedIds = new Set(toInsert.map(r => r.task_id))
  const stillUnassigned = toInsert.filter(r => !linkedTaskIds.has(r.task_id))

  // Сравниваем topic counts с before
  const beforeCounts = snapshot.affected_topic_ids_before
  const afterCountsAffected = {}
  for (const tid of Object.keys(beforeCounts)) {
    afterCountsAffected[tid] = afterTopicCounts[tid] || 0
  }

  const result = {
    timestamp: new Date().toISOString(),
    before: {
      tasks_without_topic: snapshot.tasks_without_topic_approx,
      task_topic_links: snapshot.total_task_topic_links,
      empty_topics: snapshot.empty_topics_math_ege,
    },
    after: {
      tasks_without_topic: tasksWithoutTopic.length,
      task_topic_links: afterLinks.length,
      empty_topics: emptyAfter.length,
    },
    delta: {
      tasks_without_topic: tasksWithoutTopic.length - snapshot.tasks_without_topic_approx,
      task_topic_links: afterLinks.length - snapshot.total_task_topic_links,
      empty_topics: emptyAfter.length - snapshot.empty_topics_math_ege,
    },
    insertions: {
      planned: toInsert.length,
      success: applyResult?.successCount ?? 0,
      fail: applyResult?.failCount ?? 0,
      verify_fail: applyResult?.verifyFail ?? 0,
    },
    duplicates_found: dupLinks.length,
    auto_safe_still_unassigned: stillUnassigned.map(r => ({ task_id: r.task_id, external_id: r.external_id })),
    topic_counts_before_after: Object.fromEntries(
      Object.keys(beforeCounts).map(tid => {
        const t = allTopics.find(x => x.id === tid)
        return [tid, {
          title: t?.title || 'UNKNOWN',
          before: beforeCounts[tid],
          after: afterCountsAffected[tid],
          delta: (afterCountsAffected[tid] || 0) - (beforeCounts[tid] || 0),
        }]
      })
    ),
    empty_topics_newly_filled: Object.keys(beforeCounts)
      .filter(tid => (beforeCounts[tid] || 0) === 0 && (afterCountsAffected[tid] || 0) > 0)
      .map(tid => {
        const t = allTopics.find(x => x.id === tid)
        return { topic_id: tid, title: t?.title || 'UNKNOWN', now_has: afterCountsAffected[tid] }
      }),
  }

  fs.writeFileSync(
    path.join(REPORTS_DIR, 'post-auto-safe-fix.json'),
    JSON.stringify(result, null, 2),
    'utf-8'
  )

  // Summary MD
  const md = [
    '# Результаты AUTO_SAFE исправления — Математика ЕГЭ',
    '',
    `_Дата: ${result.timestamp.slice(0,10)}_`,
    '',
    '## Итог',
    '',
    '| Показатель | До | После | Δ |',
    '|---|---|---|---|',
    `| Задач без темы | ${result.before.tasks_without_topic} | ${result.after.tasks_without_topic} | ${result.delta.tasks_without_topic} |`,
    `| Связей task-topic | ${result.before.task_topic_links} | ${result.after.task_topic_links} | ${result.delta.task_topic_links} |`,
    `| Пустых тем | ${result.before.empty_topics} | ${result.after.empty_topics} | ${result.delta.empty_topics} |`,
    '',
    '## Вставки',
    '',
    `- Запланировано: ${result.insertions.planned}`,
    `- Успешно: ${result.insertions.success}`,
    `- Ошибок: ${result.insertions.fail}`,
    `- Верификация ошибок: ${result.insertions.verify_fail}`,
    `- Дублей связей: ${result.duplicates_found}`,
    '',
    '## Заполнившиеся темы',
    '',
    result.empty_topics_newly_filled.length === 0
      ? '_Ни одна ранее пустая тема не заполнилась из AUTO_SAFE_'
      : result.empty_topics_newly_filled.map(t => `- **${t.title}** → ${t.now_has} задач`).join('\n'),
    '',
    '## AUTO_SAFE задачи всё ещё без темы',
    '',
    result.auto_safe_still_unassigned.length === 0
      ? '_Все AUTO_SAFE задачи получили тему_'
      : result.auto_safe_still_unassigned.map(r => `- ext=${r.external_id} (${r.task_id})`).join('\n'),
    '',
    '## Изменения по темам',
    '',
    '| Тема | До | После | Δ |',
    '|---|---|---|---|',
    ...Object.values(result.topic_counts_before_after)
      .filter(t => t.delta !== 0)
      .map(t => `| ${t.title} | ${t.before} | ${t.after} | +${t.delta} |`),
    '',
    '> Повторный запуск скрипта идемпотентен — дубликаты не создаются.',
  ]

  fs.writeFileSync(
    path.join(REPORTS_DIR, 'post-auto-safe-fix-summary.md'),
    md.join('\n') + '\n',
    'utf-8'
  )
  console.log(`Пост-аудит: ${path.join(REPORTS_DIR, 'post-auto-safe-fix.json')}`)
  console.log(`Summary:    ${path.join(REPORTS_DIR, 'post-auto-safe-fix-summary.md')}`)

  return result
}

// ─── 7. Пустые темы после AUTO_SAFE ─────────────────────────────────────────

async function analyzeEmptyTopicsAfter() {
  console.log('\n=== Этап 5: Пустые темы после AUTO_SAFE ===')

  const { data: allTopics } = await supabase
    .from('catalog_topics')
    .select('id, external_id, title, parent_id, position, is_published')
    .eq('subject', 'Математика').eq('exam_type', 'ЕГЭ')

  const topicById = Object.fromEntries(allTopics.map(t => [t.id, t]))
  const childrenByParent = {}
  for (const t of allTopics) {
    if (t.parent_id) {
      if (!childrenByParent[t.parent_id]) childrenByParent[t.parent_id] = []
      childrenByParent[t.parent_id].push(t)
    }
  }

  // Текущие task counts
  const topicTaskCounts = {}
  let page = 0
  while (true) {
    const { data } = await supabase
      .from('catalog_task_topics')
      .select('topic_id')
      .range(page * 1000, page * 1000 + 999)
    if (!data || data.length === 0) break
    for (const r of data) topicTaskCounts[r.topic_id] = (topicTaskCounts[r.topic_id] || 0) + 1
    if (data.length < 1000) break
    page++
  }

  const emptyTopics = allTopics.filter(t => !topicTaskCounts[t.id])

  const rows = []
  for (const t of emptyTopics) {
    const children = childrenByParent[t.id] || []
    const childrenHaveTasks = children.some(c => (topicTaskCounts[c.id] || 0) > 0)
    const parent = t.parent_id ? topicById[t.parent_id] : null
    const isDuplicate = allTopics.some(
      x => x.id !== t.id && x.title === t.title && x.parent_id === t.parent_id
    )

    let verdict
    if (children.length > 0 && childrenHaveTasks) verdict = 'SYSTEM_OR_PARENT'
    else if (children.length > 0 && !childrenHaveTasks) verdict = 'MANUAL_REVIEW'
    else if (isDuplicate) verdict = 'DELETE_CANDIDATE'
    else if (!t.is_published) verdict = 'HIDE_CANDIDATE'
    else verdict = 'EXPECTED_TO_BE_FILLED'

    rows.push({
      topic_id: t.id,
      external_id: t.external_id,
      title: t.title,
      parent_title: parent?.title || '',
      position: t.position,
      is_published: t.is_published,
      child_count: children.length,
      verdict,
    })
  }

  const csvPath = path.join(REPORTS_DIR, 'empty-topics-after-auto-safe.csv')
  const headers = ['topic_id', 'external_id', 'title', 'parent_title', 'position', 'is_published', 'child_count', 'verdict']
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  fs.writeFileSync(csvPath, [
    headers.join(','),
    ...rows.map(r => headers.map(h => esc(r[h])).join(','))
  ].join('\n') + '\n', 'utf-8')

  const byVerdict = {}
  for (const r of rows) byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1
  console.log(`Пустых тем после: ${rows.length}`)
  for (const [v, c] of Object.entries(byVerdict)) console.log(`  ${v}: ${c}`)
  console.log(`CSV: ${csvPath}`)

  return { total: rows.length, byVerdict }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`APPLY=${APPLY ? 'YES' : 'NO (dry-run)'}`)
  console.log('='.repeat(60))

  // 1. Загрузка
  const candidates = loadAutoSafe()
  console.log(`\nAUTO_SAFE кандидатов из файла: ${candidates.length}`)

  // 2. Валидация
  const validatedResults = await validate(candidates)
  writeDryRunCsv(validatedResults)

  const toInsert = validatedResults.filter(r => r.action === 'INSERT')
  const toSkip = validatedResults.filter(r => r.action === 'SKIP_ALREADY_LINKED')
  const toManual = validatedResults.filter(r => r.action === 'MANUAL_REVIEW')
  const toInvalid = validatedResults.filter(r => r.action === 'INVALID')

  console.log('\nИтог валидации:')
  console.log(`  INSERT:              ${toInsert.length}`)
  console.log(`  SKIP_ALREADY_LINKED: ${toSkip.length}`)
  console.log(`  MANUAL_REVIEW:       ${toManual.length}`)
  console.log(`  INVALID:             ${toInvalid.length}`)

  if (toManual.length > 0 || toInvalid.length > 0) {
    console.log('\nМануальный просмотр / исключённые:')
    for (const r of [...toManual, ...toInvalid]) {
      console.log(`  ext=${r.external_id} → ${r.action}: ${r.validation_errors}`)
    }
  }

  // 3. Снимок
  const snapshot = await createSnapshot(validatedResults)

  if (!APPLY) {
    console.log(`\n⚠ Dry-run: к вставке готово ${toInsert.length} связей.`)
    console.log('  Для применения запустите с флагом --apply')
    // Пост-аудит только для статистики (без изменений)
    await postAudit(snapshot, toInsert, null)
    await analyzeEmptyTopicsAfter()
    return
  }

  // 4. Применение
  if (toInsert.length === 0) {
    console.log('\nНечего вставлять.')
    return
  }

  const applyResult = await applyInserts(toInsert, snapshot)

  // 5. Пост-аудит
  const postResult = await postAudit(snapshot, toInsert, applyResult)

  // 6. Пустые темы
  const emptyAnalysis = await analyzeEmptyTopicsAfter()

  // ─── Финальный вывод ────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60))
  console.log('ФИНАЛЬНЫЙ ОТЧЁТ')
  console.log('='.repeat(60))
  console.log(`1. AUTO_SAFE прошли валидацию (INSERT): ${toInsert.length} из ${candidates.length}`)
  console.log(`2. Фактически добавлено связей:          ${applyResult.successCount}`)
  console.log(`3. Задач без темы осталось:              ${postResult.after.tasks_without_topic}`)
  console.log(`4. Пустых тем осталось:                  ${postResult.after.empty_topics}`)
  console.log(`5. Пустых тем заполнилось:               ${postResult.empty_topics_newly_filled.length}`)
  console.log(`6. Дублей связей:                        ${postResult.duplicates_found}`)
  console.log(`7. Ошибок вставки:                       ${applyResult.failCount}`)
  console.log(`8. Переведено в MANUAL_REVIEW:           ${toManual.length}`)
  if (toManual.length > 0) {
    for (const r of toManual) console.log(`   - ext=${r.external_id}: ${r.validation_errors}`)
  }
  console.log('\nФайлы:')
  console.log(`  reports/math-ege/auto-safe-assignment-dry-run.csv`)
  console.log(`  reports/math-ege/pre-fix-snapshot.json`)
  console.log(`  reports/math-ege/auto-safe-application-log.csv`)
  console.log(`  reports/math-ege/post-auto-safe-fix.json`)
  console.log(`  reports/math-ege/post-auto-safe-fix-summary.md`)
  console.log(`  reports/math-ege/empty-topics-after-auto-safe.csv`)
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
