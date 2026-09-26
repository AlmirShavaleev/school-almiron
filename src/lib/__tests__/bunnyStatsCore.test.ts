import { describe, expect, it, vi } from 'vitest'
import {
  FORCE_MIN_INTERVAL_MS,
  LIBRARY_TTL_MS,
  handleStatsRequest,
  joinMaterials,
  type MaterialRow,
  type StatsCache,
  type StatsDeps,
} from '../../../supabase/functions/bunny-video-stats/core.ts'
import {
  LIBRARY_CACHE_KEY,
  heatmapCacheKey,
  libraryOfVideo,
  pickLibrary,
  resolveLibraries,
} from '../../../supabase/functions/bunny-video-stats/libraries.ts'

/**
 * §232. Статистика видео по нескольким библиотекам Bunny.
 *
 * Математика (726880) и физика (763334) — разные библиотеки с разными
 * ключами. Здесь гоняется вся логика функции `bunny-video-stats`, кроме
 * дверей прав и выборок из базы: `fetch` подменён фальшивым Bunny, который
 * отвечает только на свой ключ, кэш — словарь в памяти.
 *
 * Что сторожится:
 *  • каждая библиотека ходит в Bunny СВОИМ ключом, и ролик физики попадает в
 *    статистику физики, а не математики;
 *  • без ключа физики функция работает как раньше, а физика помечена
 *    спокойно — «ключ не задан», не ошибка всей функции;
 *  • отказ одной библиотеки (401, неизвестная библиотека) не ломает другую;
 *  • ключи не попадают ни в ответ, ни в лог;
 *  • кэш разделён по библиотеке и не требует миграции.
 */

const MATH_KEY = 'math-key-SECRET-1111'
const PHYS_KEY = 'phys-key-SECRET-2222'

const G = (n: number) => `0000000${n}-58da-4ba4-b94a-cdc2d4584d86`
const MATH_A = G(1)
const MATH_B = G(2)
const PHYS_A = G(3)
const PHYS_B = G(4)
const PHYS_UNATTACHED = G(5)

const embed = (lib: string, guid: string) => `https://iframe.mediadelivery.net/embed/${lib}/${guid}`

interface FakeLibrary {
  key: string
  videos: Array<Record<string, unknown>>
  statsStatus?: number
  listStatus?: number
  heatmap?: Record<string, number>
}

/**
 * Фальшивый Bunny: библиотека отвечает только на свой ключ (как настоящий —
 * ключ Stream выдаётся на библиотеку), неизвестная библиотека — 404.
 */
function fakeBunny(libs: Record<string, FakeLibrary>) {
  const calls: Array<{ url: string; key: string }> = []
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    const key = String((init?.headers as Record<string, string>)?.AccessKey ?? '')
    calls.push({ url: input, key })
    const url = new URL(input)
    const m = url.pathname.match(/^\/library\/(\d+)\/(videos|statistics)(?:\/([^/]+)\/heatmap)?$/)
    const lib = m ? libs[m[1]] : undefined
    if (!m || !lib) return new Response(JSON.stringify({ Message: 'Library not found' }), { status: 404 })
    if (lib.key !== key) return new Response(JSON.stringify({ Message: 'Unauthorized' }), { status: 401 })
    if (m[3]) return new Response(JSON.stringify({ heatmap: lib.heatmap ?? {} }), { status: 200 })
    if (m[2] === 'statistics') {
      if (lib.statsStatus) return new Response('{}', { status: lib.statsStatus })
      return new Response(JSON.stringify({
        viewsChart: { '2026-09-25T00:00:00Z': 3, '2026-09-26T00:00:00Z': 4 },
        watchTimeChart: { '2026-09-25T00:00:00Z': 600, '2026-09-26T00:00:00Z': 120 },
      }), { status: 200 })
    }
    if (lib.listStatus) return new Response('{}', { status: lib.listStatus })
    return new Response(JSON.stringify({ items: lib.videos, totalItems: lib.videos.length }), { status: 200 })
  })
  return { fetchFn, calls }
}

