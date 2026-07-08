/**
 * audit-math-ege-catalog.mjs — аудит структуры каталога Математика ЕГЭ
 *
 * Генерирует:
 *   reports/math-ege/catalog-summary.json
 *   reports/math-ege/task-errors.jsonl
 *   reports/math-ege/html-errors.jsonl
 *   reports/math-ege/answer-errors.jsonl
 *   reports/math-ege/solution-errors.jsonl
 *   reports/math-ege/manual-review.csv
 *
 * Запуск:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/audit-math-ege-catalog.mjs
 * Или с service role для обхода RLS:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-math-ege-catalog.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://kthfozyfruorwjhvvsbw.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? SUPABASE_ANON
const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })

const SUBJECT   = 'Математика'
const EXAM_TYPE = 'ЕГЭ'
const OUT_DIR   = join(process.cwd(), 'reports/math-ege')
const BATCH     = 1000

mkdirSync(OUT_DIR, { recursive: true })

function jsonl(file, obj) { appendFileSync(join(OUT_DIR, file), JSON.stringify(obj) + '\n') }

// ── Fetch all tasks ──────────────────────────────────────────────────────────

async function fetchAllTasks() {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('catalog_tasks')
      .select('id,external_id,section_id,statement_html,answer_html,solution_html,solution_plan_html,grade_criteria_html,has_answer,has_solution,is_published,source_url,position')
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE)
      .range(from, from + BATCH - 1)
      .order('external_id')
    if (error) { console.error('fetch error:', error.message); break }
    if (!data?.length) break
    all.push(...data)
    if (data.length < BATCH) break
    from += BATCH
  }
  return all
}

async function fetchTaskTopics() {
  const { data } = await supabase
    .from('catalog_task_topics')
    .select('task_id')
  return new Set((data ?? []).map(r => r.task_id))
}

async function fetchSections() {
  const { data } = await supabase.from('catalog_sections').select('id,title').eq('subject', SUBJECT)
  return Object.fromEntries((data ?? []).map(s => [s.id, s.title]))
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍  Загрузка задач...')
  const [tasks, topicTaskIds, sections] = await Promise.all([fetchAllTasks(), fetchTaskTopics(), fetchSections()])
  console.log(`    ${tasks.length} задач загружено`)

  // Clear output files
  for (const f of ['task-errors.jsonl','html-errors.jsonl','answer-errors.jsonl','solution-errors.jsonl','manual-review.csv']) {
    writeFileSync(join(OUT_DIR, f), f.endsWith('.csv')
      ? 'task_uuid,external_id,section,field,error_type,preview,severity,auto_fixable\n'
      : '')
  }

  const stats = {
    generated_at: new Date().toISOString(),
    subject: SUBJECT, exam_type: EXAM_TYPE,
    tasks_total: tasks.length,
    errors: { critical: 0, high: 0, medium: 0, low: 0 },
    by_category: {
      no_answer: 0, no_solution: 0, no_topic: 0,
      answer_flag_mismatch: 0, solution_flag_mismatch: 0,
      html_corrupted: 0, unpublished: 0, no_section: 0,
    },
    topology: { sections: Object.keys(sections).length },
  }

  const manualReview = []

  for (const t of tasks) {
    const section = sections[t.section_id] ?? '(unknown)'
    const base = { task_uuid: t.id, external_id: t.external_id, section }

    // ── Структурные проблемы ─────────────────────────────────────────────────

    if (!t.section_id) {
      stats.by_category.no_section++
      const e = { ...base, field: 'section_id', error: 'no_section', severity: 'critical', auto_fixable: false }
      jsonl('task-errors.jsonl', e)
      stats.errors.critical++
    }

    if (!topicTaskIds.has(t.id)) {
      stats.by_category.no_topic++
      const e = { ...base, field: 'catalog_task_topics', error: 'no_topic', severity: 'high', auto_fixable: false,
        note: 'source data never assigned a topic for this task' }
      jsonl('task-errors.jsonl', e)
      stats.errors.high++
    }

    if (!t.is_published) {
      stats.by_category.unpublished++
      jsonl('task-errors.jsonl', { ...base, field: 'is_published', error: 'unpublished', severity: 'medium', auto_fixable: true })
      stats.errors.medium++
    }

    // ── HTML quality ─────────────────────────────────────────────────────────

    const htmlFields = [
      { field: 'statement_html', val: t.statement_html },
      { field: 'answer_html', val: t.answer_html },
      { field: 'solution_html', val: t.solution_html },
      { field: 'solution_plan_html', val: t.solution_plan_html },
      { field: 'grade_criteria_html', val: t.grade_criteria_html },
    ]

    for (const { field, val } of htmlFields) {
      if (!val) continue
      const checks = [
        { test: val.includes('undefined'),        type: 'has_undefined',     sev: 'critical' },
        { test: val.includes('[object Object]'),   type: 'has_object_str',    sev: 'critical' },
        { test: /&amp;amp;|&lt;lt;/.test(val),    type: 'double_encoded',    sev: 'medium' },
        { test: /null/.test(val),                  type: 'has_null_str',      sev: 'low' },
      ]
      for (const c of checks) {
        if (c.test) {
          stats.by_category.html_corrupted++
          const e = { ...base, field, error: c.type, severity: c.sev, auto_fixable: false,
            preview: val.slice(0, 80) }
          jsonl('html-errors.jsonl', e)
          stats.errors[c.sev]++
        }
      }
    }

    // ── Answer audit ─────────────────────────────────────────────────────────

    const ah = t.answer_html ?? ''
    const hasTex = ah.includes('data-answer-tex-session-id')
    const hasTexText = hasTex && /data-answer-tex-session-id="[0-9]+">[^<\s]/.test(ah)
    const hasTexEmpty = hasTex && /data-answer-tex-session-id="[0-9]+">\s*<\/span>/.test(ah)

    if (!t.has_answer) {
      stats.by_category.no_answer++
      if (hasTexText) {
        // has_answer=false but span contains text — flag should be true
        const e = { ...base, field: 'has_answer', error: 'flag_false_but_text_in_span', severity: 'high', auto_fixable: true,
          preview: ah.slice(0, 100) }
        jsonl('answer-errors.jsonl', e)
        stats.errors.high++
        manualReview.push({ ...base, field: 'answer_html', error_type: 'has_answer_flag_wrong', preview: ah.slice(0,80), severity: 'high', auto_fixable: 'yes' })
      }
      if (hasTexEmpty) {
        // has_answer=false + empty span: source answer image not downloaded — correct but note it
        const e = { ...base, field: 'answer_html', error: 'answer_image_not_imported', severity: 'medium', auto_fixable: false,
          note: 'answer tex session SVG not in source archive; has_answer=false is correct',
          preview: ah.slice(0, 100) }
        jsonl('answer-errors.jsonl', e)
        stats.errors.medium++
      }
    } else if (t.has_answer && !ah) {
      const e = { ...base, field: 'answer_html', error: 'has_answer_true_but_empty', severity: 'critical', auto_fixable: false }
      jsonl('answer-errors.jsonl', e)
      stats.errors.critical++
      stats.by_category.answer_flag_mismatch++
    }

    // ── Solution audit ───────────────────────────────────────────────────────

    const sh = t.solution_html ?? ''
    if (t.has_solution && !sh.trim()) {
      stats.by_category.solution_flag_mismatch++
      const e = { ...base, field: 'solution_html', error: 'has_solution_true_but_empty', severity: 'critical', auto_fixable: false }
      jsonl('solution-errors.jsonl', e)
      stats.errors.critical++
    }
    if (!t.has_solution && sh.trim() && sh.trim() !== '') {
      // Check if it's whitespace-only (FORCE_NO_SOLUTION)
      if (sh.replace(/\s/g, '').length > 0) {
        stats.by_category.solution_flag_mismatch++
        const e = { ...base, field: 'has_solution', error: 'flag_false_but_solution_exists', severity: 'medium', auto_fixable: false,
          preview: sh.slice(0, 80) }
        jsonl('solution-errors.jsonl', e)
        stats.errors.medium++
      }
    }
    if (t.solution_plan_html && !t.has_solution) {
      const e = { ...base, field: 'solution_plan_html', error: 'plan_without_solution', severity: 'medium', auto_fixable: false }
      jsonl('solution-errors.jsonl', e)
      stats.errors.medium++
    }
  }

  // ── Write manual-review.csv ──────────────────────────────────────────────
  for (const r of manualReview) {
    appendFileSync(join(OUT_DIR, 'manual-review.csv'),
      `"${r.task_uuid}","${r.external_id}","${r.section}","${r.field}","${r.error_type}","${(r.preview??'').replace(/"/g,"'")}","${r.severity}","${r.auto_fixable}"\n`)
  }

  // ── Write summary ────────────────────────────────────────────────────────
  stats.by_category.no_answer = tasks.filter(t => !t.has_answer).length
  stats.by_category.no_solution = tasks.filter(t => !t.has_solution).length
  writeFileSync(join(OUT_DIR, 'catalog-summary.json'), JSON.stringify(stats, null, 2))

  console.log('\n📊  Результаты:')
  console.log(`    Tasks: ${tasks.length}`)
  console.log(`    Errors: critical=${stats.errors.critical} high=${stats.errors.high} medium=${stats.errors.medium} low=${stats.errors.low}`)
  console.log(`    No topic: ${stats.by_category.no_topic}`)
  console.log(`    No answer: ${stats.by_category.no_answer}`)
  console.log(`    No solution: ${stats.by_category.no_solution}`)
  console.log(`\n✅  Отчёты записаны в ${OUT_DIR}`)
}

main().catch(e => { console.error(e); process.exit(1) })
