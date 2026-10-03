/**
 * Edge Function: student-reminders (§264)
 *
 * Напоминания ученикам в Telegram: «срок ДЗ завтра», «срок ДЗ прошёл», «скоро проверочная», «нет фото в работе»,
 * «серия прервётся», «пробник завтра». Зовёт pg_cron раз в 5 минут (задание `student-reminders`, PENDING_264;
 * секрет — из vault, как у `lesson-reminder-scheduler`).
 *
 * Тонкая обёртка: всё, что решает «кому, когда, сколько, каким текстом», — в `_shared/student-reminders.ts`
 * (чистый модуль, тесты vitest). Здесь только:
 *   1) проверка X-Cron-Secret (fail-closed, как у остальных кронов);
 *   2) один вызов `student_reminder_candidates(now, kinds)` — факты из базы (сроки, окна §240, «сдано» §259,
 *      черновик/фото, серия, настройки курса и ученика, журнал напоминаний за сутки);
 *   3) `planReminders` → вставка в `notification_queue` с `on conflict (deduplication_key) do nothing`.
 * В Telegram НЕ отправляет — это делает `process-notification-queue` (там же текст сообщения).
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { kindsToFetch, normalizeCandidates, normalizeLog, planReminders } from '../_shared/student-reminders.ts'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('student-reminders: CRON_SECRET not configured')
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), { status: 500 })
  }
  const got = req.headers.get('X-Cron-Secret') ?? ''
  if (!safeEqual(got, cronSecret)) {
    console.warn('student-reminders: rejected (bad or missing X-Cron-Secret)')
    return new Response('Unauthorized', { status: 401 })
  }

  const now = new Date()
  const kinds = kindsToFetch(now)
  if (kinds.length === 0) {
    return new Response(JSON.stringify({ ok: true, quiet: true }), { headers: { 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase.rpc('student_reminder_candidates', {
    p_now: now.toISOString(),
    p_kinds: kinds,
  })
  if (error) {
    console.error('student-reminders: candidates error:', error.message)
    return new Response(JSON.stringify({ error: 'candidates failed' }), { status: 500 })
  }

  const raw = (data ?? {}) as Record<string, unknown>
  const plan = planReminders(normalizeCandidates(raw.candidates), normalizeLog(raw.log), now)

  let queued = 0
  let errors = 0
  // Пачками: при 19:00 у школы может набраться несколько сотен строк.
  for (let i = 0; i < plan.queue.length; i += 200) {
    const chunk = plan.queue.slice(i, i + 200)
    const { error: insErr, count } = await supabase
      .from('notification_queue')
      .upsert(chunk, { onConflict: 'deduplication_key', ignoreDuplicates: true, count: 'exact' })
    if (insErr) {
      console.error('student-reminders: insert error:', insErr.message)
      errors++
    } else {
      queued += count ?? chunk.length
    }
  }

  const reasons: Record<string, number> = {}
  for (const s of plan.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1
  const stats = { ok: errors === 0, kinds, planned: plan.queue.length, queued, skipped: reasons, errors }
  console.log('student-reminders:', JSON.stringify(stats))
  return new Response(JSON.stringify(stats), { headers: { 'Content-Type': 'application/json' } })
})