function video(guid: string, views: number, title = guid) {
  return { guid, title, views, length: 600, totalWatchTime: views * 100, averageWatchTime: 100 }
}

const MATH_LIB: FakeLibrary = { key: MATH_KEY, videos: [video(MATH_A, 11, 'Векторы'), video(MATH_B, 0)] }
const PHYS_LIB: FakeLibrary = {
  key: PHYS_KEY,
  videos: [video(PHYS_A, 5, 'Кинематика'), video(PHYS_B, 0), video(PHYS_UNATTACHED, 2)],
  heatmap: { '0': 100, '1': 40 },
}

const MATERIALS: MaterialRow[] = [
  { url: embed('726880', MATH_A), topicTitle: 'Векторы', courseTitle: 'Математика 11А', isTemplate: false },
  { url: embed('726880', MATH_A), topicTitle: 'Векторы', courseTitle: 'Математика шаблон', isTemplate: true },
  { url: embed('726880', MATH_B), topicTitle: 'Производная', courseTitle: 'Математика 11А', isTemplate: false },
  { url: embed('763334', PHYS_A), topicTitle: 'Равноускоренное движение', courseTitle: 'Физика ЕГЭ 10А', isTemplate: false },
  { url: embed('763334', PHYS_A), topicTitle: 'Равноускоренное движение', courseTitle: 'Физика ЕГЭ 11А', isTemplate: false },
  { url: embed('763334', PHYS_B), topicTitle: 'Законы Ньютона', courseTitle: 'Физика ЕГЭ 10А', isTemplate: false },
  { url: 'https://youtu.be/abc', topicTitle: 'Чужое видео', courseTitle: 'Математика 11А', isTemplate: false },
]

function memoryCache(initial: Record<string, { payload: unknown; fetched_at: string }> = {}) {
  const rows = new Map(Object.entries(initial))
  const cache: StatsCache & { rows: typeof rows } = {
    rows,
    async get(key) { return rows.get(key) ?? null },
    async put(key, payload, fetchedAt) {
      // Проверка таблицы из миграции 20260909075902 — ключи обязаны в неё влезать.
      if (!(key === 'library' || key.startsWith('heatmap:'))) return 'violates check constraint bunny_video_stats_cache_key_chk'
      rows.set(key, { payload: JSON.parse(JSON.stringify(payload)), fetched_at: fetchedAt })
      return null
    },
  }
  return cache
}

const NOW = Date.parse('2026-09-26T12:00:00Z')

function deps(over: Partial<StatsDeps> & { envVars?: Record<string, string> } = {}): StatsDeps & { logs: string[] } {
  const logs: string[] = []
  const envVars = over.envVars ?? { BUNNY_STREAM_API_KEY: MATH_KEY, BUNNY_PHYSICS_API_KEY: PHYS_KEY }
  return {
    env: name => envVars[name],
    fetch: over.fetch ?? fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB }).fetchFn,
    now: over.now ?? (() => NOW),
    cache: over.cache ?? memoryCache(),
    loadMaterials: over.loadMaterials ?? (async () => MATERIALS),
    log: m => { logs.push(m) },
    logs,
  }
}

type Lib = Record<string, unknown> & {
  id: string; status: string; lessons?: Array<Record<string, unknown>>; message?: string
}
const libs = (body: Record<string, unknown>) => body.libraries as Lib[]
const lib = (body: Record<string, unknown>, id: string) => libs(body).find(l => l.id === id)!

// ── Выбор библиотек ──────────────────────────────────────────────────────

