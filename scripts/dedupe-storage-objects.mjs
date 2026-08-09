/**
 * dedupe-storage-objects.mjs — схлопывает дубли файлов в хранилище и чинит им кэш.
 *
 * Второй шаг работы §102. До неё копирование курса физически перезаливало
 * каждый файл: 2724 строки материалов — 2724 разных пути, общих ноль. Копии,
 * созданные ДО §102, так и лежат побайтными близнецами; этот скрипт переводит
 * их строки на один объект, а лишние объекты удаляет.
 *
 * Заодно третья обязанность (§102.9, §105.5): объектам с негодным
 * Cache-Control проставляется годовой. Метаданные объекта иначе не поменять —
 * только перезаливкой, а скрипт и так перезаписывает объекты.
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ МЕНЯЕТ. Запись включается только флагом `--apply`.
 *
 *   node scripts/dedupe-storage-objects.mjs                    # разведка, только цифры
 *   node scripts/dedupe-storage-objects.mjs --only cache       # смотреть лишь кэш
 *   node scripts/dedupe-storage-objects.mjs --apply            # реальный проход
 *   node scripts/dedupe-storage-objects.mjs --apply --limit 50 # первые 50 групп
 *
 * Ключ доступа берётся из `.env.import.local` / `.env` / окружения и никуда не
 * печатается.
 *
 * ПРАВИЛА БЕЗОПАСНОСТИ, которые здесь не обсуждаются:
 *
 *  1. Объект удаляется ТОЛЬКО после того, как `storage_path_refs` ответила
 *     ноль. Функция считает обе таблицы (материалы темы и файлы ДЗ): путь
 *     живёт в двух, и забыв вторую, удаление выбило бы файл у чужого задания.
 *  2. «Не смогли посчитать» — не трогаем. Лишний файл в хранилище дешевле
 *     выбитого у живого курса.
 *  3. Перед проходом пишется снимок: какие строки на какие пути ссылались.
 *     После прохода — контрольный подсчёт.
 */

import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// ── Что чиним ────────────────────────────────────────────────────────────────

/**
 * БЕЛЫЙ СПИСОК. Ровно те бакеты, которые умеет считать `storage_path_refs`:
 * она смотрит `topic_material_items` и `topic_homework_files` и больше ничего.
 *
 * Список здесь не для порядка. Для ЛЮБОГО другого бакета обе её ветки дают
 * ноль — и «ссылок нет» становится неотличимо от «нечем считать». На
 * сдачах учеников (topic-homework-attempts) и материалах шаблонов
 * (lesson-library) это означало бы удаление живых файлов по формально
 * честному нулю. Ровно тот класс молчаливого отказа, на котором проект уже
 * горел в §47 и §54: пустой ответ, принятый за разрешение.
 *
 * Расширять список можно только вместе со `storage_path_refs` — сначала она
 * учится считать новый бакет, потом он появляется здесь.
 */
const REFCOUNTED_BUCKETS = ['topic-materials', 'topic-homework']

/** Схлопываем дубли только там, где умеем считать ссылки. */
const DEDUPE_BUCKETS = REFCOUNTED_BUCKETS

/**
 * Кэш чиним в тех же границах. Перезаливка ничего не удаляет и сама по себе
 * безопасна, но правило одно на весь скрипт: за белый список не выходим
 * (решение владельца 09.08). Что осталось снаружи — в отчёте отдельной строкой.
 */
const CACHE_BUCKETS = REFCOUNTED_BUCKETS

/** Бакеты, которые видим при обходе, но не трогаем: только чтобы показать цифру. */
const OBSERVED_ONLY_BUCKETS = ['topic-homework-attempts', 'lesson-library']

/**
 * Годовой кэш. Значение обязано совпадать с `UPLOAD_CACHE_CONTROL_S` в
 * `src/lib/storage.ts` — там оно живёт для загрузок из приложения. Копия здесь
 * помечена намеренно: скрипт на .mjs, тянуть сюда сборку TypeScript дороже.
 */
const YEAR_CACHE = '31536000'

/**
 * Считать ли ссылки в этом бакете вообще. Отрицательный ответ — авария, а не
 * «ноль»: см. комментарий к REFCOUNTED_BUCKETS.
 */
export function isRefcountable(bucket) {
  return REFCOUNTED_BUCKETS.includes(bucket)
}

