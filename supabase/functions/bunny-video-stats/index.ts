// Статистика просмотра видеоуроков (Bunny Stream) для вкладки «Видео»
// в панели админа.
//
// Ключ Bunny в браузер не попадает НИКОГДА: им читается и правится вся
// библиотека. Поэтому запрос идёт сюда, функция проверяет права вызывающего
// его же токеном, а в Bunny ходит своим секретом и отдаёт готовые числа.
// Тот же приём, что у `vercel-analytics` (§135).
//
// ENV: BUNNY_STREAM_API_KEY, BUNNY_STREAM_LIBRARY_ID (по умолчанию 726880) —
// основная библиотека (математика); BUNNY_PHYSICS_API_KEY,
// BUNNY_PHYSICS_LIBRARY_ID (по умолчанию 763334) — физика (§232), без ключа
// функция работает как раньше, а физика помечена «ключ не задан»;
// CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
//
// Здесь только двери, клиенты базы и выборки материалов. Походы в Bunny,
// кэш, склейка и выбор библиотек — в `core.ts` и `libraries.ts`: они чистые
// и покрыты vitest (`src/lib/__tests__/bunnyStatsCore.test.ts`).
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

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { handleStatsRequest, joinMaterials, type MaterialRow, type StatsCache } from './core.ts'

/**
 * Клиент без сгенерированной схемы. `ReturnType<typeof createClient>` здесь не
 * годится: он выводится с пустой схемой, и `deno check` отвергает и `.from()`,
 * и передачу клиента в функцию.
 */
// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ── Наши материалы: видео → тема → курс ──────────────────────────────────
//
// Четырьмя плоскими запросами, а не вложенным embed PostgREST (§146). Склейка
// в памяти — `joinMaterials` в core.ts.

async function loadMaterials(admin: Admin): Promise<MaterialRow[]> {
  const { data: items, error: itemsErr } = await admin
    .from('topic_material_items')
    .select('topic_id, url')
    .eq('kind', 'video')
  if (itemsErr) throw new Error(`материалы: ${itemsErr.message}`)

  const rows = (items ?? []) as Array<{ topic_id: string; url: string | null }>
  const topicIds = [...new Set(rows.map(r => r.topic_id).filter(Boolean))]
  if (topicIds.length === 0) return []

  const { data: topics, error: topicsErr } = await admin
    .from('topics').select('id, title, module_id').in('id', topicIds)
  if (topicsErr) throw new Error(`темы: ${topicsErr.message}`)
  const topicRows = (topics ?? []) as Array<{ id: string; title: string | null; module_id: string }>

  const moduleIds = [...new Set(topicRows.map(t => t.module_id).filter(Boolean))]
  const { data: modules, error: modulesErr } = await admin
    .from('modules').select('id, course_id').in('id', moduleIds)
  if (modulesErr) throw new Error(`модули: ${modulesErr.message}`)
  const moduleRows = (modules ?? []) as Array<{ id: string; course_id: string }>

  const courseIds = [...new Set(moduleRows.map(m => m.course_id).filter(Boolean))]
  const { data: courses, error: coursesErr } = await admin
    .from('courses').select('id, title, is_template').in('id', courseIds)
  if (coursesErr) throw new Error(`курсы: ${coursesErr.message}`)
  const courseRows = (courses ?? []) as Array<{ id: string; title: string | null; is_template: boolean | null }>

  return joinMaterials(rows, topicRows, moduleRows, courseRows)
}

function cacheOf(admin: Admin): StatsCache {
  return {
    async get(key) {
      const { data } = await admin
        .from('bunny_video_stats_cache')
        .select('payload, fetched_at')
        .eq('cache_key', key)
        .maybeSingle()
      const row = data as { payload: unknown; fetched_at: string } | null
      return row ? { payload: row.payload, fetched_at: String(row.fetched_at) } : null
    },
    async put(key, payload, fetchedAt) {
      const { error } = await admin
        .from('bunny_video_stats_cache')
        .upsert({ cache_key: key, payload, fetched_at: fetchedAt }, { onConflict: 'cache_key' })
      return error ? error.message : null
    },
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

  const admin: Admin = createClient(url, serviceKey)

  let body: unknown = {}
  try { body = await req.json() } catch { /* пустое тело — обычный запрос */ }

  // Ключи Bunny читаются из окружения внутри core.ts и уходят только в
  // заголовок запроса к Bunny; в ответ и в лог попадают лишь имена переменных.
  const result = await handleStatsRequest(body, {
    env: name => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    cache: cacheOf(admin),
    loadMaterials: () => loadMaterials(admin),
    log: message => console.error(message),
  })
  return json(result.body, result.status)
})
