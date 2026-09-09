// Статистика просмотра видеоуроков (Bunny Stream) для вкладки «Видео»
// в панели админа.
//
// Ключ Bunny в браузер не попадает НИКОГДА: им читается и правится вся
// библиотека. Поэтому запрос идёт сюда, функция проверяет права вызывающего
// его же токеном, а в Bunny ходит своим секретом и отдаёт готовые числа.
// Тот же приём, что у `vercel-analytics` (§135).
//
// ENV: BUNNY_STREAM_API_KEY, BUNNY_STREAM_LIBRARY_ID (по умолчанию 726880),
// CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
//
// Значение ключа не печатается никуда: ни в ответ, ни в лог, ни в текст
// ошибки. Об отсутствующей переменной сообщается ИМЕНЕМ переменной.
//
// verify_jwt = false намеренно: у функции ДВЕ двери, и обе она проверяет сама.
//   1. Админ из браузера — Bearer-токен пользователя, проверка через
//      `is_admin_or_owner()`, то есть тем же правилом, что и вся платформа.
//   2. Сервер-серверу — заголовок `X-Cron-Secret`. Нужен, чтобы снять
//      разведочные ответы Bunny из SQL, не имея на руках ни пользовательского
//      токена, ни ключа Bunny.
// Всё остальное — отказ.
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: сведений о том, КТО смотрел. Ссылки на видео у
// нас без токенов (решение владельца при импорте), для Bunny все зрители
// безымянные. Собственный учёт просмотров — отдельная работа, не эта.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Свежесть снимка библиотеки. Вводная просит 6–12 часов: статистика
 * просмотров меняется медленно, а видео у нас 302 записи на 127 роликов —
 * дёргать Bunny на каждое открытие экрана незачем.
 */
const LIBRARY_TTL_MS = 8 * 60 * 60 * 1000
/** Тепловая карта меняется ещё медленнее и берётся по одной, по клику. */
const HEATMAP_TTL_MS = 12 * 60 * 60 * 1000
/** Чаще раза в минуту «Обновить» не пускаем — иначе кнопка выжигает лимит. */
const FORCE_MIN_INTERVAL_MS = 60 * 1000
/** Предел на один внешний запрос: висящий fetch не должен держать функцию. */
const UPSTREAM_TIMEOUT_MS = 15_000
/** Страховка от бесконечной прокрутки, если Bunny начнёт врать про страницы. */
const MAX_PAGES = 10
/** Больше сотни за раз Bunny не отдаёт — это его предел, не наш. */
const ITEMS_PER_PAGE = 100
/** Окно для «сколько минут отсмотрено за период». */
const PERIOD_DAYS = 30

const BUNNY_BASE = 'https://video.bunnycdn.com'
const DEFAULT_LIBRARY_ID = '726880'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** Начало суток UTC, `daysAgo` назад. `-1` — начало завтрашнего дня. */
function dayStartIso(daysAgo: number): string {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString()
}

interface UpstreamResult {
  ok: boolean
  status: number
  data: unknown
  /** Текст ошибки Bunny. Нашего ключа в нём нет — это ответ их API. */
  message?: string
}