/** Годным считаем только `max-age=` с ненулевым числом. */
export function cacheControlIsBad(value) {
  return !/^max-age=[1-9]/.test((value ?? '').trim())
}

// ── Флаги ────────────────────────────────────────────────────────────────────

function parseFlags(argv) {
  const flags = { apply: false, only: 'both', limit: 0 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') flags.apply = true
    else if (a === '--only') flags.only = argv[++i]
    else if (a === '--limit') flags.limit = Number(argv[++i]) || 0
    else if (a === '--help' || a === '-h') flags.help = true
    else die(`неизвестный флаг: ${a}`)
  }
  if (!['both', 'dedupe', 'cache'].includes(flags.only)) die('--only принимает dedupe, cache или both')
  return flags
}

function die(message) {
  console.error('✗ ' + message)
  process.exit(1)
}

/**
 * Файл импортируется тестами ради чистых функций (`groupDuplicates` и соседи).
 * При импорте не должно происходить ничего: ни разбора чужих аргументов, ни
 * чтения ключа, ни создания клиента.
 */
const IS_MAIN = Boolean(process.argv[1] && process.argv[1].endsWith('dedupe-storage-objects.mjs'))

const FLAGS = IS_MAIN ? parseFlags(process.argv.slice(2)) : { apply: false, only: 'both', limit: 0 }

if (FLAGS.help) {
  console.log([
    'dedupe-storage-objects.mjs — схлопывает дубли файлов и чинит им Cache-Control.',
    '',
    '  --apply        реальный проход; без него — только разведка и цифры',
    '  --only X       dedupe | cache | both (по умолчанию both)',
    '  --limit N      обработать первые N групп дублей / N объектов с плохим кэшем',
    '',
    'Ключ берётся из .env.import.local (SUPABASE_SERVICE_ROLE_KEY).',
  ].join('\n'))
  process.exit(0)
}

// ── Доступ ───────────────────────────────────────────────────────────────────

/** Мини-парсер .env — тот же, что в scripts/import-lessons.mjs. Ключи не логируются. */
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

const env = IS_MAIN ? {
  ...readEnvFile(join(process.cwd(), '.env')),
  ...readEnvFile(join(process.cwd(), '.env.import.local')),
  ...process.env,
} : {}

/** Клиент создаётся лениво: при импорте из тестов ключ не нужен и не читается. */
let dbCached = null
function client() {
  if (dbCached) return dbCached
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) die('в .env нет VITE_SUPABASE_URL')
  if (!key) {
    die(
      'в .env.import.local нет SUPABASE_SERVICE_ROLE_KEY.\n' +
      '  Добавьте строку `SUPABASE_SERVICE_ROLE_KEY=<ключ>` в файл сами — он уже в .gitignore.',
    )
  }
  dbCached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return dbCached
}

// ── Строки, ссылающиеся на объекты ───────────────────────────────────────────

/**
 * Все ссылки на объекты хранилища. Ключ — бакет: у материалов путь может вести
 * в один из трёх бакетов (три поколения, §102.4), но схлопываем мы только
 * новое поколение — те, что лежат в topic-materials.
 */
async function loadReferences() {
  const rows = { materials: [], homeworkFiles: [], attemptFiles: [], templateMaterials: [] }

  for (const [key, table, column] of [
    ['materials', 'topic_material_items', 'storage_path'],
    ['homeworkFiles', 'topic_homework_files', 'storage_path'],
    ['attemptFiles', 'topic_homework_attempt_files', 'storage_path'],
    ['templateMaterials', 'lesson_template_materials', 'file_path'],
  ]) {
    // PostgREST отдаёт не больше тысячи строк за раз — читаем страницами.
    const size = 1000
    for (let from = 0; ; from += size) {
      const { data, error } = await client().from(table).select(`id, ${column}`).range(from, from + size - 1)
      if (error) die(`не прочитать ${table}: ${error.message}`)
      rows[key].push(...data.filter(r => r[column]))
      if (data.length < size) break
    }
  }
  return rows
}

/** Первые сегменты путей — папки, по которым Storage умеет отдавать список. */
export function foldersOf(paths) {
  const set = new Set()
  for (const p of paths) {
    const i = p.indexOf('/')
    if (i > 0) set.add(p.slice(0, i))
  }
  return [...set]
}

