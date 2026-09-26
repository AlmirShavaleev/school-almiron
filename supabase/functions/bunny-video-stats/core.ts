/**
 * Логика `bunny-video-stats` без Deno и без базы (§232).
 *
 * Что здесь: походы в Bunny (через переданный `fetch`), кэш (через переданное
 * хранилище), склейка роликов с темами курсов, разбор ответа по библиотекам.
 * Что в `index.ts`: CORS, две двери прав, клиенты Supabase и четыре плоские
 * выборки материалов. Разделено ради тестов — `index.ts` живёт в Deno и в
 * vitest не запускается, а всё, что здесь, гоняет
 * `src/lib/__tests__/bunnyStatsCore.test.ts` с подменённым `fetch`.
 *
 * НЕСКОЛЬКО БИБЛИОТЕК. Математика и физика — разные библиотеки Bunny с
 * разными ключами (`libraries.ts`). Каждая ходит в Bunny своим ключом, и отказ
 * одной не роняет другую: результат — по библиотеке, со своим статусом и
 * человеческим сообщением. Ответ целиком — 200, пока сама функция работает.
 *
 * СОВМЕСТИМОСТЬ. Верхний уровень ответа повторяет прежний вид для основной
 * библиотеки (`lessons`, `period`, …, а при её отказе — `error`/`message`):
 * клиент до §232 продолжит показывать математику, если функцию выкатят
 * раньше сайта. Новый клиент читает `libraries`.
 */

import { parseBunnyVideoUrl } from '../_shared/bunnyVideoUrl.ts'
import {
  LIBRARY_CACHE_KEY,
  heatmapCacheKey,
  libraryOfVideo,
  pickLibrary,
  publicLibrary,
  resolveLibraries,
  type BunnyLibrary,
} from './libraries.ts'

/**
 * Свежесть снимка библиотеки. Вводная §146 просила 6–12 часов: статистика
 * просмотров меняется медленно, дёргать Bunny на каждое открытие незачем.
 */
export const LIBRARY_TTL_MS = 8 * 60 * 60 * 1000
/** Тепловая карта меняется ещё медленнее и берётся по одной, по клику. */
export const HEATMAP_TTL_MS = 12 * 60 * 60 * 1000
/** Чаще раза в минуту «Обновить» не пускаем — иначе кнопка выжигает лимит. */
export const FORCE_MIN_INTERVAL_MS = 60 * 1000
/** Предел на один внешний запрос: висящий fetch не должен держать функцию. */
export const UPSTREAM_TIMEOUT_MS = 15_000
/** Страховка от бесконечной прокрутки, если Bunny начнёт врать про страницы. */
const MAX_PAGES = 10
/** Больше сотни за раз Bunny не отдаёт — это его предел, не наш. */
const ITEMS_PER_PAGE = 100
/** Окно для «сколько минут отсмотрено за период». */
export const PERIOD_DAYS = 30

const BUNNY_BASE = 'https://video.bunnycdn.com'

// ── Поход в Bunny ────────────────────────────────────────────────────────

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface UpstreamResult {
  ok: boolean
  status: number
  data: unknown
  /** Текст ошибки Bunny. Нашего ключа в нём нет — это ответ их API. */
  message?: string
}