async function bunnyGet(
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
    const res = await fetch(url.toString(), {
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
        : String(parsed).slice(0, 300)
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

/**
 * Отказ Bunny — СЛОВАМИ, а не нулями.
 *
 * Урок §135: экран, показавший «0 просмотров» вместо «ключ отклонён», врёт
 * ровно тем способом, который вводная запрещает.
 */
function classify(failed: UpstreamResult[], libraryId: string): { kind: string; message: string } {
  if (failed.some(r => r.status === 401 || r.status === 403)) {
    return {
      kind: 'bad_key',
      message: 'Bunny отклонил ключ: он недействителен или у него нет доступа к этой библиотеке. Проверьте BUNNY_STREAM_API_KEY в переменных проекта.',
    }
  }
  if (failed.some(r => r.status === 404)) {
    return {
      kind: 'library_not_found',
      message: `Bunny не знает библиотеку ${libraryId}. Проверьте BUNNY_STREAM_LIBRARY_ID.`,
    }
  }
  const first = failed[0]
  return {
    kind: 'upstream',
    message: `Bunny ответил ошибкой (${first?.status || 'нет ответа'}). ${first?.message ?? ''}`.trim(),
  }
}

/** Идентификатор видео из адреса `…/embed/<library>/<guid>`. */
function videoIdFromUrl(url: string): string | null {
  const m = /\/embed\/(\d+)\/([^/?#]+)/.exec(url ?? '')
  return m ? m[2] : null
}

/** Номер библиотеки из того же адреса — нужен, чтобы заметить чужую. */
function libraryIdFromUrl(url: string): string | null {
  const m = /\/embed\/(\d+)\//.exec(url ?? '')
  return m ? m[1] : null
}

interface BunnyVideo {
  guid: string
  title: string
  views: number
  /** Секунды. Проверено разведкой на живых ответах, а не взято из документации. */
  length: number
  totalWatchTime: number
  averageWatchTime: number
}

function toVideo(row: Record<string, unknown>): BunnyVideo | null {
  const guid = String(row.guid ?? '').trim()
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

// ── Снимок библиотеки ────────────────────────────────────────────────────

async function fetchLibrary(key: string, libraryId: string) {
  const attempts: UpstreamResult[] = []
  const videos: BunnyVideo[] = []
  let totalItems = 0
  let pages = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await bunnyGet(`/library/${libraryId}/videos`, {
      page: String(page),
      itemsPerPage: String(ITEMS_PER_PAGE),
    }, key)
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

  const stats = await bunnyGet(`/library/${libraryId}/statistics`, {
    dateFrom: dayStartIso(PERIOD_DAYS - 1),
    // Начало завтрашнего дня: иначе текущие сутки могут отрезаться целиком
    // (урок §135 про округление границ у Vercel — проверяем то же и здесь).
    dateTo: dayStartIso(-1),
  }, key)
  attempts.push(stats)

  const statBody = (stats.ok ? stats.data : null) as {
    viewsChart?: unknown; watchTimeChart?: unknown
  } | null

  const period = {
    days: PERIOD_DAYS,
    since: dayStartIso(PERIOD_DAYS - 1),
    until: dayStartIso(-1),
    views: chartTotal(statBody?.viewsChart),
    /** Единица берётся из разведки; поле названо явно, чтобы не гадать. */
    watchTimeRaw: chartTotal(statBody?.watchTimeChart),
    points: chartPoints(statBody?.viewsChart).length,
    viewsChart: chartPoints(statBody?.viewsChart),
    watchTimeChart: chartPoints(statBody?.watchTimeChart),
    ok: stats.ok,
  }

  return { videos, totalItems, pages, period, attempts }
}

// ── Наши материалы: видео → тема → курс ──────────────────────────────────
//
// Четырьмя плоскими запросами, а не вложенным embed PostgREST. Причина
// приземлённая: имена связей в embed — отдельный источник отказов, а строк
// здесь 302 / 302 / ~10 / 5, и склейка в памяти дешевле, чем разбирательство
// с тем, как PostgREST назвал внешний ключ.

interface Placement {
  videoId: string
  topicTitle: string
  courseTitle: string
  isTemplate: boolean
}

async function fetchPlacements(admin: ReturnType<typeof createClient>) {
  const { data: items, error: itemsErr } = await admin
    .from('topic_material_items')
    .select('topic_id, url')
    .eq('kind', 'video')
  if (itemsErr) throw new Error(`материалы: ${itemsErr.message}`)

  const rows = (items ?? []) as Array<{ topic_id: string; url: string | null }>
  const topicIds = [...new Set(rows.map(r => r.topic_id).filter(Boolean))]
  if (topicIds.length === 0) return { placements: [] as Placement[], libraryIdsInDb: [] as string[] }

  const { data: topics, error: topicsErr } = await admin
    .from('topics').select('id, title, module_id').in('id', topicIds)
  if (topicsErr) throw new Error(`темы: ${topicsErr.message}`)
  const topicById = new Map(
    ((topics ?? []) as Array<{ id: string; title: string; module_id: string }>)
      .map(t => [t.id, t] as const),
  )

  const moduleIds = [...new Set([...topicById.values()].map(t => t.module_id).filter(Boolean))]
  const { data: modules, error: modulesErr } = await admin
    .from('modules').select('id, course_id').in('id', moduleIds)
  if (modulesErr) throw new Error(`модули: ${modulesErr.message}`)
  const moduleById = new Map(
    ((modules ?? []) as Array<{ id: string; course_id: string }>).map(m => [m.id, m] as const),
  )

  const courseIds = [...new Set([...moduleById.values()].map(m => m.course_id).filter(Boolean))]
  const { data: courses, error: coursesErr } = await admin
    .from('courses').select('id, title, is_template').in('id', courseIds)
  if (coursesErr) throw new Error(`курсы: ${coursesErr.message}`)
  const courseById = new Map(
    ((courses ?? []) as Array<{ id: string; title: string; is_template: boolean }>)
      .map(c => [c.id, c] as const),
  )

  const placements: Placement[] = []
  const libraryIdsInDb = new Set<string>()
  for (const row of rows) {
    const videoId = videoIdFromUrl(row.url ?? '')
    const lib = libraryIdFromUrl(row.url ?? '')
    if (lib) libraryIdsInDb.add(lib)
    if (!videoId) continue
    const topic = topicById.get(row.topic_id)
    if (!topic) continue
    const mod = moduleById.get(topic.module_id)
    const course = mod ? courseById.get(mod.course_id) : undefined
    placements.push({
      videoId,
      topicTitle: topic.title ?? '',
      courseTitle: course?.title ?? '',
      isTemplate: Boolean(course?.is_template),
    })
  }
  return { placements, libraryIdsInDb: [...libraryIdsInDb] }
}

/**
 * Склейка мест размещения с числами Bunny.
 *
 * Главное решение работы: строка = ВИДЕО, а не запись материала. На проде
 * 302 записи ссылаются на 127 роликов — курсы копировались из шаблонов, и
 * один и тот же урок стоит в двух-трёх курсах. Bunny считает просмотры по
 * идентификатору видео, то есть один раз; строка на каждую запись показала
 * бы одни и те же просмотры трижды, а «всего минут» раздулось бы в 2,4 раза.
 *
 * Шаблоны в перечне курсов не показываем — там никто не учится. Но если
 * ролик стоит ТОЛЬКО в шаблоне, он получает пометку, а не исчезает молча.
 */
function foldLessons(placements: Placement[], videos: BunnyVideo[]) {
  const byGuid = new Map(videos.map(v => [v.guid, v] as const))
  const grouped = new Map<string, Placement[]>()
  for (const p of placements) {
    const list = grouped.get(p.videoId)
    if (list) list.push(p)
    else grouped.set(p.videoId, [p])
  }

  const lessons = [...grouped.entries()].map(([videoId, places]) => {
    const video = byGuid.get(videoId)
    const liveCourses = [...new Set(places.filter(p => !p.isTemplate).map(p => p.courseTitle))]
      .filter(Boolean).sort()
    return {
      videoId,
      /** Название темы: у копий одного ролика оно совпадает (сверено на проде). */
      topicTitle: places[0]?.topicTitle ?? '',
      bunnyTitle: video?.title ?? '',
      courses: liveCourses,
      placements: places.length,
      onlyInTemplate: liveCourses.length === 0,
      /**
       * Ролика нет в библиотеке (удалён). Это НЕ «ноль просмотров»: ноль
       * читался бы как «никто не смотрел», а тут смотреть уже нечего.
       */
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
    /** Ролики библиотеки, не привязанные ни к одной теме, — сигнал не хуже пустых уроков. */
    unattachedInLibrary: videos.filter(v => !usedGuids.has(v.guid)).length,
  }
}

// ── Точка входа ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''

  // ── Дверь 2: сервер-серверу ────────────────────────────────────────────
  const cronSecret = Deno.env.get('CRON_SECRET')
  const givenSecret = req.headers.get('X-Cron-Secret')
  const viaCron = Boolean(cronSecret && givenSecret && givenSecret === cronSecret)

  // ── Дверь 1: админ из браузера ─────────────────────────────────────────
  if (!viaCron) {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'unauthorized', message: 'Нужен вход в систему.' }, 401)
    }
    const asUser = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: isAdmin, error: rpcErr } = await asUser.rpc('is_admin_or_owner')
    if (rpcErr) {
      return json({ error: 'unauthorized', message: 'Не удалось проверить права.' }, 401)
    }
    if (isAdmin !== true) {
      // Это данные обо всей библиотеке, а не об одном курсе: преподавателю и
      // куратору они не показываются вовсе.
      return json({
        error: 'forbidden',
        message: 'Статистику просмотра видео видит только администратор.',
      }, 403)
    }
  }

  const admin = createClient(url, serviceKey)

  let body: { force?: boolean; heatmap?: string } = {}
  try { body = await req.json() } catch { /* пустое тело — обычный запрос */ }
  const force = body.force === true
  // Идентификатор уходит в путь запроса и в ключ кэша — пускаем только те
  // символы, из которых состоит guid Bunny.
  const heatmapId = typeof body.heatmap === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(body.heatmap)
    ? body.heatmap
    : null
  if (body.heatmap && !heatmapId) {
    return json({ error: 'bad_request', message: 'Неверный идентификатор видео.' }, 400)
  }

  const apiKey = Deno.env.get('BUNNY_STREAM_API_KEY') ?? ''
  const libraryId = Deno.env.get('BUNNY_STREAM_LIBRARY_ID') ?? DEFAULT_LIBRARY_ID
  if (!apiKey) {
    // Имя переменной — не секрет. Значение не печатается нигде.
    console.error('bunny-video-stats: не задана переменная BUNNY_STREAM_API_KEY')
    return json({
      error: 'config',
      message: 'Не задана переменная окружения BUNNY_STREAM_API_KEY.',
      missing: ['BUNNY_STREAM_API_KEY'],
    }, 500)
  }

  const cacheKey = heatmapId ? `heatmap:${heatmapId}` : 'library'
  const ttl = heatmapId ? HEATMAP_TTL_MS : LIBRARY_TTL_MS

  const { data: cached } = await admin
    .from('bunny_video_stats_cache')
    .select('payload, fetched_at')
    .eq('cache_key', cacheKey)
    .maybeSingle()

  const cachedAt = cached?.fetched_at ? new Date(cached.fetched_at as string).getTime() : 0
  const age = Date.now() - cachedAt
  const fresh = Boolean(cached) && age < ttl
  // «Обновить» чаще раза в минуту не пускаем, но и не отказываем: отдаём то,
  // что есть. Отказ на кнопку выглядел бы поломкой, а это защита лимита.
  const throttled = Boolean(cached) && force && age < FORCE_MIN_INTERVAL_MS
  /** Отдать кэш: он свежий и обновления не просили, либо просили слишком часто. */
  const serveCached = Boolean(cached) && (throttled || (fresh && !force))

  // ── Тепловая карта одного ролика ───────────────────────────────────────
  if (heatmapId) {
    if (serveCached) {
      return json({
        ...(cached!.payload as object),
        fetched_at: cached!.fetched_at,
        source: 'cache',
        throttled,
      })
    }
    const res = await bunnyGet(`/library/${libraryId}/videos/${heatmapId}/heatmap`, {}, apiKey)
    if (!res.ok) {
      const problem = classify([res], libraryId)
      console.error(`bunny-video-stats: тепловая карта, отказ ${problem.kind}`)
      return json({ error: problem.kind, message: problem.message }, 502)
    }
    const raw = res.data as { heatmap?: Record<string, unknown> } | null
    const payload = { videoId: heatmapId, heatmap: raw?.heatmap ?? {} }
    const fetchedAt = new Date().toISOString()
    const { error: upsertErr } = await admin
      .from('bunny_video_stats_cache')
      .upsert({ cache_key: cacheKey, payload, fetched_at: fetchedAt }, { onConflict: 'cache_key' })
    if (upsertErr) console.error(`bunny-video-stats: кэш карты не записан: ${upsertErr.message}`)
    return json({ ...payload, fetched_at: fetchedAt, source: 'bunny', cache_written: !upsertErr })
  }

  // ── Снимок библиотеки ──────────────────────────────────────────────────
  //
  // Связка «видео → тема → курс» НЕ кэшируется: она дешёвая и берётся из
  // своих таблиц на каждый запрос. Иначе переименованная тема висела бы
  // старым именем до конца срока кэша.
  let placements: Placement[] = []
  let libraryIdsInDb: string[] = []
  try {
    const found = await fetchPlacements(admin)
    placements = found.placements
    libraryIdsInDb = found.libraryIdsInDb
  } catch (err) {
    const message = err instanceof Error ? err.message : 'неизвестная ошибка'
    console.error(`bunny-video-stats: не удалось прочитать материалы: ${message}`)
    return json({ error: 'db', message: `Не удалось прочитать материалы тем: ${message}` }, 500)
  }

  function respond(
    snapshot: Record<string, unknown>,
    fetchedAt: string,
    source: string,
    extra: Record<string, unknown> = {},
  ) {
    const videos = (snapshot.videos ?? []) as BunnyVideo[]
    const { lessons, unattachedInLibrary } = foldLessons(placements, videos)
    return json({
      lessons,
      unattachedInLibrary,
      libraryTotalItems: snapshot.totalItems ?? 0,
      period: snapshot.period ?? null,
      partial: snapshot.partial ?? false,
      meta: { ...(snapshot.meta as object ?? {}), library_ids_in_db: libraryIdsInDb },
      fetched_at: fetchedAt,
      source,
      ...extra,
    })
  }

  if (serveCached) {
    return respond(
      cached!.payload as Record<string, unknown>,
      cached!.fetched_at as string,
      'cache',
      { throttled },
    )
  }

  const { videos, totalItems, pages, period, attempts } = await fetchLibrary(apiKey, libraryId)

  // Если ВСЁ упало — это не «ноль просмотров», а отказ. Так и говорим.
  if (attempts.every(r => !r.ok)) {
    const problem = classify(attempts, libraryId)
    console.error(`bunny-video-stats: отказ ${problem.kind}`)
    return json({ error: problem.kind, message: problem.message }, 502)
  }

  const snapshot = {
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
      /**
       * Один сырой ролик — чтобы единицы (`length`, `totalWatchTime`,
       * `averageWatchTime`) читались фактом, а не из документации.
       */
      raw_sample: videos[0] ?? null,
    },
  }

  const fetchedAt = new Date().toISOString()
  const { error: upsertErr } = await admin
    .from('bunny_video_stats_cache')
    .upsert({ cache_key: 'library', payload: snapshot, fetched_at: fetchedAt }, { onConflict: 'cache_key' })
  if (upsertErr) {
    // Кэш не записался — отдаём свежие данные, но говорим об этом: иначе
    // каждый следующий заход снова пойдёт в Bunny, и никто не поймёт почему.
    console.error(`bunny-video-stats: кэш не записан: ${upsertErr.message}`)
  }

  return respond(snapshot, fetchedAt, 'bunny', { cache_written: !upsertErr })
})