describe('resolveLibraries — библиотеки из секретов', () => {
  it('без номеров — 726880 основная и 763334 физика, каждая со своим ключом', () => {
    const list = resolveLibraries(name => ({ BUNNY_STREAM_API_KEY: MATH_KEY, BUNNY_PHYSICS_API_KEY: PHYS_KEY } as Record<string, string>)[name])
    expect(list.map(l => [l.id, l.label, l.primary, l.apiKey, l.problem])).toEqual([
      ['726880', 'Математика', true, MATH_KEY, null],
      ['763334', 'Физика', false, PHYS_KEY, null],
    ])
  })

  it('ключ физики не задан — не ошибка, а пометка «не настроена»', () => {
    const [math, phys] = resolveLibraries(name => (name === 'BUNNY_STREAM_API_KEY' ? MATH_KEY : undefined))
    expect(math.problem).toBeNull()
    expect(phys.apiKey).toBeNull()
    expect(phys.problem?.kind).toBe('not_configured')
    expect(phys.problem?.message).toContain('Ключ библиотеки физики не задан')
    expect(phys.problem?.message).toContain('BUNNY_PHYSICS_API_KEY')
  })

  it('ключ основной не задан — это поломка настройки, а не «не подключили»', () => {
    const [math] = resolveLibraries(() => undefined)
    expect(math.problem).toEqual({ kind: 'config', message: 'Не задана переменная окружения BUNNY_STREAM_API_KEY.' })
  })

  it('номера из переменных; физика с номером основной выбрасывается — иначе двойной счёт', () => {
    const env: Record<string, string> = {
      BUNNY_STREAM_API_KEY: MATH_KEY, BUNNY_STREAM_LIBRARY_ID: ' 111 ',
      BUNNY_PHYSICS_API_KEY: PHYS_KEY, BUNNY_PHYSICS_LIBRARY_ID: '222',
    }
    expect(resolveLibraries(n => env[n]).map(l => l.id)).toEqual(['111', '222'])
    env.BUNNY_PHYSICS_LIBRARY_ID = '111'
    expect(resolveLibraries(n => env[n]).map(l => l.id)).toEqual(['111'])
  })

  it('номер не числом — отказ настройки с именем переменной, без её значения', () => {
    const env: Record<string, string> = { BUNNY_STREAM_API_KEY: MATH_KEY, BUNNY_PHYSICS_API_KEY: PHYS_KEY, BUNNY_PHYSICS_LIBRARY_ID: '763334/../1' }
    const phys = resolveLibraries(n => env[n])[1]
    expect(phys.problem?.kind).toBe('config')
    expect(phys.problem?.message).toContain('BUNNY_PHYSICS_LIBRARY_ID')
    expect(phys.problem?.message).not.toContain('763334/../1')
    // С битой настройкой ключ в дело не идёт.
    expect(phys.apiKey).toBeNull()
  })
})

describe('pickLibrary и libraryOfVideo', () => {
  const list = resolveLibraries(n => ({ BUNNY_STREAM_API_KEY: 'a', BUNNY_PHYSICS_API_KEY: 'b' } as Record<string, string>)[n])

  it('пусто — основная; номер физики — физика; чужой или мусор — null', () => {
    expect(pickLibrary(list, undefined)?.id).toBe('726880')
    expect(pickLibrary(list, '')?.id).toBe('726880')
    expect(pickLibrary(list, '763334')?.id).toBe('763334')
    expect(pickLibrary(list, '999')).toBeNull()
    expect(pickLibrary(list, '../x')).toBeNull()
    expect(pickLibrary(list, 763334)).toBeNull()
  })

  it('номер из адреса главнее; без номера — по снимкам, иначе основная', () => {
    const owner = new Map([[PHYS_A, '763334']])
    expect(libraryOfVideo({ libraryId: '763334', guid: MATH_A }, '726880', owner)).toBe('763334')
    expect(libraryOfVideo({ libraryId: null, guid: PHYS_A }, '726880', owner)).toBe('763334')
    expect(libraryOfVideo({ libraryId: null, guid: MATH_A }, '726880', owner)).toBe('726880')
  })

  it('ключи кэша влезают в проверку таблицы без миграции', () => {
    expect(LIBRARY_CACHE_KEY).toBe('library')
    expect(heatmapCacheKey('763334', PHYS_A)).toBe(`heatmap:763334:${PHYS_A}`)
  })
})

