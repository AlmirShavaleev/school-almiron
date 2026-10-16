/**
 * Edge Function: forecast-daily (письмо ЛК_прогноз_балла_хранить.md, 16.10)
 *
 * Раз в день (pg_cron `forecast-daily`, 04:10 МСК, PENDING_score_forecast.sql) считает «Примерный балл ЕГЭ»
 * каждого ученика и кладёт в `student_score_forecast`; сайт потом только читает (`my_score_forecast` и др.).
 *
 * Тонкая обёртка — расчёт целиком в `_shared/scoreForecast.ts`, ТОМ ЖЕ модуле, которым считает браузер
 * (src/lib/egeForecast.ts реэкспортирует его). Здесь только:
 *   1) проверка X-Cron-Secret (fail-closed, как у остальных кронов);
 *   2) пачками по BATCH: `score_forecast_batch(after, limit, profile)` — ученики и их свидетельства
 *      (`student_forecast_evidence_of`, тот же ответ, что видит браузер);
 *   3) `storedForecastsFromEvidence` по каждому ученику (ошибка ученика — в лог, прогон идёт дальше);
 *   4) `score_forecast_store(rows, profiles)` — upsert и снятие ушедших предметов.
 * Бюджет: Edge Runtime даёт ~2 с CPU на запрос — после MAX_STUDENTS учеников или WALL_BUDGET_MS функция
 * передаёт курсор следующему своему вызову (тот же секрет) и отвечает.
 *
 * Тело запроса (необязательно): { "profile_id": "<uuid>" } — пересчитать одного ученика;
 * { "after": "<uuid>" } — продолжить с курсора (так зовёт сама себя).
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { storedForecastsFromEvidence } from '../_shared/scoreForecast.ts'

const BATCH = 40
const MAX_STUDENTS = 400
const WALL_BUDGET_MS = 40_000

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('forecast-daily: CRON_SECRET not configured')
    return json({ error: 'CRON_SECRET not configured' }, 500)
  }
  const got = req.headers.get('X-Cron-Secret') ?? ''
  if (!safeEqual(got, cronSecret)) {
    console.warn('forecast-daily: rejected (bad or missing X-Cron-Secret)')
    return new Response('Unauthorized', { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try { body = req.method === 'POST' ? await req.json() : {} } catch { body = {} }
  const one = typeof body.profile_id === 'string' && UUID.test(body.profile_id) ? body.profile_id : null
  let after = !one && typeof body.after === 'string' && UUID.test(body.after) ? body.after : null

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const started = Date.now()
  let students = 0, stored = 0, failed = 0
  let done = false

  while (Date.now() - started < WALL_BUDGET_MS && students < MAX_STUDENTS) {
    const { data, error } = await supabase.rpc('score_forecast_batch', { p_after: after, p_limit: BATCH, p_profile_id: one })
    if (error) {
      console.error('forecast-daily: score_forecast_batch', error.message)
      return json({ error: 'batch failed', students, stored, failed }, 500)
    }
    const batch = Array.isArray(data) ? data as Array<{ profile_id: string; evidence: unknown }> : []
    if (batch.length === 0) { done = true; break }

    const rows: Array<Record<string, unknown>> = []
    const profiles: string[] = []
    for (const item of batch) {
      try {
        const computedAt = new Date().toISOString()
        for (const r of storedForecastsFromEvidence(item.evidence)) {
          rows.push({ profile_id: item.profile_id, ...r, computed_at: computedAt })
        }
        profiles.push(item.profile_id)
      } catch (e) {
        // Ошибка одного ученика не валит прогон; его старая строка остаётся.
        failed++
        console.error('forecast-daily: student', item.profile_id, e instanceof Error ? e.message : String(e))
      }
    }
    const { data: n, error: storeError } = await supabase.rpc('score_forecast_store', { p_rows: rows, p_profiles: profiles })
    if (storeError) {
      console.error('forecast-daily: score_forecast_store', storeError.message)
      return json({ error: 'store failed', students, stored, failed }, 500)
    }
    stored += typeof n === 'number' ? n : 0
    students += batch.length
    after = batch[batch.length - 1].profile_id
    if (one || batch.length < BATCH) { done = true; break }
  }

  // Не успели — продолжение тем же секретом с курсора (не ждём ответа: у нас свой бюджет).
  if (!done && after) {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/forecast-daily`
    const next = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cron-Secret': cronSecret },
      body: JSON.stringify({ after }),
    }).catch(e => console.error('forecast-daily: continue', e instanceof Error ? e.message : String(e)))
    // EdgeRuntime.waitUntil держит запрос продолжения живым после ответа.
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
    if (rt?.waitUntil) rt.waitUntil(next)
    else await next
  }

  console.log(`forecast-daily: students=${students} stored=${stored} failed=${failed} done=${done} ms=${Date.now() - started}`)
  return json({ ok: true, students, stored, failed, done, next: done ? null : after })
})
