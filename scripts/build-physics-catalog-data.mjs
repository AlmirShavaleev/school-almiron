/**
 * build-physics-catalog-data.mjs — данные каталога физики ЕГЭ для клиента (§253).
 *
 * Зачем: раньше `src/lib/physicsDifficulty.ts` и `src/lib/physicsTopicsCatalog.ts`
 * импортировали служебные отчёты `reports/physics-ege/apply-log.csv` (579 КБ) и
 * `dry-run-preview.json` (551 КБ) через `?raw` и разбирали их в браузере. Оба отчёта
 * целиком ехали в чанк `useCatalog` (1,1 МБ), а его статически тянет страница темы
 * ученика. Теперь отчёты разбирает этот скрипт, а в `src/lib/` лежат компактные JSON:
 *
 *   src/lib/physicsDifficulty.data.json      — external_id → сложность (по возрастанию id);
 *   src/lib/physicsTopicsCatalog.data.json   — 89 тем в порядке отчёта.
 *
 * Это единственное место с правилами разбора отчётов: второй копии в `src` нет.
 * Поменялись отчёты — `npm run build:physics-data` и закоммитить оба JSON.
 * Повторный прогон на тех же отчётах даёт байт-в-байт тот же вывод.
 *
 * Проверка: `src/lib/__tests__/physicsCatalogData.test.ts` разбирает отчёты этими же
 * функциями и сравнивает с закоммиченными JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const APPLY_LOG_PATH = join(ROOT, 'reports/physics-ege/apply-log.csv')
export const DRY_RUN_PREVIEW_PATH = join(ROOT, 'reports/physics-ege/dry-run-preview.json')
export const DIFFICULTY_DATA_PATH = join(ROOT, 'src/lib/physicsDifficulty.data.json')
export const TOPICS_DATA_PATH = join(ROOT, 'src/lib/physicsTopicsCatalog.data.json')

const DIFFICULTIES = ['лёгкая', 'средняя', 'сложная']

/** Ячейка сложности: пробелы и кавычки по краям срезаются; не из трёх значений — null. */
export function normalizeDifficulty(raw) {
  const value = String(raw).trim().replace(/^"+|"+$/g, '')
  return DIFFICULTIES.includes(value) ? value : null
}

/**
 * apply-log.csv → { [external_id]: сложность }.
 * Заголовок пропускается; строка режется по `","` (все ячейки отчёта в кавычках);
 * столбец 0 — external_id, столбец 5 — сложность; строки короче 6 ячеек,
 * с нечисловым id или неизвестной сложностью отбрасываются; при повторе id
 * побеждает последняя строка.
 */
export function parseDifficultyMap(csv) {
  const map = {}
  const lines = csv.split(/\r?\n/).slice(1)
  for (const line of lines) {
    if (!line.trim()) continue
    const cells = line.split('","').map((cell, index, arr) => {
      if (index === 0) return cell.replace(/^"/, '')
      if (index === arr.length - 1) return cell.replace(/"$/, '')
      return cell
    })
    if (cells.length < 6) continue
    const externalId = Number(cells[0])
    const difficulty = normalizeDifficulty(cells[5] ?? '')
    if (!Number.isFinite(externalId) || !difficulty) continue
    map[externalId] = difficulty
  }
  return map
}

const TOPIC_LINE_RE = /^- ([0-9a-f-]+) \| external_id=(\d+) \| (.+)$/i

/**
 * dry-run-preview.json → [{ id, external_id, title }].
 * Список тем — строки вида `- <uuid> | external_id=<n> | <название>` во втором
 * системном сообщении первого превью; порядок — как в отчёте.
 */
export function parsePhysicsTopicsCatalog(raw) {
  const parsed = JSON.parse(raw)
  const systemText = parsed[0]?.payload_preview?.system?.[1]?.text ?? ''
  const items = []
  for (const line of systemText.split(/\r?\n/)) {
    const match = TOPIC_LINE_RE.exec(line.trim())
    if (!match) continue
    items.push({ id: match[1], external_id: Number(match[2]), title: match[3] })
  }
  return items
}

/**
 * Текст JSON-файла сложностей: по записи на строку, id по возрастанию
 * (целочисленные ключи объект и так держит по возрастанию — сортировка явная,
 * чтобы не зависеть от этого).
 */
export function serializeDifficultyMap(map) {
  const ids = Object.keys(map).map(Number).sort((a, b) => a - b)
  if (ids.length === 0) return '{}\n'
  return '{\n' + ids.map(id => `  "${id}": ${JSON.stringify(map[id])}`).join(',\n') + '\n}\n'
}

/** Текст JSON-файла тем: по теме на строку, ключи в порядке id, external_id, title. */
export function serializeTopicsCatalog(items) {
  if (items.length === 0) return '[]\n'
  return '[\n' + items
    .map(t => '  ' + JSON.stringify({ id: t.id, external_id: t.external_id, title: t.title }))
    .join(',\n') + '\n]\n'
}

/** Оба файла из отчётов на диске: { difficulty, topics } — готовый текст. */
export function buildPhysicsCatalogData() {
  const difficultyMap = parseDifficultyMap(readFileSync(APPLY_LOG_PATH, 'utf8'))
  const topics = parsePhysicsTopicsCatalog(readFileSync(DRY_RUN_PREVIEW_PATH, 'utf8'))
  return {
    difficultyMap,
    topics,
    difficulty: serializeDifficultyMap(difficultyMap),
    topicsText: serializeTopicsCatalog(topics),
  }
}

const IS_MAIN = Boolean(process.argv[1] && process.argv[1].endsWith('build-physics-catalog-data.mjs'))

if (IS_MAIN) {
  const { difficultyMap, topics, difficulty, topicsText } = buildPhysicsCatalogData()
  if (Object.keys(difficultyMap).length === 0 || topics.length === 0) {
    console.error('Отчёты разобраны в пустоту — файлы не перезаписаны. Проверьте reports/physics-ege/.')
    process.exit(1)
  }
  writeFileSync(DIFFICULTY_DATA_PATH, difficulty)
  writeFileSync(TOPICS_DATA_PATH, topicsText)
  console.log(`Сложности: ${Object.keys(difficultyMap).length} записей → ${DIFFICULTY_DATA_PATH} (${Buffer.byteLength(difficulty)} Б)`)
  console.log(`Темы: ${topics.length} → ${TOPICS_DATA_PATH} (${Buffer.byteLength(topicsText)} Б)`)
}
