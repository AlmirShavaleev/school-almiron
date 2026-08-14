// Данные Vercel Web Analytics для вкладки «Сайт» в панели админа.
//
// Токен Vercel в браузер не попадает НИКОГДА: им читается всё по аккаунту
// владельца. Поэтому запрос идёт сюда, функция проверяет права вызывающего
// его же токеном, а в Vercel ходит своим секретом и отдаёт готовые числа.
//
// ENV: VERCEL_ANALYTICS_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID (только для
// командного проекта), CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY.
//
// Значение секрета не печатается никуда: ни в ответ, ни в лог, ни в текст
// ошибки. Об отсутствующей переменной сообщается ИМЕНЕМ переменной.
//
// verify_jwt = false намеренно: у функции ДВЕ двери, и обе она проверяет сама.
//   1. Админ из браузера — Bearer-токен пользователя, проверка через
//      `is_admin_or_owner()`, то есть тем же правилом, что и вся платформа.
//   2. Сервер-серверу — заголовок `X-Cron-Secret` (тот же приём, что у
//      `process-notification-queue`). Нужен, чтобы снять разведочные ответы
//      из SQL, не имея на руках ни пользовательского токена, ни токена Vercel.
// Всё остальное — отказ.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Свежесть кэша: данные Vercel меняются медленно, а лимиты — нет. */
const CACHE_TTL_MS = 15 * 60 * 1000
/** Чаще раза в минуту «Обновить» не пускаем — иначе кнопка выжигает лимит. */
const FORCE_MIN_INTERVAL_MS = 60 * 1000
/** Предел на один внешний запрос: висящий fetch не должен держать функцию. */
const UPSTREAM_TIMEOUT_MS = 10_000

const VERCEL_BASE = 'https://api.vercel.com/v1/query/web-analytics'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/**
 * Границы диапазона выравниваются по СУТКАМ, и `until` — это начало
 * ЗАВТРАШНЕГО дня.
 *
 * Разведка 14.08 показала, почему: `visits/count` округляет `until` ВНИЗ до
 * начала суток, а `visits/aggregate` — вверх. При `until = сейчас` счётчик
 * отрезал текущий день целиком и отдавал 0 просмотров, тогда как разбивка по
 * дням за те же сутки показывала 7. Экран показал бы «никто не заходил» при
 * живом трафике — то есть соврал бы нулём.
 */
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
  /** Текст ошибки Vercel. Наших секретов в нём нет — это ответ их API. */
  message?: string
}

