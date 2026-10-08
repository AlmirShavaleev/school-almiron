/**
 * import-physics-catalog-v2.mjs — переписанный каталог физики ЕГЭ на сайт (§269).
 *
 *   <root>\КИМ01..КИМ26\задачи.json + fig\*.svg  →  catalog_tasks (Markdown + LaTeX),
 *                                                  рисунки → Storage `catalog-figures`
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ (сухой прогон): читает папки, проверяет задачи и
 * файлы, сверяет с базой и печатает план — по КИМ: сколько задач меняется на
 * месте, сколько уходит новой строкой (задача стоит в вариантах), сколько уже
 * совпадает, каких номеров нет в базе, сколько рисунков залить, странности.
 * План пишется в <root>\загрузка_план.json. Запись — только с `--apply`;
 * отчёт загрузки (в т. ч. старый → новый id для задач из вариантов) —
 * <root>\загрузка_отчёт.json. Повторный запуск ничего не меняет.
 *
 *   node scripts/import-physics-catalog-v2.mjs --root "D:\Задачник\Каталог физика ЕГЭ"
 *   node scripts/import-physics-catalog-v2.mjs --root "D:\Задачник\Каталог физика ЕГЭ" --apply
 *
 * Без ключа (или с `--snapshot <файл.json>` — выгрузка строк базы для проверки
 * без сети) сухой прогон проверяет только файлы / план по выгрузке.
 *
 * Ключи — из `.env.import.local` / `.env` / окружения (VITE_SUPABASE_URL или
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). Значения ключей не печатаются.
 * Перед `--apply` должна быть применена миграция §269 (PENDING_269_catalog_md).
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  EXAM_TYPE, FIGURES_BUCKET, FIGURES_PREFIX, PLAN_FILE, REPORT_FILE, SUBJECT, TASKS_FILE,
  buildContent, contentTypeOf, figureStoragePath, formatSummary, kimOfFolder, planImport,
  rowPayload, summarizePlan, validateTask,
} from './physics-catalog-v2-plan.mjs'

const argv = process.argv.slice(2)
function getArg(name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const FLAGS = {
  apply: argv.includes('--apply'),
  root: getArg('--root'),
  snapshot: getArg('--snapshot'),
  concurrency: Math.max(1, Math.min(16, Number(getArg('--concurrency') ?? 6) || 6)),
}

function die(message) {
  console.error(`\n  ОСТАНОВ: ${message}\n`)
  process.exit(1)
}

// ── Доступ (как в import-autocheck: мини-парсер .env, значения не печатаются) ──
function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}
const env = {
  ...readEnvFile(join(process.cwd(), '.env')),
  ...readEnvFile(join(process.cwd(), '.env.import.local')),
  ...process.env,
}
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

/** Параллельно, но не больше n за раз. */
async function pool(items, n, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return results
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function withRetry(label, fn, tries = 3) {
  let last
  for (let a = 1; a <= tries; a++) {
    try { return await fn() } catch (e) {
      last = e
      if (a < tries) await new Promise(r => setTimeout(r, 800 * a))
    }
  }
  throw new Error(`${label}: ${last?.message ?? last}`)
}

// ── 1. Папки ──────────────────────────────────────────────────────────────────

function readCatalog(root) {
  const tasks = []
  const problems = []
  const figures = new Map() // 'КИМ01/fig/x.svg' → { abs, name }
  const folders = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && kimOfFolder(d.name))
  if (!folders.length) die(`в ${root} нет папок КИМ01..КИМ26`)
  const kims = new Set()
  for (const d of folders.sort((a, b) => kimOfFolder(a.name) - kimOfFolder(b.name))) {
    const kim = kimOfFolder(d.name)
    kims.add(kim)
    const dir = join(root, d.name)
    const jsonPath = join(dir, TASKS_FILE)
    if (!existsSync(jsonPath)) { problems.push(`${d.name}: нет ${TASKS_FILE}`); continue }
    let list
    try { list = JSON.parse(readFileSync(jsonPath, 'utf8')) } catch (e) { problems.push(`${d.name}/${TASKS_FILE}: не JSON (${e.message})`); continue }
    if (!Array.isArray(list)) { problems.push(`${d.name}/${TASKS_FILE}: ожидался массив задач`); continue }
    const figDir = join(dir, 'fig')
    const figFiles = existsSync(figDir) ? new Set(readdirSync(figDir).map(n => `fig/${n}`)) : new Set()
    for (const t of list) {
      problems.push(...validateTask(t, kim, rel => figFiles.has(rel)).map(p => `${d.name}: ${p}`))
      tasks.push({ ...t, external_id: String(t.external_id), kim, _dir: dir })
      for (const key of ['figure', 'solution_figure']) {
        if (t[key] && figFiles.has(t[key])) figures.set(`${d.name}/${t[key]}`, { abs: join(dir, t[key]), name: t[key] })
      }
    }
  }
  for (let k = 1; k <= 26; k++) if (!kims.has(k)) problems.push(`нет папки КИМ${String(k).padStart(2, '0')}`)
  const dup = new Map()
  for (const t of tasks) dup.set(t.external_id, (dup.get(t.external_id) ?? 0) + 1)
  for (const [ext, n] of dup) if (n > 1) problems.push(`номер ${ext} встречается ${n} раза`)
  return { tasks, problems, figures }
}

