/**
 * Прогноз балла — хранить и читать (письмо ЛК_прогноз_балла_хранить.md, 16.10):
 * настоящая миграция PENDING_score_forecast.sql в PGlite поверх минимальных
 * заглушек прод-объектов. Путь целиком: пачка учеников со свидетельствами →
 * расчёт ТЕМ ЖЕ модулем, что у Edge Function (`_shared/scoreForecast.ts`) →
 * запись → чтение учеником, персоналом курса, отказ постороннему; права на
 * служебные функции; замер чтения.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { storedForecastsFromEvidence } from '../../../supabase/functions/_shared/scoreForecast.ts'

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const TEACHER = U(1), KID = U(2), STRANGER = U(3), OTHER_KID = U(4), IDLE = U(5)
const COURSE = U(10), GROUP = U(11), COURSE2 = U(12)
const ST = U(20), ST2 = U(21), ST3 = U(22)

const STUBS = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.profiles (id uuid primary key, full_name text, role text not null default 'student');
create table public.students (id uuid primary key, profile_id uuid unique references public.profiles(id));
create table public.courses (id uuid primary key, title text, owner_id uuid);
create table public.groups (id uuid primary key, course_id uuid references public.courses(id));
create table public.group_students (group_id uuid references public.groups(id), student_id uuid references public.students(id));
create table public.student_courses (student_id uuid, course_id uuid, status text, expires_at timestamptz);
create table public.catalog_task_attempts (profile_id uuid, created_at timestamptz);
create table public.ev_fixture (profile_id uuid primary key, data jsonb);
create function public.student_forecast_evidence_of(p uuid, at timestamptz) returns jsonb language sql stable as $$
  select coalesce((select data from public.ev_fixture where profile_id = p), '{"subjects": [], "evidence": []}'::jsonb) $$;
create function public.is_admin_or_owner() returns boolean language sql stable as $$ select false $$;
create function public.course_is_staff(c uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.courses where id = c and owner_id = auth.uid()) $$;
create function public._course_student_ids(c uuid) returns uuid[] language sql stable as $$
  select coalesce(array_agg(distinct gs.student_id), '{}') from public.group_students gs join public.groups g on g.id = gs.group_id where g.course_id = c $$;
create function public.auth_is_staff_of_student(s uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.group_students gs join public.groups g on g.id = gs.group_id
                  where gs.student_id = s and public.course_is_staff(g.course_id)) $$;
`

const NOW = new Date().toISOString()
const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
function evidence(subject: string, numbers: number, right: number, wrong: number) {
  const out: unknown[] = []
  for (let n = 1; n <= numbers; n++) {
    for (let i = 0; i < right + wrong; i++) out.push({ subject, ns: [n], source: 'catalog', score: i < right ? 1 : 0, at: day(2 + i), item: `${n}:${i}` })
  }
  return { now: NOW, subjects: [{ subject }], evidence: out }
}

let db: PGlite
async function as(uid: string | null) { await db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']) }
async function val<T = unknown>(sql: string, p: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, p)
  return Object.values(r.rows[0] ?? {})[0] as T
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try { await db.query(sql, p); return null } catch (e) { return (e as Error).message }
}

/** Что делает forecast-daily за один проход: пачка → расчёт общим модулем → запись. */
async function runDaily(profile: string | null = null) {
  const batch = await val<Array<{ profile_id: string; evidence: unknown }>>(
    `select public.score_forecast_batch(null, 40, $1::uuid)`, [profile])
  const rows = batch.flatMap(b => storedForecastsFromEvidence(b.evidence).map(r => ({ profile_id: b.profile_id, ...r, computed_at: NOW })))
  await db.query(`select public.score_forecast_store($1::jsonb, $2::uuid[])`, [JSON.stringify(rows), batch.map(b => b.profile_id)])
  return batch.map(b => b.profile_id)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUBS)
  await db.exec(readFileSync(path.resolve(__dirname, '../../../supabase/migrations/PENDING_score_forecast.sql'), 'utf8'))
  await db.exec(`
    insert into profiles values ('${TEACHER}', 'Учитель', 'teacher'), ('${KID}', 'Аня', 'student'), ('${STRANGER}', 'Чужой', 'teacher'),
                                ('${OTHER_KID}', 'Петя', 'student'), ('${IDLE}', 'Без курса', 'student');
    insert into students values ('${ST}', '${KID}'), ('${ST2}', '${OTHER_KID}'), ('${ST3}', '${IDLE}');
    insert into courses values ('${COURSE}', 'Физика', '${TEACHER}'), ('${COURSE2}', 'Чужой', '${STRANGER}');
    insert into groups values ('${GROUP}', '${COURSE}');
    insert into group_students values ('${GROUP}', '${ST}'), ('${GROUP}', '${ST2}');
  `)
  await db.query(`insert into ev_fixture values ($1, $2), ($3, $4)`, [
    KID, JSON.stringify(evidence('physics', 18, 4, 1)),
    OTHER_KID, JSON.stringify(evidence('physics', 3, 1, 1)),
  ])
})
afterAll(async () => { await db?.close() })

