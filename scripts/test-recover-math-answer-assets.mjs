/**
 * Тестовое восстановление answer-assets для 5 задач — Математика ЕГЭ
 *
 * Что делает:
 *   1. Берёт 5 явно заданных external_id
 *   2. Читает их answer_html из БД → извлекает data-answer-tex-session-id
 *   3. Формирует предположительный URL на shkolkovo.ru (паттерн из source_url)
 *   4. Делает HTTP HEAD (и GET-fallback) с паузой 2с между запросами
 *   5. Валидирует: статус, Content-Type, размер, SVG-сигнатура
 *   6. Сохраняет файл во временную папку (dry-run если --dry-run)
 *   7. Пишет отчёт в reports/math-ege/answer-assets-test-recovery.json
 *
 * НЕ ДЕЛАЕТ: INSERT/UPDATE в БД, массового scraping, изменений источников
 *
 * Запуск:
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/test-recover-math-answer-assets.mjs [--dry-run]
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

const DRY_RUN = process.argv.includes('--dry-run')
const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'math-ege')
const TEMP_DIR = path.join(__dirname, '..', 'reports', 'math-ege', 'answer-assets-test')
const PAUSE_MS = 2000

// 5 явных external_id для теста
// Выбраны из has_answer=false задач с непустым data-answer-tex-session-id
// Задачи с has_answer=false и непустым data-answer-tex-session-id (пустой спан)
const TEST_EXTERNAL_IDS = [349, 350, 351, 353, 354]

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms))
}

function extractTexSessionId(html = '') {
  const m = html.match(/data-answer-tex-session-id="(\d+)"/)
  return m ? parseInt(m[1]) : null
}

function extractSpanText(html = '') {
  const m = html.match(/data-answer-tex-session-id="\d+"[^>]*>([^<]*)</)
  return m ? m[1].trim() : ''
}

// Shkolkovo хранит изображения по URL вида:
// https://cdn.shkolkovo.online/tex/{session_id}/index.svg
// или /tex/{session_id}/answer.svg
// Точный паттерн неизвестен без авторизации — пробуем несколько вариантов
function buildCandidateUrls(sessionId) {
  return [
    `https://cdn.shkolkovo.online/tex/${sessionId}/index.svg`,
    `https://cdn.shkolkovo.online/tex/${sessionId}/answer.svg`,
    `https://3.shkolkovo.online/tex/${sessionId}/index.svg`,
  ]
}

async function tryFetch(url) {
  try {
    // HEAD сначала
    const headResp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    if (headResp.ok) {
      return { status: headResp.status, method: 'HEAD', contentType: headResp.headers.get('content-type') || '', size: parseInt(headResp.headers.get('content-length') || '0') }
    }
    return { status: headResp.status, method: 'HEAD', contentType: '', size: 0 }
  } catch (err) {
    return { status: 0, method: 'HEAD', error: err.message }
  }
}

async function tryGet(url) {
  try {
    const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return { status: resp.status, body: null }
    const buf = await resp.arrayBuffer()
    const bytes = Buffer.from(buf)
    return {
      status: resp.status,
      contentType: resp.headers.get('content-type') || '',
      size: bytes.length,
      body: bytes,
      isSvg: bytes.slice(0, 200).toString('utf-8').includes('<svg'),
    }
  } catch (err) {
    return { status: 0, error: err.message, body: null }
  }
}

async function main() {
  console.log(`=== Тест восстановления answer-assets (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===\n`)

  if (!DRY_RUN) {
    fs.mkdirSync(TEMP_DIR, { recursive: true })
  }

  // Загружаем 5 задач из БД
  const { data: tasks, error } = await supabase
    .from('catalog_tasks')
    .select('id, external_id, source_url, answer_html, has_answer')
    .in('external_id', TEST_EXTERNAL_IDS)
    .eq('subject', 'Математика')
    .eq('exam_type', 'ЕГЭ')
  if (error) throw error

  console.log(`Найдено задач: ${tasks.length} из ${TEST_EXTERNAL_IDS.length} запрошенных\n`)

  const results = []

  for (const task of tasks) {
    const sessionId = extractTexSessionId(task.answer_html)
    const spanText = extractSpanText(task.answer_html)

    const result = {
      external_id: task.external_id,
      task_id: task.id,
      source_url: task.source_url,
      has_answer: task.has_answer,
      tex_session_id: sessionId,
      span_text: spanText,
      candidates_tried: [],
      resolved_url: null,
      saved_file: null,
      verdict: 'NOT_FOUND',
      notes: [],
    }

    if (!sessionId) {
      result.verdict = 'NO_SESSION_ID'
      result.notes.push('answer_html не содержит data-answer-tex-session-id')
      results.push(result)
      continue
    }

    if (spanText) {
      result.notes.push(`Span содержит текст: "${spanText}" — возможно, ответ уже доступен как текст`)
    }

    const urls = buildCandidateUrls(sessionId)

    for (const url of urls) {
      console.log(`  ext=${task.external_id} session=${sessionId} → ${url}`)
      const head = await tryFetch(url)
      result.candidates_tried.push({ url, ...head })

      if (head.status === 200) {
        // GET для скачивания
        const get = await tryGet(url)
        if (get.status === 200 && get.body && get.size > 100) {
          result.resolved_url = url
          result.verdict = get.isSvg ? 'FOUND_SVG' : 'FOUND_NOT_SVG'
          result.notes.push(`HTTP 200, size=${get.size}, isSvg=${get.isSvg}, type=${get.contentType}`)

          if (!DRY_RUN && get.isSvg) {
            const fname = `${task.external_id}_session${sessionId}.svg`
            const fpath = path.join(TEMP_DIR, fname)
            fs.writeFileSync(fpath, get.body)
            result.saved_file = fpath
            result.notes.push(`Сохранён: ${fpath}`)
          }
          break
        }
      } else if (head.status === 401 || head.status === 403) {
        result.notes.push(`${url} → ${head.status} (требует авторизации)`)
        result.verdict = 'AUTH_REQUIRED'
      } else if (head.status === 404) {
        result.notes.push(`${url} → 404`)
      } else {
        result.notes.push(`${url} → ${head.status} (${head.error || ''})`)
      }

      await sleep(PAUSE_MS)
    }

    console.log(`  → verdict: ${result.verdict}\n`)
    results.push(result)

    if (task !== tasks[tasks.length - 1]) {
      await sleep(PAUSE_MS)
    }
  }

  // Итог
  const verdictCounts = {}
  for (const r of results) verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1

  console.log('--- Итог ---')
  for (const [v, c] of Object.entries(verdictCounts)) console.log(`  ${v}: ${c}`)

  // Отчёт
  const report = {
    run_date: '2026-06-25',
    dry_run: DRY_RUN,
    tested_external_ids: TEST_EXTERNAL_IDS,
    tasks_found_in_db: tasks.length,
    results,
    summary: {
      verdict_counts: verdictCounts,
      conclusion: verdictCounts['FOUND_SVG']
        ? 'SVG файлы доступны — массовое восстановление технически возможно'
        : verdictCounts['AUTH_REQUIRED']
          ? 'Требуется авторизация на shkolkovo.ru — прямой scraping недоступен'
          : 'SVG не найдены по предполагаемым URL — необходимо уточнить паттерн URL',
    },
  }

  const reportPath = path.join(REPORTS_DIR, 'answer-assets-test-recovery.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`\nОтчёт: ${reportPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