// ── 2. База ───────────────────────────────────────────────────────────────────

const ROW_SELECT = 'id, external_id, exam_part, partial_type, position, is_published, content_format, statement_html, '
  + 'solution_html, answer_html, answer_spec, has_answer, has_solution, solution_plan_html, replaced_by_task_id, '
  + 'catalog_sections!inner(exam_number)'

async function readDbRows(db) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await withRetry('чтение задач', () => db.from('catalog_tasks').select(ROW_SELECT)
      .eq('subject', SUBJECT).eq('exam_type', EXAM_TYPE).order('id').range(from, from + 999).then(r => r))
    if (error) {
      if (/content_format|answer_spec|replaced_by_task_id/.test(error.message)) die('в базе нет колонок §269 — сначала примените миграцию PENDING_269_catalog_md')
      die(`чтение задач: ${error.message}`)
    }
    for (const r of data ?? []) rows.push({ ...r, kim: r.catalog_sections?.exam_number ?? null })
    if (!data || data.length < 1000) break
  }
  return rows
}

async function readUsedInVariants(db, ids) {
  const used = new Set()
  for (const part of chunk(ids, 150)) {
    const { data, error } = await withRetry('чтение вариантов', () => db.from('test_variant_items').select('task_id').in('task_id', part).then(r => r))
    if (error) die(`чтение вариантов: ${error.message}`)
    for (const r of data ?? []) used.add(r.task_id)
  }
  return used
}

