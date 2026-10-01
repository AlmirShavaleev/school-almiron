/**
 * §253. Данные каталога физики: отчёты разбирает скрипт, клиент берёт готовый JSON.
 *
 * 1. Закоммиченные `src/lib/*.data.json` — ровно то, что скрипт сейчас получает из
 *    отчётов (байт в байт: забыли `npm run build:physics-data` после правки отчёта —
 *    тест красный).
 * 2. Правила разбора скрипта на маленьких входах (кавычки, CRLF, короткие строки,
 *    чужие сложности, порядок тем).
 * 3. Публичные экспорты `physicsDifficulty` / `physicsTopicsCatalog` видят те же данные.
 * 4. Сборка: модуль `useCatalog`, собранный Vite, не содержит строк из отчётов и
 *    весит меньше 100 КБ (до §253 — 1,1 МБ из-за `?raw`-импорта двух отчётов).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  APPLY_LOG_PATH,
  DIFFICULTY_DATA_PATH,
  DRY_RUN_PREVIEW_PATH,
  TOPICS_DATA_PATH,
  buildPhysicsCatalogData,
  normalizeDifficulty,
  parseDifficultyMap,
  parsePhysicsTopicsCatalog,
  serializeDifficultyMap,
  serializeTopicsCatalog,
} from '../../../scripts/build-physics-catalog-data.mjs'
import { getPhysicsDifficultyOrder, physicsDifficultyByExternalId } from '@/lib/physicsDifficulty'
import { physicsTopicsCatalog } from '@/lib/physicsTopicsCatalog'

const ROOT = path.resolve(__dirname, '../../..')

describe('скрипт build-physics-catalog-data: отчёты → JSON', () => {
  const built = buildPhysicsCatalogData()

  it('закоммиченные JSON совпадают с выводом скрипта байт в байт', () => {
    expect(readFileSync(DIFFICULTY_DATA_PATH, 'utf8')).toBe(built.difficulty)
    expect(readFileSync(TOPICS_DATA_PATH, 'utf8')).toBe(built.topicsText)
  })

  it('сложности: 3101 запись, выборочные external_id', () => {
    const map = built.difficultyMap
    expect(Object.keys(map)).toHaveLength(3101)
    expect(map[159027]).toBe('средняя') // первая строка отчёта
    expect(map[13527]).toBe('средняя')
    expect(map[11089]).toBe('лёгкая')
    expect(map[11974]).toBe('сложная')
    expect(map[186532]).toBe('лёгкая')
    const counts: Record<string, number> = {}
    for (const v of Object.values(map)) counts[v] = (counts[v] ?? 0) + 1
    expect(counts).toEqual({ 'лёгкая': 779, 'средняя': 1792, 'сложная': 530 })
  })

  it('темы: 89 штук в порядке отчёта, id уникальны', () => {
    const topics = built.topics
    expect(topics).toHaveLength(89)
    expect(topics[0]).toEqual({
      id: '476d71d1-72c6-4050-b35d-a3dc2e9f767f',
      external_id: 900101,
      title: 'Равномерное прямолинейное движение',
    })
    expect(topics[1].title).toBe('Равноускоренное движение')
    expect(topics.at(-1)).toEqual({
      id: '547415ce-6563-4618-a7b0-cda276419c8f',
      external_id: 900712,
      title: 'Связь массы и энергии',
    })
    expect(new Set(topics.map(t => t.id)).size).toBe(89)
  })

  it('повторная сериализация разобранного JSON даёт тот же текст (детерминизм)', () => {
    const reparsedMap = JSON.parse(built.difficulty)
    expect(serializeDifficultyMap(reparsedMap)).toBe(built.difficulty)
    expect(serializeTopicsCatalog(JSON.parse(built.topicsText))).toBe(built.topicsText)
    // Ключи сложностей — по возрастанию id, вне зависимости от порядка строк в отчёте.
    const ids = Object.keys(reparsedMap).map(Number)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })
})

describe('правила разбора apply-log.csv', () => {
  it('режет по "," , снимает кавычки, пропускает заголовок, пустые, короткие и чужие строки', () => {
    const csv = [
      'external_id,task_id,primary_topic_id,primary_topic_title,confidence,difficulty,action',
      '"10","t","p","Тема, с запятой","0.9","лёгкая","inserted"',
      '"11","t","p","Тема","0.9","сложная"',
      '',
      '"12","t","p","Тема","0.9","невозможная","inserted"',
      '"13","t","p","0.9"',
      '"abc","t","p","Тема","0.9","средняя","inserted"',
      '"10","t","p","Тема","0.9","средняя","updated"',
    ].join('\r\n')
    expect(parseDifficultyMap(csv)).toEqual({ 10: 'средняя', 11: 'сложная' })
  })

  it('normalizeDifficulty: пробелы и кавычки по краям, иначе null', () => {
    expect(normalizeDifficulty(' "лёгкая" ')).toBe('лёгкая')
    expect(normalizeDifficulty('средняя')).toBe('средняя')
    expect(normalizeDifficulty('легкая')).toBeNull()
    expect(normalizeDifficulty('')).toBeNull()
  })
})

describe('правила разбора dry-run-preview.json', () => {
  it('берёт строки «- uuid | external_id=N | название» из второго системного сообщения', () => {
    const text = [
      'Вступление',
      '- 0a-b1 | external_id=7 | Первая тема',
      '  - ff-00 | external_id=3 | Вторая | с чертой  ',
      '- zz | external_id=9 | не uuid',
    ].join('\n')
    const raw = JSON.stringify([{ payload_preview: { system: [{ text: '- 11 | external_id=1 | мимо' }, { text }] } }])
    expect(parsePhysicsTopicsCatalog(raw)).toEqual([
      { id: '0a-b1', external_id: 7, title: 'Первая тема' },
      { id: 'ff-00', external_id: 3, title: 'Вторая | с чертой' },
    ])
    expect(parsePhysicsTopicsCatalog('[]')).toEqual([])
  })
})

describe('публичные экспорты клиента', () => {
  it('physicsDifficultyByExternalId и physicsTopicsCatalog — данные из отчётов', () => {
    const built = buildPhysicsCatalogData()
    expect(physicsDifficultyByExternalId).toEqual(built.difficultyMap)
    expect(physicsDifficultyByExternalId[159027]).toBe('средняя')
    expect(physicsTopicsCatalog).toEqual(built.topics)
  })

  it('getPhysicsDifficultyOrder: лёгкая < средняя < сложная < неизвестно/пусто', () => {
    expect(getPhysicsDifficultyOrder('лёгкая')).toBe(0)
    expect(getPhysicsDifficultyOrder('средняя')).toBe(1)
    expect(getPhysicsDifficultyOrder('сложная')).toBe(2)
    expect(getPhysicsDifficultyOrder('другая')).toBe(Number.MAX_SAFE_INTEGER)
    expect(getPhysicsDifficultyOrder(null)).toBe(Number.MAX_SAFE_INTEGER)
    expect(getPhysicsDifficultyOrder(undefined)).toBe(Number.MAX_SAFE_INTEGER)
    const sorted = ['сложная', null, 'лёгкая', 'средняя'].sort(
      (a, b) => getPhysicsDifficultyOrder(a) - getPhysicsDifficultyOrder(b),
    )
    expect(sorted).toEqual(['лёгкая', 'средняя', 'сложная', null])
  })
})

describe('сборка: отчёты не попадают в клиентский код', () => {
  // Строки, которые есть только в отчётах, но не в JSON-данных: task_id из первой
  // строки apply-log.csv и адрес задачи из первой записи dry-run-preview.json.
  const CSV_MARKER = 'b28982f9-53b1-4910-ba81-40a451fabdd7'
  const PREVIEW_MARKER = 'shkolkovo.online/catalog/1723/177183'

  it('маркеры действительно есть в отчётах и отсутствуют в JSON', () => {
    expect(readFileSync(APPLY_LOG_PATH, 'utf8')).toContain(CSV_MARKER)
    expect(readFileSync(DRY_RUN_PREVIEW_PATH, 'utf8')).toContain(PREVIEW_MARKER)
    for (const file of [DIFFICULTY_DATA_PATH, TOPICS_DATA_PATH]) {
      const text = readFileSync(file, 'utf8')
      expect(text).not.toContain(CSV_MARKER)
      expect(text).not.toContain(PREVIEW_MARKER)
    }
  })

  it('useCatalog, собранный Vite, без строк отчётов и меньше 100 КБ', async () => {
    const { build } = await import('vite')
    // Собираем только граф исходников useCatalog: пакеты из node_modules — внешние,
    // чтобы замер отражал наш код и данные, а не supabase-js/react.
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      root: ROOT,
      cacheDir: path.join(os.tmpdir(), 'vite-physics-catalog-data-test'),
      resolve: { alias: { '@': path.join(ROOT, 'src') } },
      build: {
        write: false,
        minify: true,
        sourcemap: false,
        lib: { entry: path.join(ROOT, 'src/hooks/useCatalog.ts'), formats: ['es'], fileName: 'useCatalog' },
        rolldownOptions: { external: (id: string) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('@/') && !id.startsWith('\0') },
      },
    })
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ type: string; code?: string }> }>
    const code = outputs.flatMap(r => r.output).filter(o => o.type === 'chunk').map(o => o.code ?? '').join('\n')
    expect(code.length).toBeGreaterThan(1000) // сборка действительно что-то собрала
    expect(code).toContain('Равномерное прямолинейное движение') // темы на месте
    expect(code).not.toContain(CSV_MARKER)
    expect(code).not.toContain(PREVIEW_MARKER)
    expect(Buffer.byteLength(code)).toBeLessThan(100 * 1024)
  }, 60_000)
})