describe('joinMaterials', () => {
  it('материал → тема → модуль → курс; материал удалённой темы выпадает', () => {
    const rows = joinMaterials(
      [{ topic_id: 't1', url: 'u1' }, { topic_id: 'gone', url: 'u2' }, { topic_id: 't2', url: 'u3' }],
      [{ id: 't1', title: 'Кинематика', module_id: 'm1' }, { id: 't2', title: null, module_id: 'm2' }],
      [{ id: 'm1', course_id: 'c1' }],
      [{ id: 'c1', title: 'Физика ЕГЭ 10А', is_template: false }],
    )
    expect(rows).toEqual([
      { url: 'u1', topicTitle: 'Кинематика', courseTitle: 'Физика ЕГЭ 10А', isTemplate: false },
      { url: 'u3', topicTitle: '', courseTitle: '', isTemplate: false },
    ])
  })
})

// ── Снимок: две библиотеки ───────────────────────────────────────────────

describe('handleStatsRequest — снимок по библиотекам', () => {
  it('ролики физики — в статистике физики, математики — в математике, каждая своим ключом', async () => {
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB })
    const res = await handleStatsRequest({}, deps({ fetch: bunny.fetchFn }))

    expect(res.status).toBe(200)
    expect(libs(res.body).map(l => [l.id, l.label, l.status])).toEqual([
      ['726880', 'Математика', 'ok'],
      ['763334', 'Физика', 'ok'],
    ])

    const math = lib(res.body, '726880')
    expect(math.lessons!.map(l => l.videoId)).toEqual([MATH_A, MATH_B])
    // Шаблон в перечень курсов не идёт; строка одна на ролик.
    expect(math.lessons![0]).toMatchObject({ views: 11, courses: ['Математика 11А'], placements: 2 })

    const phys = lib(res.body, '763334')
    expect(phys.lessons!.map(l => [l.videoId, l.topicTitle, l.views, l.courses])).toEqual([
      [PHYS_A, 'Равноускоренное движение', 5, ['Физика ЕГЭ 10А', 'Физика ЕГЭ 11А']],
      [PHYS_B, 'Законы Ньютона', 0, ['Физика ЕГЭ 10А']],
    ])
    // Ни один ролик физики не выдан за «пропавший из библиотеки математики».
    expect(math.lessons!.some(l => l.missingInBunny)).toBe(false)
    expect(phys.unattachedInLibrary).toBe(1)
    expect(phys.attachedVideos).toBe(2)
    expect(phys.period).toMatchObject({ views: 7, watchTimeRaw: 720, points: 2 })

    // Каждая библиотека ходит в Bunny своим ключом — и только своим.
    for (const call of bunny.calls) {
      const expected = call.url.includes('/library/763334/') ? PHYS_KEY : MATH_KEY
      expect(call.key).toBe(expected)
    }
    expect(bunny.calls.filter(c => c.url.includes('/library/763334/'))).toHaveLength(2)
  })

  it('верхний уровень ответа — основная библиотека в прежнем виде (клиент до §232)', async () => {
    const res = await handleStatsRequest({}, deps())
    const lessons = res.body.lessons as Array<{ videoId: string }>
    expect(lessons.map(l => l.videoId)).toEqual([MATH_A, MATH_B])
    expect(res.body.libraryTotalItems).toBe(2)
    expect(res.body.source).toBe('bunny')
    expect(res.body.error).toBeUndefined()
  })

  it('ключ физики не задан: математика как раньше, физика — спокойная пометка', async () => {
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB })
    const res = await handleStatsRequest({}, deps({ fetch: bunny.fetchFn, envVars: { BUNNY_STREAM_API_KEY: MATH_KEY } }))

    expect(res.status).toBe(200)
    expect(res.body.error).toBeUndefined()
    expect(lib(res.body, '726880').status).toBe('ok')
    const phys = lib(res.body, '763334')
    expect(phys.status).toBe('not_configured')
    expect(phys.message).toContain('Ключ библиотеки физики не задан')
    // Сколько роликов физики ждут ключа — посчитано по адресам материалов.
    expect(phys.attachedVideos).toBe(2)
    expect(phys.lessons).toBeUndefined()
    // В Bunny за физикой не ходили вовсе.
    expect(bunny.calls.some(c => c.url.includes('763334'))).toBe(false)
  })

  it('ключ физики отклонён (401) — отказ словами у физики, математика цела', async () => {
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': { ...PHYS_LIB, key: 'другой' } })
    const res = await handleStatsRequest({}, deps({ fetch: bunny.fetchFn }))

    expect(res.status).toBe(200)
    expect(lib(res.body, '726880').status).toBe('ok')
    const phys = lib(res.body, '763334')
    expect(phys).toMatchObject({ status: 'error', error: 'bad_key' })
    expect(phys.message).toContain('«Физика» (763334)')
    expect(phys.message).toContain('BUNNY_PHYSICS_API_KEY')
    expect(res.body.error).toBeUndefined()
  })

  it('Bunny не знает библиотеку физики (404) — сообщение называет переменную номера', async () => {
    const bunny = fakeBunny({ '726880': MATH_LIB })
    const res = await handleStatsRequest({}, deps({ fetch: bunny.fetchFn }))
    const phys = lib(res.body, '763334')
    expect(phys).toMatchObject({ status: 'error', error: 'library_not_found' })
    expect(phys.message).toBe('Bunny не знает библиотеку 763334. Проверьте BUNNY_PHYSICS_LIBRARY_ID.')
    expect(lib(res.body, '726880').status).toBe('ok')
  })

  it('упала основная — физика всё равно показана, прежний клиент видит отказ словами', async () => {
    const bunny = fakeBunny({ '726880': { ...MATH_LIB, key: 'не тот' }, '763334': PHYS_LIB })
    const res = await handleStatsRequest({}, deps({ fetch: bunny.fetchFn }))

    expect(res.status).toBe(200)
    expect(res.body.error).toBe('bad_key')
    expect(String(res.body.message)).toContain('BUNNY_STREAM_API_KEY')
    expect(lib(res.body, '726880').status).toBe('error')
    expect(lib(res.body, '763334').status).toBe('ok')
  })

  it('ключи не попадают ни в ответ, ни в лог — даже при отказах', async () => {
    const variants: Array<Record<string, FakeLibrary>> = [
      { '726880': MATH_LIB, '763334': PHYS_LIB },
      { '726880': { ...MATH_LIB, key: 'x' }, '763334': { ...PHYS_LIB, key: 'y' } },
      { '726880': { ...MATH_LIB, listStatus: 500, statsStatus: 500 } },
    ]
    for (const variant of variants) {
      const d = deps({ fetch: fakeBunny(variant).fetchFn })
      const res = await handleStatsRequest({}, d)
      const heat = await handleStatsRequest({ heatmap: PHYS_A, library: '763334' }, d)
      const text = JSON.stringify([res, heat, d.logs])
      expect(text).not.toContain(MATH_KEY)
      expect(text).not.toContain(PHYS_KEY)
    }
  })

  it('часть запросов упала (статистика 500) — числа по роликам есть, пометка «неполные»', async () => {
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': { ...PHYS_LIB, statsStatus: 500 } })
    const res = await handleStatsRequest({}, deps({ fetch: bunny.fetchFn }))
    const phys = lib(res.body, '763334')
    expect(phys.status).toBe('ok')
    expect(phys.partial).toBe(true)
    expect(phys.lessons!.length).toBe(2)
  })

  it('адрес без номера: guid из снимка физики — в физику, неизвестный — в основную', async () => {
    const unknownGuid = G(9)
    const materials: MaterialRow[] = [
      { url: PHYS_A, topicTitle: 'Голый guid физики', courseTitle: 'Физика ЕГЭ 10А', isTemplate: false },
      { url: `https://vz-abc.b-cdn.net/${unknownGuid}/playlist.m3u8`, topicTitle: 'Поток', courseTitle: 'Математика 11А', isTemplate: false },
    ]
    const res = await handleStatsRequest({}, deps({ loadMaterials: async () => materials }))
    expect(lib(res.body, '763334').lessons!.map(l => l.videoId)).toEqual([PHYS_A])
    const mathLessons = lib(res.body, '726880').lessons!
    expect(mathLessons.map(l => [l.videoId, l.missingInBunny])).toEqual([[unknownGuid, true]])
  })

  it('номер библиотеки, которой функция не знает, — отдельной строкой, не в чужой статистике', async () => {
    const materials: MaterialRow[] = [
      ...MATERIALS,
      { url: embed('111111', G(7)), topicTitle: 'Химия', courseTitle: 'Химия', isTemplate: false },
    ]
    const res = await handleStatsRequest({}, deps({ loadMaterials: async () => materials }))
    expect(res.body.unknownLibraries).toEqual([{ libraryId: '111111', videos: 1 }])
    expect(libs(res.body).flatMap(l => l.lessons ?? []).some(l => l.videoId === G(7))).toBe(false)
    expect((res.body.meta as { library_ids_in_db: string[] }).library_ids_in_db).toEqual(['111111', '726880', '763334'])
  })

  it('отказ базы — 500 со словами, в Bunny не ходим', async () => {
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB })
    const res = await handleStatsRequest({}, deps({
      fetch: bunny.fetchFn,
      loadMaterials: async () => { throw new Error('темы: permission denied') },
    }))
    expect(res).toEqual({ status: 500, body: { error: 'db', message: 'Не удалось прочитать материалы тем: темы: permission denied' } })
    expect(bunny.calls).toHaveLength(0)
  })
})