async function listBucket(db) {
  const have = new Set()
  const { error: be } = await db.storage.getBucket(FIGURES_BUCKET)
  if (be) return { have, missingBucket: true }
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await withRetry('список рисунков', () => db.storage.from(FIGURES_BUCKET).list(FIGURES_PREFIX, { limit: 1000, offset }).then(r => r))
    if (error) die(`список рисунков: ${error.message}`)
    for (const o of data ?? []) have.add(`${FIGURES_PREFIX}/${o.name}`)
    if (!data || data.length < 1000) break
  }
  return { have, missingBucket: false }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!FLAGS.root) die('нужна папка каталога: --root "D:\\Задачник\\Каталог физика ЕГЭ"')
  if (!existsSync(FLAGS.root)) die(`нет папки ${FLAGS.root}`)

  console.log(`\nКаталог физики ЕГЭ (§269) → сайт  —  ${FLAGS.apply ? 'ЗАГРУЗКА' : 'сухой прогон, ничего не пишется'}`)
  console.log(`  папка: ${FLAGS.root}`)

  const { tasks, problems, figures } = readCatalog(FLAGS.root)
  console.log(`  задач в папках: ${tasks.length}, рисунков: ${figures.size}`)

  // Рисунки: путь по содержимому.
  const figPathByKey = new Map() // 'КИМ01/fig/x.svg' → 'fizika-ege/<hash>.svg'
  const uploads = new Map() // storage path → { abs, name }
  for (const [key, f] of figures) {
    const p = figureStoragePath(f.name, readFileSync(f.abs))
    figPathByKey.set(key, p)
    if (!uploads.has(p)) uploads.set(p, f)
  }
  const contents = new Map()
  for (const t of tasks) {
    const folder = `КИМ${String(t.kim).padStart(2, '0')}`
    const local = {}
    for (const key of ['figure', 'solution_figure']) if (t[key]) local[t[key]] = figPathByKey.get(`${folder}/${t[key]}`)
    try { contents.set(t.external_id, buildContent(t, local)) } catch (e) { problems.push(e.message) }
  }

  if (problems.length) {
    console.log(`\n  ПРОБЛЕМЫ В ФАЙЛАХ (${problems.length}):`)
    for (const p of problems.slice(0, 60)) console.log(`   · ${p}`)
    if (problems.length > 60) console.log(`   … и ещё ${problems.length - 60}`)
    if (FLAGS.apply) die('есть проблемы в файлах — загрузка не начата')
  }

  // База: живая или выгрузка.
  let db = null
  let dbRows = null
  let used = new Set()
  let bucket = { have: new Set(), missingBucket: false }
  if (FLAGS.snapshot) {
    const snap = JSON.parse(readFileSync(FLAGS.snapshot, 'utf8'))
    dbRows = snap.rows
    used = new Set(snap.used_in_variants ?? [])
    bucket.have = new Set(snap.figures_present ?? [])
    console.log(`  база: выгрузка ${FLAGS.snapshot} (${dbRows.length} строк) — сеть не используется`)
    if (FLAGS.apply) die('--apply с --snapshot не бывает: запись идёт только в живую базу')
  } else if (!SUPABASE_URL || !SERVICE_KEY) {
    const why = !SUPABASE_URL ? 'нет VITE_SUPABASE_URL' : 'нет SUPABASE_SERVICE_ROLE_KEY'
    if (FLAGS.apply) die(`${why} в .env.import.local. Добавьте строку сами — файл в .gitignore, присылать ключ в переписку не нужно.`)
    console.log(`  база: не проверялась (${why} в .env.import.local) — проверены только файлы`)
  } else {
    db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    dbRows = await readDbRows(db)
    used = await readUsedInVariants(db, dbRows.map(r => r.id))
    bucket = await listBucket(db)
    console.log(`  база: задач физики ЕГЭ ${dbRows.length}, из них в вариантах ${used.size}`)
    if (bucket.missingBucket) {
      console.log(`  ! бакета ${FIGURES_BUCKET} нет — сначала примените миграцию PENDING_269_catalog_md`)
      if (FLAGS.apply) die(`нет бакета ${FIGURES_BUCKET}`)
    }
  }
  if (!dbRows) return

  const plan = planImport({ tasks, contents, dbRows, usedInVariants: used })
  const summary = summarizePlan(plan.items)
  const toUpload = [...uploads.keys()].filter(p => !bucket.have.has(p))

  console.log('\n  ПЛАН ПО КИМ:')
  for (const l of formatSummary(summary)) console.log(l)
  console.log(`\n  рисунки: всего ${uploads.size} (по содержимому), уже в бакете ${uploads.size - toUpload.length}, залить ${toUpload.length}`)
  console.log(`  задач в базе, которых нет в папках: ${plan.notInData.length}${plan.notInData.length ? ' (не трогаются): ' + plan.notInData.slice(0, 10).map(r => r.external_id).join(', ') : ''}`)
  const plans = plan.items.filter(i => i.changes?.includes('solution_plan_html')).length
  if (plans) console.log(`  у ${plans} задач будет убран «План решения» (он со старыми числами)`)
  if (plan.anomalies.length) {
    console.log(`\n  СТРАННОСТИ (${plan.anomalies.length}) — загрузке не мешают, но посмотрите:`)
    for (const a of plan.anomalies.slice(0, 40)) console.log(`   · ${a}`)
    if (plan.anomalies.length > 40) console.log(`   … и ещё ${plan.anomalies.length - 40} — в ${PLAN_FILE}`)
  }

  if (!FLAGS.apply) {
    writeFileSync(join(FLAGS.root, PLAN_FILE), JSON.stringify({
      created_at: new Date().toISOString(), summary, figures_to_upload: toUpload.length,
      anomalies: plan.anomalies, problems,
      fork: plan.items.filter(i => i.action === 'fork').map(i => ({ external_id: i.external_id, kim: i.kim, task_id: i.task_id })),
      missing: plan.items.filter(i => i.action === 'missing').map(i => i.external_id),
    }, null, 2))
    console.log(`\n  План записан: ${join(FLAGS.root, PLAN_FILE)}`)
    console.log(problems.length ? '  Сначала разберите проблемы в файлах.\n' : '  Загрузка: тот же запуск с --apply.\n')
    return
  }

  // ── Запись ─────────────────────────────────────────────────────────────────
  const errors = []
  const report = {
    started_at: new Date().toISOString(), root: FLAGS.root, summary,
    figures: { uploaded: 0, already: uploads.size - toUpload.length },
    updated: [], forked: [], errors,
  }

  // 1. Рисунки — первыми: текст не должен ссылаться на ещё не залитый файл.
  let done = 0
  await pool(toUpload, FLAGS.concurrency, async path => {
    const f = uploads.get(path)
    const bytes = readFileSync(f.abs)
    try {
      await withRetry(`рисунок ${f.name}`, async () => {
        const { error } = await db.storage.from(FIGURES_BUCKET).upload(path, bytes, {
          contentType: contentTypeOf(f.name), upsert: false, cacheControl: '31536000',
        })
        if (error && !/exists|duplicate|409/i.test(String(error.message ?? '') + String(error.statusCode ?? ''))) throw error
      })
      report.figures.uploaded++
    } catch (e) { errors.push(`рисунок ${f.name} → ${path}: ${e.message}`) }
    if (++done % 100 === 0) console.log(`  рисунки: ${done}/${toUpload.length}`)
  })
  console.log(`  рисунки: залито ${report.figures.uploaded}, ошибок ${errors.length}`)
  if (errors.length) {
    writeFileSync(join(FLAGS.root, REPORT_FILE), JSON.stringify(report, null, 2))
    die(`рисунки залиты не все — задачи не трогались. Отчёт: ${join(FLAGS.root, REPORT_FILE)}. Запустите ещё раз.`)
  }

  // 2. На месте — по id (и номеру: строка не должна была смениться между чтением и записью).
  const updates = plan.items.filter(i => i.action === 'update')
  done = 0
  await pool(updates, FLAGS.concurrency, async it => {
    const payload = { ...rowPayload(contents.get(it.external_id)), updated_at: new Date().toISOString() }
    try {
      const data = await withRetry(`задача ${it.external_id}`, async () => {
        const { data, error } = await db.from('catalog_tasks').update(payload)
          .eq('id', it.task_id).eq('external_id', Number(it.external_id)).is('replaced_by_task_id', null).select('id')
        if (error) throw error
        return data
      })
      if (!data?.length) errors.push(`${it.external_id}: строка не найдена при записи (изменилась?) — пропущена`)
      else report.updated.push({ external_id: it.external_id, task_id: it.task_id, fields: it.changes })
    } catch (e) { errors.push(`${it.external_id}: ${e.message}`) }
    if (++done % 200 === 0) console.log(`  на месте: ${done}/${updates.length}`)
  })
  console.log(`  на месте: обновлено ${report.updated.length} из ${updates.length}`)

  // 3. Задачи из вариантов — новой строкой (одна транзакция в базе на задачу).
  const forks = plan.items.filter(i => i.action === 'fork')
  done = 0
  await pool(forks, Math.min(FLAGS.concurrency, 4), async it => {
    try {
      const res = await withRetry(`новая строка ${it.external_id}`, async () => {
        const { data, error } = await db.rpc('catalog_replace_task_v2', {
          p_old_task_id: it.task_id, p_content: rowPayload(contents.get(it.external_id)),
        })
        if (error) throw error
        return data
      })
      report.forked.push({
        external_id: it.external_id, kim: it.kim,
        old_task_id: it.task_id, new_task_id: res?.new_task_id ?? null,
        old_row_external_id_now: res?.archived_external_id ?? null, created: res?.created ?? null,
      })
    } catch (e) { errors.push(`${it.external_id} (новая строка): ${e.message}`) }
    if (++done % 100 === 0) console.log(`  новой строкой: ${done}/${forks.length}`)
  })
  console.log(`  новой строкой: ${report.forked.length} из ${forks.length} (старые строки скрыты из каталога, варианты их видят)`)

  report.finished_at = new Date().toISOString()
  writeFileSync(join(FLAGS.root, REPORT_FILE), JSON.stringify(report, null, 2))
  console.log(`\n  Отчёт: ${join(FLAGS.root, REPORT_FILE)}`)
  if (errors.length) {
    console.log(`\n  ОШИБКИ (${errors.length}) — повторный запуск дозагрузит недостающее:`)
    for (const e of errors.slice(0, 40)) console.log(`   · ${e}`)
    process.exit(1)
  }
  console.log('  Готово. Повторный запуск ничего не изменит.\n')
}

main().catch(e => die(e?.message ?? String(e)))