/**
 * Все объекты бакета — рекурсивным обходом от корня.
 *
 * Первая версия шла по папкам, вычисленным из строк БД, и недосчитала: так не
 * видны ни осиротевшие объекты (строку удалили, файл остался — течь, закрытая
 * только в §102), ни вложенные папки вроде `owner/<uuid>/…` в библиотеке
 * уроков. Для уборки нужен именно весь бакет: мы чиним и то, на что уже никто
 * не ссылается.
 *
 * Прямого чтения `storage.objects` у скрипта нет — схема наружу не выставлена,
 * а заводить ради разовой уборки новую RPC в проде дороже обхода.
 */
async function listObjects(bucket, prefix = '') {
  const out = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client().storage.from(bucket).list(prefix, { limit: 100, offset })
    if (error) die(`не прочитать список ${bucket}/${prefix}: ${error.message}`)
    for (const item of data) {
      const name = prefix ? `${prefix}/${item.name}` : item.name
      if (!item.metadata) {
        // Папка: у неё нет метаданных. Спускаемся внутрь.
        out.push(...await listObjects(bucket, name))
        continue
      }
      out.push({
        bucket,
        name,
        size: item.metadata.size ?? 0,
        etag: String(item.metadata.eTag ?? '').replace(/"/g, ''),
        cacheControl: item.metadata.cacheControl ?? null,
        mimetype: item.metadata.mimetype ?? 'application/octet-stream',
        createdAt: item.created_at ?? '',
      })
    }
    if (data.length < 100) break
  }
  return out
}

// ── Группировка дублей ───────────────────────────────────────────────────────

/**
 * Группы побайтно одинаковых объектов ОДНОГО бакета.
 *
 * Ключ — размер и eTag, то есть содержимое, а не имя: у копий имена как раз
 * разные (в них зашит id темы и метка времени). eTag от Storage — это md5
 * целого объекта; у составной загрузки он выглядит как `хеш-N` и целому файлу
 * не соответствует, такие пропускаем, чтобы не сравнивать несравнимое.
 *
 * Хранитель группы — тот, на кого больше ссылок (меньше строк переписывать),
 * при равенстве — самый старый, при равенстве — первый по имени. Порядок
 * обязан быть детерминированным: два запуска подряд должны выбирать одно и то
 * же, иначе --dry-run показывал бы не тот план, который потом выполнится.
 */