// ── Кэш ──────────────────────────────────────────────────────────────────

describe('handleStatsRequest — кэш по библиотекам', () => {
  it('снимки лежат в строке library словарём по номеру; второй заход — из кэша, без Bunny', async () => {
    const cache = memoryCache()
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB })
    const first = await handleStatsRequest({}, deps({ cache, fetch: bunny.fetchFn }))
    expect(first.body.cache_written).toBe(true)

    const row = cache.rows.get('library')!
    const payload = row.payload as { version: number; libraries: Record<string, { fetched_at: string }> }
    expect(payload.version).toBe(2)
    expect(Object.keys(payload.libraries).sort()).toEqual(['726880', '763334'])

    const callsBefore = bunny.calls.length
    const second = await handleStatsRequest({}, deps({ cache, fetch: bunny.fetchFn, now: () => NOW + 60_000 }))
    expect(bunny.calls.length).toBe(callsBefore)
    expect(libs(second.body).map(l => l.source)).toEqual(['cache', 'cache'])
    expect(lib(second.body, '763334').lessons!.map(l => l.videoId)).toEqual([PHYS_A, PHYS_B])
  })

  it('строка library прежнего вида (§146, без номера) не читается — идём в Bunny и перезаписываем', async () => {
    const cache = memoryCache({
      library: { payload: { videos: [video(MATH_A, 999)], totalItems: 1 }, fetched_at: new Date(NOW - 1000).toISOString() },
    })
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB })
    const res = await handleStatsRequest({}, deps({ cache, fetch: bunny.fetchFn }))
    expect(lib(res.body, '726880').source).toBe('bunny')
    expect(lib(res.body, '726880').lessons![0].views).toBe(11)
    expect((cache.rows.get('library')!.payload as { version: number }).version).toBe(2)
  })

  it('«Обновить» чаще раза в минуту — прежние данные с пометкой; позже — снова Bunny', async () => {
    const cache = memoryCache()
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB })
    await handleStatsRequest({}, deps({ cache, fetch: bunny.fetchFn }))
    const n = bunny.calls.length

    const soon = await handleStatsRequest({ force: true }, deps({ cache, fetch: bunny.fetchFn, now: () => NOW + 5_000 }))
    expect(bunny.calls.length).toBe(n)
    expect(libs(soon.body).map(l => l.throttled)).toEqual([true, true])
    expect(soon.body.throttled).toBe(true)

    await handleStatsRequest({ force: true }, deps({ cache, fetch: bunny.fetchFn, now: () => NOW + FORCE_MIN_INTERVAL_MS + 1 }))
    expect(bunny.calls.length).toBeGreaterThan(n)
  })

  it('отказ физики при обновлении не стирает её прежний снимок и не мешает записать математику', async () => {
    const cache = memoryCache()
    await handleStatsRequest({}, deps({ cache }))
    const oldPhysAt = (cache.rows.get('library')!.payload as { libraries: Record<string, { fetched_at: string }> })
      .libraries['763334'].fetched_at

    const later = NOW + LIBRARY_TTL_MS + 1
    const broken = fakeBunny({ '726880': MATH_LIB, '763334': { ...PHYS_LIB, key: 'отозван' } })
    const res = await handleStatsRequest({}, deps({ cache, fetch: broken.fetchFn, now: () => later }))
    expect(lib(res.body, '763334').status).toBe('error')
    expect(lib(res.body, '726880').source).toBe('bunny')

    const entries = (cache.rows.get('library')!.payload as { libraries: Record<string, { fetched_at: string }> }).libraries
    expect(entries['726880'].fetched_at).toBe(new Date(later).toISOString())
    expect(entries['763334'].fetched_at).toBe(oldPhysAt)
  })

  it('кэш не записался — данные всё равно отданы, с пометкой и строкой в логе', async () => {
    const cache = memoryCache()
    cache.put = async () => 'relation does not exist'
    const d = deps({ cache })
    const res = await handleStatsRequest({}, d)
    expect(res.body.cache_written).toBe(false)
    expect(lib(res.body, '726880').status).toBe('ok')
    expect(d.logs.some(l => l.includes('кэш не записан'))).toBe(true)
  })
})