export async function bunnyGet(
  fetchFn: FetchLike,
  path: string,
  params: Record<string, string>,
  key: string,
): Promise<UpstreamResult> {
  const url = new URL(`${BUNNY_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== '') url.searchParams.set(k, v)
  }

  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetchFn(url.toString(), {
      headers: { AccessKey: key, accept: 'application/json' },
      signal: control.signal,
    })
    const text = await res.text()
    let parsed: unknown = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }

    if (!res.ok) {
      const asObject = parsed as { Message?: string; message?: string } | null
      const message = typeof parsed === 'object' && parsed !== null
        ? String(asObject?.Message ?? asObject?.message ?? '').slice(0, 300)
        : String(parsed ?? '').slice(0, 300)
      return { ok: false, status: res.status, data: null, message }
    }
    return { ok: true, status: res.status, data: parsed }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      data: null,
      message: aborted ? `Bunny не ответил за ${UPSTREAM_TIMEOUT_MS / 1000} с` : 'Сеть недоступна',
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface LibraryProblem {
  kind: string
  message: string
}

/**
 * Отказ Bunny — СЛОВАМИ, а не нулями, и с именем библиотеки.
 *
 * Урок §135: экран, показавший «0 просмотров» вместо «ключ отклонён», врёт.
 * С двумя библиотеками добавилось второе: сообщение обязано сказать, ЧЕЙ ключ
 * отклонён и какую переменную проверять, иначе владелец пойдёт править ключ
 * математики, который работает.
 */
export function classifyFailure(failed: UpstreamResult[], lib: BunnyLibrary): LibraryProblem {
  const name = `«${lib.label}» (${lib.id})`
  if (failed.some(r => r.status === 401 || r.status === 403)) {
    return {
      kind: 'bad_key',
      message: `Bunny отклонил ключ библиотеки ${name}: он недействителен или у него нет доступа к этой библиотеке. Проверьте ${lib.keyVar} в переменных проекта.`,
    }
  }
  if (failed.some(r => r.status === 404)) {
    return {
      kind: 'library_not_found',
      message: `Bunny не знает библиотеку ${lib.id}. Проверьте ${lib.idVar}.`,
    }
  }
  const first = failed[0]
  return {
    kind: 'upstream',
    message: `Bunny ответил ошибкой по библиотеке ${name} (${first?.status || 'нет ответа'}). ${first?.message ?? ''}`.trim(),
  }
}

export interface BunnyVideo {
  guid: string
  title: string
  views: number
  /** Секунды. Проверено разведкой §146 на живых ответах. */
  length: number
  totalWatchTime: number
  averageWatchTime: number
}

function toVideo(row: Record<string, unknown>): BunnyVideo | null {
  // Строчными: так же приводит guid разбор адреса (§168), сопоставление — по строке.
  const guid = String(row.guid ?? '').trim().toLowerCase()
  if (!guid) return null
  return {
    guid,
    title: String(row.title ?? ''),
    views: Number(row.views ?? 0),
    length: Number(row.length ?? 0),
    totalWatchTime: Number(row.totalWatchTime ?? 0),
    averageWatchTime: Number(row.averageWatchTime ?? 0),
  }
}

/** Сумма значений графика Bunny (`{ "2026-09-01T00:00:00Z": 12, … }`). */
function chartTotal(chart: unknown): number {
  if (!chart || typeof chart !== 'object') return 0
  return Object.values(chart as Record<string, unknown>)
    .reduce<number>((sum, v) => sum + Number(v ?? 0), 0)
}

function chartPoints(chart: unknown): Array<{ at: string; value: number }> {
  if (!chart || typeof chart !== 'object') return []
  return Object.entries(chart as Record<string, unknown>)
    .map(([at, value]) => ({ at, value: Number(value ?? 0) }))
    .sort((a, b) => a.at.localeCompare(b.at))
}

/** Начало суток UTC, `daysAgo` назад от `now`. `-1` — начало завтрашнего дня. */
export function dayStartIso(now: number, daysAgo: number): string {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString()
}

export interface LibrarySnapshot {
  videos: BunnyVideo[]
  totalItems: number
  period: {
    days: number
    since: string
    until: string
    views: number
    watchTimeRaw: number
    points: number
    viewsChart: Array<{ at: string; value: number }>
    watchTimeChart: Array<{ at: string; value: number }>
    ok: boolean
  }
  partial: boolean
  meta: Record<string, unknown>
}

/**
 * Снимок одной библиотеки: список роликов постранично плюс статистика за
 * период. Три запроса на ~180 роликов, а не по запросу на ролик.
 * `null` снимка — всё упало: это отказ, а не «ноль просмотров».
 */
export async function fetchLibrarySnapshot(
  fetchFn: FetchLike,
  lib: BunnyLibrary & { apiKey: string },
  now: number,
): Promise<{ snapshot: LibrarySnapshot | null; problem: LibraryProblem | null }> {
  const attempts: UpstreamResult[] = []
  const videos: BunnyVideo[] = []
  let totalItems = 0
  let pages = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await bunnyGet(fetchFn, `/library/${lib.id}/videos`, {
      page: String(page),
      itemsPerPage: String(ITEMS_PER_PAGE),
    }, lib.apiKey)
    attempts.push(res)
    pages = page
    if (!res.ok) break

    const body = res.data as { items?: unknown[]; totalItems?: number } | null
    const items = Array.isArray(body?.items) ? body.items : []
    totalItems = Number(body?.totalItems ?? totalItems)
    for (const raw of items) {
      const v = toVideo(raw as Record<string, unknown>)
      if (v) videos.push(v)
    }
    if (items.length < ITEMS_PER_PAGE) break
  }

  const since = dayStartIso(now, PERIOD_DAYS - 1)
  // Начало завтрашнего дня: иначе текущие сутки могут отрезаться целиком
  // (урок §135 про округление границ).
  const until = dayStartIso(now, -1)
  const stats = await bunnyGet(fetchFn, `/library/${lib.id}/statistics`, {
    dateFrom: since,
    dateTo: until,
  }, lib.apiKey)
  attempts.push(stats)

  if (attempts.every(r => !r.ok)) {
    return { snapshot: null, problem: classifyFailure(attempts, lib) }
  }

  const statBody = (stats.ok ? stats.data : null) as {
    viewsChart?: unknown; watchTimeChart?: unknown
  } | null
  const viewsChart = chartPoints(statBody?.viewsChart)

  const period = {
    days: PERIOD_DAYS,
    since,
    until,
    views: chartTotal(statBody?.viewsChart),
    /** Единица — секунды, из разведки §146; поле названо явно, чтобы не гадать. */
    watchTimeRaw: chartTotal(statBody?.watchTimeChart),
    points: viewsChart.length,
    viewsChart,
    watchTimeChart: chartPoints(statBody?.watchTimeChart),
    ok: stats.ok,
  }

  return {
    problem: null,
    snapshot: {
      videos,
      totalItems,
      period,
      partial: attempts.some(r => !r.ok),
      meta: {
        pages_fetched: pages,
        videos_returned: videos.length,
        library_total_items: totalItems,
        statistics_ok: period.ok,
        period_points: period.points,
        statuses: attempts.map(r => r.status),
        errors: attempts.filter(r => !r.ok).map(r => ({ status: r.status, message: r.message ?? '' })),
        /** Один сырой ролик — чтобы единицы читались фактом, а не из документации. */
        raw_sample: videos[0] ?? null,
      },
    },
  }
}

// ── Наши материалы: видео → тема → курс ──────────────────────────────────

/** Материал-видео, уже склеенный с темой и курсом (плоские выборки — в `index.ts`). */
export interface MaterialRow {
  url: string | null
  topicTitle: string
  courseTitle: string
  isTemplate: boolean
}

/**
 * Склейка четырёх плоских выборок в строки материалов.
 *
 * Плоскими, а не embed PostgREST (§146): имена связей в embed — отдельный
 * источник отказов, а строк немного. Материал без темы (удалена) выпадает.
 */
export function joinMaterials(
  items: Array<{ topic_id: string; url: string | null }>,
  topics: Array<{ id: string; title: string | null; module_id: string }>,
  modules: Array<{ id: string; course_id: string }>,
  courses: Array<{ id: string; title: string | null; is_template: boolean | null }>,
): MaterialRow[] {
  const topicById = new Map(topics.map(t => [t.id, t] as const))
  const moduleById = new Map(modules.map(m => [m.id, m] as const))
  const courseById = new Map(courses.map(c => [c.id, c] as const))
  const rows: MaterialRow[] = []
  for (const item of items) {
    const topic = topicById.get(item.topic_id)
    if (!topic) continue
    const mod = moduleById.get(topic.module_id)
    const course = mod ? courseById.get(mod.course_id) : undefined
    rows.push({
      url: item.url,
      topicTitle: topic.title ?? '',
      courseTitle: course?.title ?? '',
      isTemplate: Boolean(course?.is_template),
    })
  }
  return rows
}

export interface Placement {
  libraryId: string
  videoId: string
  topicTitle: string
  courseTitle: string
  isTemplate: boolean
}

/**
 * Материалы → места размещения роликов, каждое со своей библиотекой.
 *
 * Разбор адреса общий с формой материала (§168). Библиотека — из адреса;
 * адрес без номера — по снимкам, иначе основная (`libraryOfVideo`).
 */
export function placementsOf(
  rows: MaterialRow[],
  primaryId: string,
  owner: ReadonlyMap<string, string>,
): { placements: Placement[]; libraryIdsInDb: string[] } {
  const placements: Placement[] = []
  const ids = new Set<string>()
  for (const row of rows) {
    const ref = parseBunnyVideoUrl(row.url)
    if (!ref) continue
    if (ref.libraryId) ids.add(ref.libraryId)
    placements.push({
      libraryId: libraryOfVideo(ref, primaryId, owner),
      videoId: ref.guid,
      topicTitle: row.topicTitle,
      courseTitle: row.courseTitle,
      isTemplate: row.isTemplate,
    })
  }
  return { placements, libraryIdsInDb: [...ids].sort() }
}

export interface FoldedLesson {
  videoId: string
  topicTitle: string
  bunnyTitle: string
  courses: string[]
  placements: number
  onlyInTemplate: boolean
  missingInBunny: boolean
  views: number
  lengthSec: number
  totalWatchSec: number
  avgWatchSec: number
}

/**
 * Склейка мест размещения ОДНОЙ библиотеки с её числами Bunny.
 *
 * Строка = ВИДЕО, а не запись материала (§146): курсы копировались из
 * шаблонов, один ролик стоит в двух-трёх курсах, а Bunny считает его один раз.
 * Шаблоны в перечне курсов не показываем, но ролик ТОЛЬКО в шаблоне получает
 * пометку, а не исчезает молча.
 */
export function foldLessons(placements: Placement[], videos: BunnyVideo[]) {
  const byGuid = new Map(videos.map(v => [v.guid, v] as const))
  const grouped = new Map<string, Placement[]>()
  for (const p of placements) {
    const list = grouped.get(p.videoId)
    if (list) list.push(p)
    else grouped.set(p.videoId, [p])
  }

  const lessons: FoldedLesson[] = [...grouped.entries()].map(([videoId, places]) => {
    const video = byGuid.get(videoId)
    const liveCourses = [...new Set(places.filter(p => !p.isTemplate).map(p => p.courseTitle))]
      .filter(Boolean).sort()
    return {
      videoId,
      topicTitle: places[0]?.topicTitle ?? '',
      bunnyTitle: video?.title ?? '',
      courses: liveCourses,
      placements: places.length,
      onlyInTemplate: liveCourses.length === 0,
      /** Ролика нет в библиотеке. Это НЕ «ноль просмотров»: смотреть нечего. */
      missingInBunny: !video,
      views: video?.views ?? 0,
      lengthSec: video?.length ?? 0,
      totalWatchSec: video?.totalWatchTime ?? 0,
      avgWatchSec: video?.averageWatchTime ?? 0,
    }
  })

  lessons.sort((a, b) => b.views - a.views || a.topicTitle.localeCompare(b.topicTitle))
  const usedGuids = new Set(grouped.keys())
  return {
    lessons,
    unattachedInLibrary: videos.filter(v => !usedGuids.has(v.guid)).length,
  }
}

// ── Кэш ──────────────────────────────────────────────────────────────────

export interface CacheRow {
  payload: unknown
  fetched_at: string
}

export interface StatsCache {
  get(key: string): Promise<CacheRow | null>
  /** Возвращает текст ошибки записи или `null`. */
  put(key: string, payload: unknown, fetchedAt: string): Promise<string | null>
}

interface CachedLibraryEntry {
  snapshot: LibrarySnapshot
  fetched_at: string
}

/**
 * Строка 'library': снимки всех библиотек словарём по номеру (§232).
 * Прежний вид (снимок одной библиотеки без номера) не читается — см.
 * `libraries.ts`, «Ключи кэша».
 */
export interface LibraryCachePayload {
  version: 2
  libraries: Record<string, CachedLibraryEntry>
}

export function readLibraryCache(payload: unknown): Record<string, CachedLibraryEntry> {
  const p = payload as Partial<LibraryCachePayload> | null
  if (!p || typeof p !== 'object' || p.version !== 2 || !p.libraries || typeof p.libraries !== 'object') {
    return {}
  }
  const out: Record<string, CachedLibraryEntry> = {}
  for (const [id, entry] of Object.entries(p.libraries)) {
    if (entry && typeof entry === 'object' && entry.snapshot && typeof entry.fetched_at === 'string') {
      out[id] = entry
    }
  }
  return out
}

/** Решение по одной записи кэша: отдать её или идти в Bunny. */
export function cacheDecision(
  fetchedAt: string | null | undefined,
  now: number,
  ttlMs: number,
  force: boolean,
): { serve: boolean; throttled: boolean } {
  if (!fetchedAt) return { serve: false, throttled: false }
  const at = new Date(fetchedAt).getTime()
  if (!Number.isFinite(at)) return { serve: false, throttled: false }
  const age = now - at
  // «Обновить» чаще раза в минуту не пускаем, но и не отказываем: отдаём то,
  // что есть. Отказ на кнопку выглядел бы поломкой, а это защита лимита.
  const throttled = force && age < FORCE_MIN_INTERVAL_MS
  const fresh = age < ttlMs
  return { serve: throttled || (fresh && !force), throttled }
}

// ── Запрос целиком ───────────────────────────────────────────────────────

export interface StatsDeps {
  env: (name: string) => string | undefined
  fetch: FetchLike
  now: () => number
  cache: StatsCache
  /** Видео-материалы тем, уже склеенные с курсами. Бросает при отказе базы. */
  loadMaterials: () => Promise<MaterialRow[]>
  log: (message: string) => void
}

export interface StatsResult {
  status: number
  body: Record<string, unknown>
}

/** Идентификатор уходит в путь к Bunny и в ключ кэша — только символы guid. */
const VIDEO_ID_RE = /^[A-Za-z0-9-]{1,64}$/

export function handleStatsRequest(rawBody: unknown, deps: StatsDeps): Promise<StatsResult> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as {
    force?: unknown; heatmap?: unknown; library?: unknown
  }
  const force = body.force === true
  const libraries = resolveLibraries(deps.env)

  if (body.heatmap !== undefined && body.heatmap !== null && body.heatmap !== '') {
    if (typeof body.heatmap !== 'string' || !VIDEO_ID_RE.test(body.heatmap)) {
      return Promise.resolve({ status: 400, body: { error: 'bad_request', message: 'Неверный идентификатор видео.' } })
    }
    return heatmapRequest(body.heatmap.toLowerCase(), body.library, force, libraries, deps)
  }
  return snapshotRequest(force, libraries, deps)
}

async function heatmapRequest(
  videoId: string,
  requestedLibrary: unknown,
  force: boolean,
  libraries: BunnyLibrary[],
  deps: StatsDeps,
): Promise<StatsResult> {
  const lib = pickLibrary(libraries, requestedLibrary)
  if (!lib) {
    return { status: 400, body: { error: 'bad_request', message: 'Неизвестная библиотека видео.' } }
  }
  // Отказы Bunny и настройки — телом с кодом 200: клиент показывает
  // `message` словами, а на не-2xx supabase-js отдал бы только «non-2xx».
  if (lib.problem || !lib.apiKey) {
    return {
      status: 200,
      body: { error: lib.problem?.kind ?? 'config', message: lib.problem?.message ?? '', library: lib.id },
    }
  }

  const key = heatmapCacheKey(lib.id, videoId)
  const now = deps.now()
  const cached = await deps.cache.get(key)
  const decision = cacheDecision(cached?.fetched_at, now, HEATMAP_TTL_MS, force)
  if (cached && decision.serve) {
    return {
      status: 200,
      body: {
        ...(cached.payload as object),
        fetched_at: cached.fetched_at,
        source: 'cache',
        throttled: decision.throttled,
      },
    }
  }

  const res = await bunnyGet(deps.fetch, `/library/${lib.id}/videos/${videoId}/heatmap`, {}, lib.apiKey)
  if (!res.ok) {
    const problem = classifyFailure([res], lib)
    deps.log(`bunny-video-stats: тепловая карта ${lib.id}, отказ ${problem.kind}`)
    return { status: 200, body: { error: problem.kind, message: problem.message, library: lib.id } }
  }
  const raw = res.data as { heatmap?: Record<string, unknown> } | null
  const payload = { videoId, library: lib.id, heatmap: raw?.heatmap ?? {} }
  const fetchedAt = new Date(now).toISOString()
  const writeErr = await deps.cache.put(key, payload, fetchedAt)
  if (writeErr) deps.log(`bunny-video-stats: кэш карты не записан: ${writeErr}`)
  return { status: 200, body: { ...payload, fetched_at: fetchedAt, source: 'bunny', cache_written: !writeErr } }
}

interface LibraryOutcome {
  lib: BunnyLibrary
  snapshot: LibrarySnapshot | null
  fetchedAt: string | null
  source: 'cache' | 'bunny' | null
  throttled: boolean
  problem: LibraryProblem | null
  /** Снимок только что получен из Bunny — его надо записать в кэш. */
  fresh: boolean
}

type LibraryBody = Record<string, unknown> & { primary: boolean; status: string }

/** Поля прежнего (до §232) ответа — верхний уровень для основной библиотеки. */
const LEGACY_OK_FIELDS = [
  'lessons', 'unattachedInLibrary', 'libraryTotalItems', 'period', 'partial',
  'fetched_at', 'source', 'throttled',
] as const

async function snapshotRequest(
  force: boolean,
  libraries: BunnyLibrary[],
  deps: StatsDeps,
): Promise<StatsResult> {
  // Связка «видео → тема → курс» НЕ кэшируется (§146): она дешёвая, а
  // переименованная тема не должна висеть старым именем 8 часов.
  let materials: MaterialRow[]
  try {
    materials = await deps.loadMaterials()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'неизвестная ошибка'
    deps.log(`bunny-video-stats: не удалось прочитать материалы: ${message}`)
    return { status: 500, body: { error: 'db', message: `Не удалось прочитать материалы тем: ${message}` } }
  }

  const now = deps.now()
  const nowIso = new Date(now).toISOString()
  const cachedRow = await deps.cache.get(LIBRARY_CACHE_KEY)
  const entries = readLibraryCache(cachedRow?.payload)

  // Библиотеки независимы — параллельно: медленная физика не держит математику.
  const outcomes: LibraryOutcome[] = await Promise.all(libraries.map(async (lib): Promise<LibraryOutcome> => {
    if (lib.problem || !lib.apiKey) {
      return {
        lib, snapshot: null, fetchedAt: null, source: null, throttled: false, fresh: false,
        problem: lib.problem ?? { kind: 'config', message: `Не задана переменная окружения ${lib.keyVar}.` },
      }
    }
    const entry = entries[lib.id]
    const decision = cacheDecision(entry?.fetched_at, now, LIBRARY_TTL_MS, force)
    if (entry && decision.serve) {
      return {
        lib, snapshot: entry.snapshot, fetchedAt: entry.fetched_at, source: 'cache',
        throttled: decision.throttled, problem: null, fresh: false,
      }
    }
    const { snapshot, problem } = await fetchLibrarySnapshot(deps.fetch, { ...lib, apiKey: lib.apiKey }, now)
    if (!snapshot) {
      deps.log(`bunny-video-stats: библиотека ${lib.id}, отказ ${problem?.kind ?? 'upstream'}`)
      return { lib, snapshot: null, fetchedAt: null, source: null, throttled: false, problem, fresh: false }
    }
    return { lib, snapshot, fetchedAt: nowIso, source: 'bunny', throttled: false, problem: null, fresh: true }
  }))

  // Кэш — одной строкой на все библиотеки. Записи других библиотек, которые
  // сейчас не обновлялись (или упали), сохраняются как были.
  let cacheWritten: boolean | null = null
  if (outcomes.some(o => o.fresh)) {
    const merged: Record<string, CachedLibraryEntry> = { ...entries }
    for (const o of outcomes) {
      if (o.fresh && o.snapshot && o.fetchedAt) merged[o.lib.id] = { snapshot: o.snapshot, fetched_at: o.fetchedAt }
    }
    const payload: LibraryCachePayload = { version: 2, libraries: merged }
    const writeErr = await deps.cache.put(LIBRARY_CACHE_KEY, payload, nowIso)
    if (writeErr) {
      // Отдаём свежие данные, но говорим об этом: иначе каждый следующий
      // заход снова пойдёт в Bunny, и никто не поймёт почему.
      deps.log(`bunny-video-stats: кэш не записан: ${writeErr}`)
    }
    cacheWritten = !writeErr
  }

  // Кому принадлежит guid — по всем загруженным снимкам (для адресов без номера).
  const owner = new Map<string, string>()
  for (const o of outcomes) {
    for (const v of o.snapshot?.videos ?? []) if (!owner.has(v.guid)) owner.set(v.guid, o.lib.id)
  }
  const primary = libraries.find(l => l.primary) ?? libraries[0]
  const { placements, libraryIdsInDb } = placementsOf(materials, primary.id, owner)

  const known = new Set(libraries.map(l => l.id))
  const unknown = new Map<string, Set<string>>()
  for (const p of placements) {
    if (known.has(p.libraryId)) continue
    const set = unknown.get(p.libraryId) ?? new Set<string>()
    set.add(p.videoId)
    unknown.set(p.libraryId, set)
  }

  const libraryBodies: LibraryBody[] = outcomes.map((o): LibraryBody => {
    const mine = placements.filter(p => p.libraryId === o.lib.id)
    const attachedVideos = new Set(mine.map(p => p.videoId)).size
    const base = { ...publicLibrary(o.lib), attachedVideos }
    if (!o.snapshot) {
      const problem = o.problem ?? { kind: 'upstream', message: 'Статистика библиотеки недоступна.' }
      return {
        ...base,
        status: problem.kind === 'not_configured' ? 'not_configured' : 'error',
        error: problem.kind,
        message: problem.message,
      }
    }
    const { lessons, unattachedInLibrary } = foldLessons(mine, o.snapshot.videos)
    return {
      ...base,
      status: 'ok',
      lessons,
      unattachedInLibrary,
      libraryTotalItems: o.snapshot.totalItems ?? 0,
      period: o.snapshot.period ?? null,
      partial: o.snapshot.partial ?? false,
      meta: o.snapshot.meta ?? {},
      fetched_at: o.fetchedAt,
      source: o.source,
      throttled: o.throttled,
      ...(o.fresh && cacheWritten !== null ? { cache_written: cacheWritten } : {}),
    }
  })

  const primaryBody = libraryBodies.find(b => b.primary) ?? libraryBodies[0]
  // Верхний уровень — основная библиотека в прежнем виде (клиент до §232).
  const legacy: Record<string, unknown> = {}
  if (primaryBody?.status === 'ok') {
    for (const field of LEGACY_OK_FIELDS) legacy[field] = primaryBody[field]
  } else if (primaryBody) {
    legacy.error = primaryBody.error
    legacy.message = primaryBody.message
  }

  return {
    status: 200,
    body: {
      ...legacy,
      libraries: libraryBodies,
      unknownLibraries: [...unknown.entries()]
        .map(([libraryId, videos]) => ({ libraryId, videos: videos.size }))
        .sort((a, b) => a.libraryId.localeCompare(b.libraryId)),
      meta: { library_ids_in_db: libraryIdsInDb },
      ...(cacheWritten !== null ? { cache_written: cacheWritten } : {}),
    },
  }
}