describe('хранимый прогноз (PENDING_score_forecast)', () => {
  it('ночной проход: ученики курсов (без курса и активности — нет), строки по предметам', async () => {
    const done = await runDaily()
    expect(done.sort()).toEqual([KID, OTHER_KID].sort())
    const rows = (await db.query<{ profile_id: string; subject: string; score: number | null; basis: string }>(
      `select profile_id, subject, score, basis from student_score_forecast order by profile_id`)).rows
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ profile_id: KID, subject: 'physics' })
    expect(rows[0].score).toBeGreaterThan(40)
    expect(rows[1]).toMatchObject({ profile_id: OTHER_KID, score: null, basis: 'по 6 задачам' })
  })

  it('решал в каталоге за 60 дней — тоже в прогоне', async () => {
    await db.query(`insert into catalog_task_attempts values ($1, now() - interval '3 days')`, [IDLE])
    const batch = await val<unknown[]>(`select public.score_forecast_batch(null, 40, null)`)
    expect(batch).toHaveLength(3)
    await db.query(`delete from catalog_task_attempts`)
  })

  it('ученик: только свои строки; простой select', async () => {
    await as(KID)
    const mine = await val<Array<{ subject: string; score: number; details: { ready: boolean } }>>(`select public.my_score_forecast()`)
    expect(mine).toHaveLength(1)
    expect(mine[0].details.ready).toBe(true)
    await as(STRANGER)
    expect(await val(`select public.my_score_forecast()`)).toEqual([])
  })

  it('персонал курса — все ученики курса; посторонний — отказ', async () => {
    await as(TEACHER)
    const course = await val<Array<{ student_id: string }>>(`select public.course_score_forecast($1)`, [COURSE])
    expect(course.map(r => r.student_id).sort()).toEqual([ST, ST2].sort())
    expect(await val<unknown[]>(`select public.student_score_forecast($1)`, [ST])).toHaveLength(1)
    await as(STRANGER)
    expect(await errorOf(`select public.course_score_forecast($1)`, [COURSE])).toMatch(/ACCESS_DENIED/)
    expect(await errorOf(`select public.student_score_forecast($1)`, [ST])).toMatch(/ACCESS_DENIED/)
    await as(KID)
    expect(await errorOf(`select public.course_score_forecast($1)`, [COURSE])).toMatch(/ACCESS_DENIED/)
  })

  it('служебные функции и таблица — только service_role', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect(await val(`select has_function_privilege($1, 'public.score_forecast_batch(uuid, integer, uuid)', 'execute')`, [role])).toBe(false)
      expect(await val(`select has_function_privilege($1, 'public.score_forecast_store(jsonb, uuid[])', 'execute')`, [role])).toBe(false)
      expect(await val(`select has_table_privilege($1, 'public.student_score_forecast', 'select')`, [role])).toBe(false)
    }
    expect(await val(`select has_function_privilege('service_role', 'public.score_forecast_batch(uuid, integer, uuid)', 'execute')`)).toBe(true)
    expect(await val(`select has_function_privilege('anon', 'public.my_score_forecast()', 'execute')`)).toBe(false)
  })

  it('пересчёт одного ученика; ушедший предмет снимается', async () => {
    await db.query(`update ev_fixture set data = $2 where profile_id = $1`, [OTHER_KID, JSON.stringify({ now: NOW, subjects: [], evidence: [] })])
    expect(await runDaily(OTHER_KID)).toEqual([OTHER_KID])
    expect(await val(`select count(*)::int from student_score_forecast where profile_id = $1`, [OTHER_KID])).toBe(0)
    expect(await val(`select count(*)::int from student_score_forecast where profile_id = $1`, [KID])).toBe(1)
  })

  it('замер чтения: my_score_forecast — доли миллисекунды на PGlite', async () => {
    await as(KID)
    const t = performance.now()
    for (let i = 0; i < 50; i++) await db.query(`select public.my_score_forecast()`)
    const ms = (performance.now() - t) / 50
    const size = (await val<string>(`select public.my_score_forecast()::text`)).length
    process.stderr.write(`my_score_forecast: ${ms.toFixed(2)} мс в среднем (PGlite, 50 вызовов), ответ ${size} байт
`)
    expect(ms).toBeLessThan(20)
    expect(size).toBeLessThan(2500)
  })
})
