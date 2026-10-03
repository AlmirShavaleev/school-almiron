// §264. Тики крона на локальной базе: то же, что делает edge-функция student-reminders, — kindsToFetch →
// student_reminder_candidates (под service_role) → planReminders → строки в notification_queue (здесь сразу
// статусом 'sent': будто очередь их отправила). Модуль — настоящий supabase/functions/_shared/student-reminders.ts
// (Node 22 снимает типы сам). Печатает по каждому тику: какие виды спрошены, что поставлено (кому, что, когда по
// Москве, текст и кнопка) и почему остальное пропущено. День D = 05.10.2026 (см. 10_data_264.sql).
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const mod = await import(path.join(here, '../../functions/_shared/student-reminders.ts'))
const { kindsToFetch, normalizeCandidates, normalizeLog, planReminders, buildStudentReminderTelegramMessage } = mod

const psql = (sql) => execFileSync('psql', ['-h', process.env.PGHOST, '-p', process.env.PGPORT, '-U', 'postgres', '-At', '-q',
  '-v', 'ON_ERROR_STOP=1', 'probe264', '-c', sql], { encoding: 'utf8' }).trim()
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

const names = Object.fromEntries(psql(`select id || '|' || full_name from profiles where id::text like '00000000-0000-4000-8264-%'`)
  .split('\n').filter(Boolean).map(l => l.split('|')))
const msk = (iso) => new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(5, 16).replace('T', ' ')

function tick(label, nowIso, { showText = false } = {}) {
  const now = new Date(nowIso)
  const kinds = kindsToFetch(now)
  console.log(`\n── ${label} (${msk(nowIso)} МСК) · виды: ${kinds.length ? kinds.join(', ') : '— (тишина, база не спрашивается)'}`)
  if (!kinds.length) return
  const raw = JSON.parse(psql(`set role service_role; select public.student_reminder_candidates(${lit(nowIso)}, array[${kinds.map(lit).join(',')}])::text`))
  const plan = planReminders(normalizeCandidates(raw.candidates), normalizeLog(raw.log), now)
  for (const q of plan.queue) {
    console.log(`  + ${names[q.profile_id] ?? q.profile_id}: ${q.payload.kind} «${q.payload.title || '—'}» → ${msk(q.scheduled_for)}`)
    if (showText) {
      const m = buildStudentReminderTelegramMessage(q.payload, 'https://alminion.ru', new Date(q.scheduled_for))
      console.log(`      «${m.text}» [${m.replyMarkup?.inline_keyboard[0][0].text} → ${m.replyMarkup?.inline_keyboard[0][0].url}]`)
    }
  }
  const byStudent = {}
  for (const s of plan.skipped) {
    const [, kind, , , profile] = s.key.match(/^student_reminder:([a-z_]+):(.+?)(:\d+)?:([0-9a-f-]{36})$/) ?? []
    if (s.reason === 'not_due' || s.reason === 'not_eligible') continue
    ;(byStudent[names[profile] ?? profile] ??= []).push(`${kind} — ${s.reason}`)
  }
  for (const [n, list] of Object.entries(byStudent)) console.log(`  · ${n}: ${list.join('; ')}`)
  const notEligible = plan.skipped.filter(s => s.reason === 'not_eligible').length
  console.log(`  итого: поставлено ${plan.queue.length}, не подходят ${notEligible}, ещё не время ${plan.skipped.filter(s => s.reason === 'not_due').length}`)
  if (plan.queue.length) {
    const values = plan.queue.map(q => `(${lit(q.profile_id)}, 'telegram', 'student_reminder', ${q.entity_type ? lit(q.entity_type) : 'null'}, ` +
      `${q.entity_id ? lit(q.entity_id) : 'null'}, ${lit(q.deduplication_key)}, ${lit(JSON.stringify(q.payload))}::jsonb, 'sent', ${lit(q.scheduled_for)})`)
    psql(`insert into notification_queue (profile_id, channel, event_type, entity_type, entity_id, deduplication_key, payload, status, scheduled_for)
          values ${values.join(',')} on conflict (deduplication_key) do nothing`)
  }
}

console.log('== 15. Тики крона: кому, когда, лимит 2 в день с приоритетом и бронью, тишина, дедупликация, выключенные виды')
tick('1. контрольная «Кинематика» кончается в 15:00', '2026-10-05T11:50:00Z', { showText: true })
tick('2. «срок ДЗ прошёл» — 17:00', '2026-10-05T14:00:00Z', { showText: true })
tick('3. серия — 18:30', '2026-10-05T15:30:00Z', { showText: true })
tick('4. за 5 минут до 19:00 — ставится со scheduled_for = 19:00', '2026-10-05T15:55:00Z', { showText: true })
tick('5. следующий тик — повторов нет (дедупликация), лимит', '2026-10-05T16:00:00Z')
tick('6. тишина', '2026-10-05T19:30:00Z')
tick('7. 07:50 — ещё тишина и через 5 минут тоже', '2026-10-06T04:50:00Z')
tick('8. 07:55 — проверочная в 08:45: момент 07:45 в тишине → 08:00', '2026-10-06T04:55:00Z', { showText: true })
tick('9. 08:00 — повторов нет', '2026-10-06T05:00:00Z')
tick('10. 10:55 — личное окно Тимура (12:00) → 11:00', '2026-10-06T07:55:00Z', { showText: true })

console.log('\n== 16. Журнал очереди после тиков: на каждого ученика и день — не больше 2')
console.log(psql(`select string_agg(p.full_name || ' ' || to_char(q.scheduled_for at time zone 'Europe/Moscow', 'DD.MM') || ': ' || q.n, E'\\n' order by p.full_name, q.scheduled_for)
  from (select profile_id, (scheduled_for at time zone 'Europe/Moscow')::date::timestamptz as scheduled_for, count(*) n
          from notification_queue where event_type = 'student_reminder' group by 1, 2) q join profiles p on p.id = q.profile_id`))
console.log(psql(`select 'больше 2 в день: ' || count(*) from (select profile_id, (scheduled_for at time zone 'Europe/Moscow')::date, count(*)
  from notification_queue where event_type = 'student_reminder' group by 1, 2 having count(*) > 2) x`))