async function vercelGet(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<UpstreamResult> {
  const url = new URL(`${VERCEL_BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== '') url.searchParams.set(k, v)
  }

  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: control.signal,
    })
    const text = await res.text()
    let parsed: unknown = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }

    if (!res.ok) {
      const message = typeof parsed === 'object' && parsed !== null
        ? String((parsed as { error?: { message?: string } }).error?.message ?? '').slice(0, 300)
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
      message: aborted ? `Vercel не ответил за ${UPSTREAM_TIMEOUT_MS / 1000} с` : 'Сеть недоступна',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Свод путей в разделы по первому сегменту.
 *
 * Группировать по `route` нельзя: разведка 14.08 показала, что Vercel отдаёт
 * одну строку с пустым `route` — шаблоны маршрутов он знает только для
 * Next.js, а у нас Vite + React Router. Поэтому берём `requestPath` и
 * сворачиваем сами, иначе в отчёт попали бы сотни строк вида
 * `/my-course/<id>/topic/<id>`.
 *
 * Складываем ТОЛЬКО просмотры: посетители по разделам не суммируются — один
 * человек, открывший две страницы, попал бы в отчёт дважды.
 */
function foldByFirstSegment(rows: unknown[], limit = 10): Array<{ section: string; pageviews: number }> {
  const totals = new Map<string, number>()
  for (const raw of rows) {
    const row = raw as { requestPath?: string; pageviews?: number }
    const path = String(row?.requestPath ?? '')
    const first = path.split('/').filter(Boolean)[0]
    const section = first ? `/${first}` : '/'
    totals.set(section, (totals.get(section) ?? 0) + Number(row?.pageviews ?? 0))
  }
  return [...totals.entries()]
    .map(([section, pageviews]) => ({ section, pageviews }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, limit)
}

/**
 * Классификация отказа. «Аналитика не включена» и «токен не подошёл» — разные
 * беды с разными действиями владельца, и обе не равны «нулю посещений».
 */
function classify(results: UpstreamResult[]): { kind: string; message: string } | null {
  const failed = results.filter(r => !r.ok)
  if (failed.length === 0) return null

  if (failed.some(r => r.status === 401 || r.status === 403)) {
    return {
      kind: 'unauthorized',
      message: 'Vercel отклонил токен: он недействителен или у него нет доступа к этому проекту.',
    }
  }
  if (failed.some(r => r.status === 404)) {
    return {
      kind: 'analytics_disabled',
      message: 'Web Analytics не включён в проекте Vercel. Включается в панели Vercel, вкладка Analytics.',
    }
  }
  const first = failed[0]
  return {
    kind: 'upstream',
    message: `Vercel ответил ошибкой (${first.status || 'нет ответа'}). ${first.message ?? ''}`.trim(),
  }
}

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
      // Это данные обо всём сайте, а не об учебном процессе: преподавателю и
      // куратору они не показываются вовсе.
      return json({
        error: 'forbidden',
        message: 'Статистику сайта видит только администратор.',
      }, 403)
    }
  }

  const admin = createClient(url, serviceKey)

  let body: { force?: boolean } = {}
  try { body = await req.json() } catch { /* пустое тело — обычный запрос */ }
  const force = body.force === true

  // ── Кэш ────────────────────────────────────────────────────────────────
  const { data: cached } = await admin
    .from('vercel_analytics_cache')
    .select('payload, fetched_at')
    .eq('id', 1)
    .maybeSingle()

  const cachedAt = cached?.fetched_at ? new Date(cached.fetched_at).getTime() : 0
  const age = Date.now() - cachedAt

  if (cached && !force && age < CACHE_TTL_MS) {
    return json({ ...(cached.payload as object), fetched_at: cached.fetched_at, source: 'cache' })
  }
  // «Обновить» чаще раза в минуту не пускаем, но и не отказываем: отдаём то,
  // что есть. Отказ на кнопку выглядел бы поломкой, а это защита лимита.
  if (cached && force && age < FORCE_MIN_INTERVAL_MS) {
    return json({
      ...(cached.payload as object),
      fetched_at: cached.fetched_at,
      source: 'cache',
      throttled: true,
    })
  }

  // ── Переменные ─────────────────────────────────────────────────────────
  const token = Deno.env.get('VERCEL_ANALYTICS_TOKEN') ?? ''
  const projectId = Deno.env.get('VERCEL_PROJECT_ID') ?? ''
  const teamId = Deno.env.get('VERCEL_TEAM_ID') ?? ''

  const missing: string[] = []
  if (!token) missing.push('VERCEL_ANALYTICS_TOKEN')
  if (!projectId) missing.push('VERCEL_PROJECT_ID')
  if (missing.length > 0) {
    // Имя переменной — не секрет. Значение не печатается нигде.
    console.error(`vercel-analytics: не заданы переменные: ${missing.join(', ')}`)
    return json({
      error: 'config',
      message: `Не заданы переменные окружения: ${missing.join(', ')}.`,
      missing,
    }, 500)
  }

  const common: Record<string, string> = { projectId, ...(teamId ? { teamId } : {}) }
  // Завтрашняя полночь: только так текущий день попадает и в счётчики тоже.
  const until = dayStartIso(-1)
  const since7 = dayStartIso(6)
  const since30 = dayStartIso(29)

  const [
    count7, count30, byDay, byPath, byReferrer, byDevice, byCountry,
  ] = await Promise.all([
    vercelGet('visits/count',     { ...common, since: since7,  until }, token),
    vercelGet('visits/count',     { ...common, since: since30, until }, token),
    vercelGet('visits/aggregate', { ...common, since: since30, until, by: 'day' }, token),
    // requestPath, а не route: route у нас всегда пустой (см. foldByFirstSegment).
    // Берём с запасом и сворачиваем сами.
    vercelGet('visits/aggregate', { ...common, since: since30, until, by: 'requestPath', limit: '100' }, token),
    vercelGet('visits/aggregate', { ...common, since: since30, until, by: 'referrerHostname', limit: '10' }, token),
    vercelGet('visits/aggregate', { ...common, since: since30, until, by: 'deviceType', limit: '10' }, token),
    vercelGet('visits/aggregate', { ...common, since: since30, until, by: 'country', limit: '10' }, token),
  ])

  const all = [count7, count30, byDay, byPath, byReferrer, byDevice, byCountry]

  // Если ВСЁ упало — это не «ноль посещений», а отказ. Так и говорим.
  if (all.every(r => !r.ok)) {
    const problem = classify(all)!
    console.error(`vercel-analytics: отказ ${problem.kind}`)
    return json({ error: problem.kind, message: problem.message }, 502)
  }

  /**
   * Разведка (три вопроса вводной) — из фактических ответов, а не из
   * предположений: сколько дней реально вернулось, сколько путей пришло и во
   * что они свернулись, что ответил API на каждый запрос.
   *
   * Сырые пути (`byPath.data`) в payload НЕ кладутся: в них конкретные адреса
   * с идентификаторами групп и тем, а в кэше должны лежать только агрегаты.
   * Наружу идут уже свёрнутые разделы.
   */
  const dayRows = (byDay.ok ? byDay.data : null) as { data?: unknown[] } | unknown[] | null
  const dayList = Array.isArray(dayRows) ? dayRows : (dayRows?.data ?? [])
  const pathRows = (byPath.ok ? byPath.data : null) as { data?: unknown[] } | unknown[] | null
  const pathList = Array.isArray(pathRows) ? pathRows : (pathRows?.data ?? [])
  const sections = foldByFirstSegment(Array.isArray(pathList) ? pathList : [])

  const meta = {
    requested_days: 30,
    days_returned: Array.isArray(dayList) ? dayList.length : 0,
    path_rows: Array.isArray(pathList) ? pathList.length : 0,
    sections_folded: sections.length,
    /** Пути свёрнуты по первому сегменту: `route` у нас всегда пустой. */
    grouped_by: 'requestPath→section',
    statuses: {
      count7: count7.status, count30: count30.status, byDay: byDay.status,
      byPath: byPath.status, byReferrer: byReferrer.status,
      byDevice: byDevice.status, byCountry: byCountry.status,
    },
    errors: all.filter(r => !r.ok).map(r => ({ status: r.status, message: r.message ?? '' })),
    team_scoped: Boolean(teamId),
  }

  const payload = {
    count7: count7.ok ? count7.data : null,
    count30: count30.ok ? count30.data : null,
    byDay: byDay.ok ? byDay.data : null,
    sections,
    byReferrer: byReferrer.ok ? byReferrer.data : null,
    byDevice: byDevice.ok ? byDevice.data : null,
    byCountry: byCountry.ok ? byCountry.data : null,
    partial: all.some(r => !r.ok),
    meta,
  }

  const fetchedAt = new Date().toISOString()
  const { error: upsertErr } = await admin
    .from('vercel_analytics_cache')
    .upsert({ id: 1, payload, fetched_at: fetchedAt }, { onConflict: 'id' })
  if (upsertErr) {
    // Кэш не записался — отдаём свежие данные, но говорим об этом: иначе
    // каждый следующий заход снова пойдёт в Vercel, и никто не поймёт почему.
    console.error(`vercel-analytics: кэш не записан: ${upsertErr.message}`)
  }

  return json({ ...payload, fetched_at: fetchedAt, source: 'vercel', cache_written: !upsertErr })
})