// ── Тепловая карта ───────────────────────────────────────────────────────

describe('handleStatsRequest — тепловая карта', () => {
  it('карта физики — из библиотеки физики её ключом, кэш под номером библиотеки', async () => {
    const cache = memoryCache()
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': PHYS_LIB })
    const res = await handleStatsRequest({ heatmap: PHYS_A, library: '763334' }, deps({ cache, fetch: bunny.fetchFn }))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ videoId: PHYS_A, library: '763334', heatmap: { '0': 100, '1': 40 }, source: 'bunny' })
    expect(bunny.calls).toEqual([{ url: `https://video.bunnycdn.com/library/763334/videos/${PHYS_A}/heatmap`, key: PHYS_KEY }])
    expect(cache.rows.has(`heatmap:763334:${PHYS_A}`)).toBe(true)

    const again = await handleStatsRequest({ heatmap: PHYS_A, library: '763334' }, deps({ cache, fetch: bunny.fetchFn }))
    expect(again.body.source).toBe('cache')
    expect(bunny.calls).toHaveLength(1)
  })

  it('без номера библиотеки — основная (прежний клиент)', async () => {
    const bunny = fakeBunny({ '726880': { ...MATH_LIB, heatmap: { '0': 100 } } })
    const res = await handleStatsRequest({ heatmap: MATH_A }, deps({ fetch: bunny.fetchFn }))
    expect(res.body).toMatchObject({ library: '726880', heatmap: { '0': 100 } })
    expect(bunny.calls[0].key).toBe(MATH_KEY)
  })

  it('физика без ключа — 200 с пометкой, не ошибка функции; чужая библиотека и мусор — 400', async () => {
    const noPhys = deps({ envVars: { BUNNY_STREAM_API_KEY: MATH_KEY } })
    const res = await handleStatsRequest({ heatmap: PHYS_A, library: '763334' }, noPhys)
    expect(res.status).toBe(200)
    expect(res.body.error).toBe('not_configured')

    expect((await handleStatsRequest({ heatmap: PHYS_A, library: '999' }, deps())).status).toBe(400)
    expect((await handleStatsRequest({ heatmap: '../../x' }, deps())).status).toBe(400)
  })

  it('отказ Bunny по карте — телом со словами, а не 502 (иначе клиент видит «non-2xx»)', async () => {
    const bunny = fakeBunny({ '726880': MATH_LIB, '763334': { ...PHYS_LIB, key: 'чужой' } })
    const res = await handleStatsRequest({ heatmap: PHYS_A, library: '763334' }, deps({ fetch: bunny.fetchFn }))
    expect(res.status).toBe(200)
    expect(res.body.error).toBe('bad_key')
    expect(String(res.body.message)).toContain('BUNNY_PHYSICS_API_KEY')
  })
})