export function groupDuplicates(objects, refCountByPath) {
  const groups = new Map()
  for (const o of objects) {
    if (!o.etag || o.etag.includes('-') || !o.size) continue
    const key = `${o.bucket}|${o.size}|${o.etag}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(o)
  }

  const result = []
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => {
      const refs = (refCountByPath.get(b.name) ?? 0) - (refCountByPath.get(a.name) ?? 0)
      if (refs) return refs
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
      return a.name < b.name ? -1 : 1
    })
    result.push({ key, keeper: sorted[0], duplicates: sorted.slice(1) })
  }
  // Тоже детерминированно: план на экране и порядок работы совпадают.
  return result.sort((a, b) => (a.key < b.key ? -1 : 1))
}

function mb(bytes) {
  return (bytes / 1048576).toFixed(1)
}

// ── Сам проход ───────────────────────────────────────────────────────────────

async function main() {
  const mode = FLAGS.apply ? 'РЕАЛЬНЫЙ ПРОХОД (--apply)' : 'разведка (--dry-run по умолчанию)'
  console.log(`\n▶ Схлопывание дублей и починка кэша — ${mode}\n`)

  const refs = await loadReferences()

  // Сколько строк ссылается на путь — по данным, прочитанным сейчас. Это
  // черновой счёт для выбора хранителя; перед КАЖДЫМ удалением он ещё раз
  // проверяется в базе через storage_path_refs.
  const refCountByPath = new Map()
  for (const r of [...refs.materials, ...refs.homeworkFiles]) {
    const p = r.storage_path
    refCountByPath.set(p, (refCountByPath.get(p) ?? 0) + 1)
  }

  // ── Снимок до прохода ──────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = join(process.cwd(), 'scripts', 'out')
  mkdirSync(outDir, { recursive: true })
  const snapshotPath = join(outDir, `dedupe-snapshot-${stamp}.json`)
  writeFileSync(snapshotPath, JSON.stringify(refs, null, 1), 'utf8')
  console.log(`Снимок ссылок до прохода: ${snapshotPath}`)

  // ── Что лежит в хранилище ──────────────────────────────────────────────────
  const objectsByBucket = new Map()

  const neededBuckets = FLAGS.only === 'cache'
    ? CACHE_BUCKETS
    : FLAGS.only === 'dedupe' ? DEDUPE_BUCKETS : [...new Set([...DEDUPE_BUCKETS, ...CACHE_BUCKETS])]

  for (const bucket of neededBuckets) {
    const objects = await listObjects(bucket)
    objectsByBucket.set(bucket, objects)
    console.log(`  ${bucket}: объектов ${objects.length}, ${mb(objects.reduce((s, o) => s + o.size, 0))} МБ`)
  }

  // Бакеты вне белого списка только показываем: сколько там дублей и битого
  // кэша — цифра для решения владельца, работать с ними нечем (§102: ссылки
  // на них никто не считает).
  console.log(`
── Вне белого списка (не трогаем) ──`)
  for (const bucket of OBSERVED_ONLY_BUCKETS) {
    const objects = await listObjects(bucket)
    const dupes = groupDuplicates(objects, new Map()).reduce((s, g) => s + g.duplicates.length, 0)
    const badCache = objects.filter(o => cacheControlIsBad(o.cacheControl))
    console.log(
      `  ${bucket}: объектов ${objects.length}, ${mb(objects.reduce((s, o) => s + o.size, 0))} МБ` +
      `; дублей ${dupes}, негодный кэш ${badCache.length} (${mb(badCache.reduce((s, o) => s + o.size, 0))} МБ)`,
    )
  }

  const report = { switchedRows: 0, deletedObjects: 0, freedBytes: 0, fixedCache: 0, fixedCacheBytes: 0, skipped: [] }
  /** Пути, удалённые на шаге 1: чинить им кэш незачем, объекта уже нет. */
  const deletedPaths = new Set()

  // ── 1. Дубли ───────────────────────────────────────────────────────────────
  if (FLAGS.only !== 'cache') {
    const allGroups = []
    for (const bucket of DEDUPE_BUCKETS) {
      allGroups.push(...groupDuplicates(objectsByBucket.get(bucket) ?? [], refCountByPath))
    }
    const groups = FLAGS.limit ? allGroups.slice(0, FLAGS.limit) : allGroups
    const removable = groups.reduce((s, g) => s + g.duplicates.length, 0)
    const removableBytes = groups.reduce((s, g) => s + g.duplicates.reduce((x, d) => x + d.size, 0), 0)

    console.log(`\n── Дубли ──`)
    console.log(`  групп одинакового содержимого: ${groups.length}`)
    console.log(`  лишних объектов: ${removable}, освободится ${mb(removableBytes)} МБ`)
    if (FLAGS.limit) console.log(`  ВНИМАНИЕ: обрабатываются только первые ${FLAGS.limit} групп (--limit)`)

    for (const group of groups) {
      for (const dup of group.duplicates) {
        if (!FLAGS.apply) continue

        // 1.1 Перевести строки на хранителя — в обеих таблицах.
        for (const [table, column] of [['topic_material_items', 'storage_path'], ['topic_homework_files', 'storage_path']]) {
          const { data, error } = await client().from(table).update({ [column]: group.keeper.name })
            .eq(column, dup.name).select('id')
          if (error) {
            report.skipped.push({ path: dup.name, why: `не переключить строки (${table}): ${error.message}` })
            continue
          }
          report.switchedRows += data.length
        }

        // 1.2 Пересчитать ссылки в базе. Ноль — и только тогда удаляем.
        //
        // Перед вызовом — проверка бакета. Без неё `storage_path_refs` честно
        // вернула бы ноль для бакета, который она не умеет считать, и мы
        // удалили бы живой файл (см. REFCOUNTED_BUCKETS).
        if (!isRefcountable(dup.bucket)) {
          die(`бакет ${dup.bucket} вне белого списка: storage_path_refs его не считает, удалять по её нулю нельзя`)
        }
        const { data: left, error: refErr } = await client().rpc('storage_path_refs', {
          p_bucket: dup.bucket, p_path: dup.name,
        })
        if (refErr) {
          report.skipped.push({ path: dup.name, why: `не посчитать ссылки: ${refErr.message}` })
          continue
        }
        if ((left ?? 1) > 0) {
          report.skipped.push({ path: dup.name, why: `на объект ещё ссылаются (${left})` })
          continue
        }

        // 1.3 Удалить объект.
        const { error: rmErr } = await client().storage.from(dup.bucket).remove([dup.name])
        if (rmErr) {
          report.skipped.push({ path: dup.name, why: `не удалить объект: ${rmErr.message}` })
          continue
        }
        report.deletedObjects += 1
        report.freedBytes += dup.size
        deletedPaths.add(dup.name)
      }
    }
  }

  // ── 2. Кэш ─────────────────────────────────────────────────────────────────
  if (FLAGS.only !== 'dedupe') {
    // Считаем по тому, что осталось: удалённого на шаге 1 в хранилище уже нет.
    const bad = []
    for (const bucket of CACHE_BUCKETS) {
      for (const o of objectsByBucket.get(bucket) ?? []) {
        if (cacheControlIsBad(o.cacheControl) && !deletedPaths.has(o.name)) bad.push(o)
      }
    }

    console.log(`\n── Кэш ──`)
    console.log(`  объектов с негодным Cache-Control: ${bad.length}, ${mb(bad.reduce((s, o) => s + o.size, 0))} МБ`)

    const targets = FLAGS.limit ? bad.slice(0, FLAGS.limit) : bad
    for (const o of targets) {
      if (!FLAGS.apply) continue
      // Метаданные объекта иначе не поменять — только перезаливкой тем же
      // содержимым. Скачиваем и кладём обратно с годовым кэшем.
      const { data: blob, error: dlErr } = await client().storage.from(o.bucket).download(o.name)
      if (dlErr || !blob) {
        report.skipped.push({ path: o.name, why: `не скачать для починки кэша: ${dlErr?.message ?? 'пусто'}` })
        continue
      }
      const { error: upErr } = await client().storage.from(o.bucket).upload(o.name, blob, {
        upsert: true,
        cacheControl: YEAR_CACHE,
        contentType: o.mimetype,
      })
      if (upErr) {
        report.skipped.push({ path: o.name, why: `не перезалить: ${upErr.message}` })
        continue
      }
      report.fixedCache += 1
      report.fixedCacheBytes += o.size
    }
  }

  // ── Отчёт и контрольный подсчёт ────────────────────────────────────────────
  console.log(`\n── Итог ──`)
  console.log(`  строк переключено:   ${report.switchedRows}`)
  console.log(`  объектов удалено:    ${report.deletedObjects}`)
  console.log(`  освобождено:         ${mb(report.freedBytes)} МБ`)
  console.log(`  кэшей починено:      ${report.fixedCache} (${mb(report.fixedCacheBytes)} МБ)`)
  if (report.skipped.length) {
    console.log(`  пропущено (не тронуто): ${report.skipped.length}`)
    for (const s of report.skipped.slice(0, 20)) console.log(`    · ${s.path} — ${s.why}`)
    if (report.skipped.length > 20) console.log(`    … и ещё ${report.skipped.length - 20}`)
  }

  if (!FLAGS.apply) {
    console.log(`\n  Это разведка: ничего не изменено. Реальный проход — с флагом --apply.\n`)
    return
  }

  // Контрольный подсчёт: перечитываем хранилище заново.
  console.log(`\n── Контроль после прохода ──`)
  const refsAfter = await loadReferences()
  const refCountAfter = new Map()
  for (const r of [...refsAfter.materials, ...refsAfter.homeworkFiles]) {
    refCountAfter.set(r.storage_path, (refCountAfter.get(r.storage_path) ?? 0) + 1)
  }
  for (const bucket of neededBuckets) {
    const objects = await listObjects(bucket)
    const dupLeft = groupDuplicates(objects, refCountAfter).reduce((s, g) => s + g.duplicates.length, 0)
    const badLeft = objects.filter(o => cacheControlIsBad(o.cacheControl)).length
    const broken = (bucket === 'topic-materials' ? refsAfter.materials.map(r => r.storage_path)
      : bucket === 'topic-homework' ? refsAfter.homeworkFiles.map(r => r.storage_path) : [])
      .filter(p => !objects.some(o => o.name === p)).length
    console.log(`  ${bucket}: объектов ${objects.length}, дублей осталось ${dupLeft}, негодный кэш ${badLeft}, строк без объекта ${broken}`)
  }
  console.log('')
}

if (IS_MAIN) {
  main().catch(e => die(e?.message ?? String(e)))
}
