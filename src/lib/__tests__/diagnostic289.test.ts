/**
 * §289 — стартовая диагностика в базе. Настоящие миграции (цепочка
 * migrationChain + §290-A + §289 A и B) в PGlite поверх заглушек прод-объектов.
 *
 * Поведение: адаптивный выбор (верно → сложнее по другому номеру блока,
 * неверно / «Не знаю» → легче по тому же), одиночный блок пропускается, ≤ 20
 * задач, прерывание и продолжение, защита от двойного ответа, результат и
 * «твой / верный ответ», прогноз (баллы 1 / 0,5 / 0, предмет без группы),
 * открытия уроков только у оплаченных курсов 'progress', права.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, STUBS, migrationFiles } from '../../test/sql/migrationChain'

const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ADMIN = U(1), KID = U(2), KID2 = U(3), TEACHER = U(4)

let db: PGlite
const id: Record<string, string> = {}

async function as(uid: string | null) {
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ''])
}
async function val<T = unknown>(sql: string, p: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, p)
  return Object.values(r.rows[0] ?? {})[0] as T
}
async function errorOf(sql: string, p: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, p)
    return null
  } catch (e) {
    const err = e as { message?: string; hint?: string }
    return `${err.hint ?? ''} ${err.message ?? ''}`
  }
}
const file = (re: RegExp) => {
  const f = readdirSync(MIGRATIONS).find((x) => re.test(x))
  if (!f) throw new Error(`Не найдена миграция ${re}`)
  return readFileSync(path.join(MIGRATIONS, f), 'utf8')
}

type Payload = { session_id: string; status: string; answered: number; task: { id: string; n: number; title: string; statement_html: string } | null }
/** Текущая задача (уровень — из сессии, ученику не отдаётся). */
async function current(uid: string) {
  return (await db.query<{ n: number; level: string; block: number; step: number }>(
    `select current_n as n, current_level as level, current_block as block, current_step as step
       from diagnostic_sessions where profile_id = $1`, [uid])).rows[0]
}
async function answer(p: Payload, kind: 'ok' | 'bad' | 'dk'): Promise<Payload> {
  return val<Payload>(`select diagnostic_answer($1, $2, $3, $4)`,
    [p.session_id, p.task!.id, kind === 'ok' ? '42' : kind === 'bad' ? '7' : null, kind === 'dk'])
}

// Прод-объекты, которых нет в общих заглушках.
const EXTRA_STUBS = `
create type public.subject_type as enum ('physics','math','algebra','geometry','probability_statistics');
create type public.exam_type as enum ('ege','oge','grade_7','grade_8','grade_9','grade_10','grade_11');
create table public.student_subject_targets (id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade, subject public.subject_type not null,
  exam_type public.exam_type not null, target_score smallint not null, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (student_id, subject, exam_type));
alter table public.courses add column subject text;
alter table public.topics add column ege_task_numbers smallint[] not null default '{}';
create table public.catalog_sections (id uuid primary key default gen_random_uuid(), subject text, exam_type text,
  exam_number int, title text, is_published boolean not null default true);
create table public.catalog_tasks (id uuid primary key default gen_random_uuid(), external_id bigint, section_id uuid references public.catalog_sections(id),
  statement_html text, answer_html text, answer_spec jsonb, partial_type text, content_format text,
  is_published boolean not null default true, auto_checkable boolean not null default true);
create table public.catalog_task_assets (id uuid primary key default gen_random_uuid(), task_id uuid, tex_session_id int, kind text, storage_path text, alt text, position int);
create function public.catalog_answer_spec_verdict(p_spec jsonb, p_answer text) returns boolean language sql immutable as $f$ select btrim(p_answer) = p_spec->>'v' $f$;
create function public.catalog_task_verdict(p_answer_html text, p_partial text, p_answer text) returns boolean language sql immutable as $f$ select btrim(p_answer) = p_answer_html $f$;
-- прод-функции прогноза: только места вставки части B (тела на проде длиннее)
create function public.student_exam_evidence_rows(p_profile_id uuid, p_from timestamptz)
returns table (subject text, ns integer[], source text, score numeric, at timestamptz, item text, kim_total integer)
language sql stable set search_path = public, pg_temp as $f$
  with var_rows as (select 'physics'::text, array[1], 'catalog'::text, 1::numeric, now(), 'v'::text, null::int where false)
  select * from var_rows where false
  union all select * from var_rows;
$f$;
create function public.student_forecast_evidence_of(p_profile_id uuid, p_as_of timestamptz)
returns jsonb language sql stable set search_path = public, pg_temp as $f$
  with my_subjects as (
    select c.subject::text as subject from public.courses c
      join public.groups g on g.course_id = c.id
      join public.group_students gs on gs.group_id = g.id
      join public.students s on s.id = gs.student_id
     where s.profile_id = p_profile_id
       and c.subject::text in ('math', 'physics')
  ),
  ev as (
    select e.* from public.student_exam_evidence_rows(p_profile_id, p_as_of - interval '180 days') e
     where e.subject in (select subject from my_subjects)
  )
  select jsonb_build_object(
    'subjects', (select coalesce(jsonb_agg(subject order by subject), '[]'::jsonb) from my_subjects),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('item', item, 'score', score, 'ns', ns)), '[]'::jsonb) from ev));
$f$;
`

/** Набор теста: по 2 задачи на номер × уровень; ответ на все — «42». */
async function loadSet() {
  const numbers = []
  for (let n = 1; n <= 20; n++) {
    const sec = await val<string>(`insert into catalog_sections (subject, exam_type, exam_number, title) values ('Физика', 'ЕГЭ', $1, $2) returning id`, [n, `Номер ${n}`])
    const tasks: Record<string, number[]> = {}
    for (const [li, lvl] of ['лёгкая', 'средняя', 'сложная'].entries()) {
      tasks[lvl] = []
      for (let k = 0; k < 2; k++) {
        const ext = n * 100 + li * 10 + k
        await db.query(`insert into catalog_tasks (external_id, section_id, statement_html, answer_html, answer_spec)
                        values ($1, $2, $3, '42', $4)`, [ext, sec, `<p>Задача ${ext}</p>`, k === 0 ? JSON.stringify({ v: '42' }) : null])
        tasks[lvl].push(ext)
      }
    }
    numbers.push({ n, title: `Номер ${n}`, tasks })
  }
  // посторонняя задача: неопубликованная — не должна попасть в набор
  numbers[0].tasks['лёгкая'].push(999999)
  return val<{ tasks: number; missing: number[] }>(`select admin_diagnostic_set_load('physics', 'тест', $1::jsonb, true)`, [JSON.stringify(numbers)])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync(STUBS, 'utf8'))
  await db.exec(EXTRA_STUBS)
  for (const f of migrationFiles()) await db.exec(readFileSync(f, 'utf8'))
  await db.exec(file(/^(PENDING_290_a_path|\d+_290_a_path)\.sql$/))
  await db.exec(file(/^(PENDING_289_a_diagnostic|\d+_289_a_diagnostic)\.sql$/))
  await db.exec(file(/^(PENDING_289_b_forecast|\d+_289_b_forecast)\.sql$/))
  for (const [pid, role] of [[ADMIN, 'admin'], [KID, 'student'], [KID2, 'student'], [TEACHER, 'teacher']] as const) {
    await db.query(`insert into profiles (id, email, full_name, role) values ($1, $2, $3, $4)`, [pid, `u${pid.slice(-2)}@t.ru`, `Имя${pid.slice(-2)}`, role])
  }
  id.kid = await val(`insert into students (profile_id) values ($1) returning id`, [KID])
  id.kid2 = await val(`insert into students (profile_id) values ($1) returning id`, [KID2])
  await db.query(`insert into student_onboarding (profile_id, grade, subject, target_score, hours_per_week, completed_at) values ($1, 11, 'physics', 80, 6, now())`, [KID])
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('§289: набор и начало', () => {
  it('черновой набор (каталог пуст) — «недоступно»; учитель не проходит', async () => {
    await as(KID)
    expect(await errorOf(`select diagnostic_start('physics')`)).toContain('NO_SET')
    expect(await val(`select count(*)::int from diagnostic_sessions`)).toBe(0)
    await as(TEACHER)
    expect(await errorOf(`select diagnostic_start('physics')`)).toContain('NOT_STUDENT')
  })

  it('загрузка набора по external_id: только опубликованные автопроверяемые своего номера; ученик — не может', async () => {
    await as(KID)
    expect(await errorOf(`select admin_diagnostic_set_load('physics', 'x', '[]'::jsonb, true)`)).toContain('ONLY_ADMIN')
    await as(null)
    const r = await loadSet()
    expect(r).toMatchObject({ tasks: 120, missing: [999999] })
    expect(await val(`select count(*)::int from diagnostic_sets where subject = 'physics' and is_active`)).toBe(1)
  })
})

describe('§289: адаптивный тест', () => {
  let p: Payload

  it('старт: средняя по №1; анкета → «идёт»', async () => {
    await as(KID)
    p = await val<Payload>(`select diagnostic_start('physics')`)
    expect(p).toMatchObject({ status: 'in_progress', answered: 0, task: { n: 1, title: 'Номер 1' } })
    expect(p.task!.statement_html).toContain('Задача 1')
    // ни ответа, ни уровня, ни спецификации ответа
    expect(Object.keys(p.task!).sort()).toEqual(['assets', 'content_format', 'id', 'n', 'shown_at', 'statement_html', 'title'])
    expect(await current(KID)).toMatchObject({ n: 1, level: 'средняя', block: 1, step: 1 })
    expect(await val(`select diagnostic_status from student_onboarding where profile_id = $1`, [KID])).toBe('in_progress')
  })

  it('верно → сложная по №2; неверно → следующий блок, средняя по №3; неверно → лёгкая по №3', async () => {
    p = await answer(p, 'ok')
    expect(await current(KID)).toMatchObject({ n: 2, level: 'сложная', step: 2 })
    p = await answer(p, 'bad')
    expect(await current(KID)).toMatchObject({ n: 3, level: 'средняя', block: 2, step: 1 })
    p = await answer(p, 'bad')
    expect(await current(KID)).toMatchObject({ n: 3, level: 'лёгкая', step: 2 })
  })

  it('пустой ответ — нельзя; двойной ответ на сменившуюся задачу — STALE', async () => {
    expect(await errorOf(`select diagnostic_answer($1, $2, '  ', false)`, [p.session_id, p.task!.id])).toContain('EMPTY')
    const old = p
    p = await answer(p, 'ok')                     // лёгкая №3 — верно (0,5)
    expect(await errorOf(`select diagnostic_answer($1, $2, '42', false)`, [old.session_id, old.task!.id])).toContain('STALE')
  })

  it('прервался — при входе та же задача; «Не знаю» = неверно → лёгкая того же номера', async () => {
    expect(await current(KID)).toMatchObject({ n: 5, level: 'средняя', block: 3, step: 1 })
    const again = await val<Payload>(`select diagnostic_start('physics')`)
    expect(again.task!.id).toBe(p.task!.id)
    p = await answer(again, 'dk')
    expect(await current(KID)).toMatchObject({ n: 5, level: 'лёгкая', step: 2 })
    expect(await val(`select verdict from diagnostic_answers where n = 5 and level = 'средняя'`)).toBe('dont_know')
  })

  it('до конца: одиночный блок (№13) после верного — пропуск; ≤ 20 задач; «готово»', async () => {
    p = await answer(p, 'bad')                    // №5 лёгкая — неверно → блок 4 (№7)
    const seen: number[] = []
    while (p.task) {
      const c = await current(KID)
      seen.push(c.n)
      p = await answer(p, 'ok')
    }
    expect(p.status).toBe('done')
    expect(seen.filter((n) => n === 13)).toHaveLength(1)
    expect(seen).toContain(14)
    const total = await val<number>(`select count(*)::int from diagnostic_answers where profile_id = $1`, [KID])
    expect(total).toBeLessThanOrEqual(20)
    expect(total).toBe(6 + seen.length)
    expect(await val(`select diagnostic_status from student_onboarding where profile_id = $1`, [KID])).toBe('done')
    // пройдена — повторный старт без задачи
    expect(await val(`select diagnostic_start('physics')`)).toMatchObject({ status: 'done', task: null })
  })
})

describe('§289: результат и прогноз', () => {
  it('карта номеров, слабые места, «твой / верный ответ»', async () => {
    await as(KID)
    const r = await val<{ numbers: Array<{ n: number; status: string }>; weak: Array<{ n: number }>; answers: Array<Record<string, unknown>>; onboarding: Record<string, unknown> }>(
      `select diagnostic_result('physics')`)
    const st = Object.fromEntries(r.numbers.map((x) => [x.n, x.status]))
    expect(st[1]).toBe('green')     // средняя верно
    expect(st[2]).toBe('red')       // сложная неверно
    expect(st[3]).toBe('yellow')    // только лёгкая верно
    expect(st[5]).toBe('red')       // «не знаю» + неверно
    expect(st[13]).toBe('green')
    expect(r.weak.map((w) => w.n)).toEqual([2, 5, 3])
    expect(r.answers[0]).toMatchObject({ n: 1, verdict: 'correct', answer: '42', correct_html: '42' })
    expect(r.answers.find((a) => a.verdict === 'dont_know')).toMatchObject({ n: 5, answer: null })
    expect(r.onboarding).toMatchObject({ target_score: 80, hours_per_week: 6 })
  })

  it('в прогноз: 1 / 0,5 / 0; предмет диагностики — у ученика без группы', async () => {
    await as(null)
    const rows = (await db.query<{ n: number; score: string }>(
      `select ns[1] as n, score from student_exam_evidence_rows($1, now() - interval '1 day') order by item`, [KID])).rows
    const byN = (n: number) => rows.filter((r) => r.n === n).map((r) => Number(r.score)).sort()
    expect(byN(1)).toEqual([1])
    expect(byN(3)).toEqual([0, 0.5])
    expect(byN(5)).toEqual([0, 0])
    const fe = await val<{ subjects: string[]; evidence: unknown[] }>(`select student_forecast_evidence_of($1, now())`, [KID])
    expect(fe.subjects).toEqual(['physics'])
    expect(fe.evidence.length).toBe(rows.length)
    // у другого ученика — пусто, как было
    expect(await val(`select student_forecast_evidence_of($1, now())`, [KID2])).toEqual({ subjects: [], evidence: [] })
  })
})

describe('§289: права', () => {
  it('ученик не читает таблицы; чужую диагностику не видит; посторонний учитель — нет', async () => {
    await as(KID2)
    await db.exec('set role authenticated')
    try {
      expect(await errorOf(`select * from diagnostic_answers`)).toContain('permission denied')
      expect(await errorOf(`select * from diagnostic_sessions`)).toContain('permission denied')
    } finally {
      await db.exec('reset role')
    }
    expect(await val(`select diagnostic_result('physics')`)).toBeNull()
    expect(await errorOf(`select diagnostic_answer((select id from diagnostic_sessions limit 1), gen_random_uuid(), '42', false)`)).toContain('NOT_FOUND')
    await as(TEACHER)
    expect(await errorOf(`select diagnostic_result_for($1)`, [id.kid])).toContain('NOT_STAFF')
    expect(await errorOf(`select diagnostic_reset($1)`, [id.kid])).toContain('NOT_STAFF')
  })

  it('админ видит результат', async () => {
    await as(ADMIN)
    expect(await val(`select diagnostic_result_for($1)`, [id.kid])).toMatchObject({ status: 'done' })
  })
})

describe('§289: открытия уроков', () => {
  it('пробный (демо) — ничего; стала оплаченной — open по «зелёным» номерам, ручное «закрыть» не трогается', async () => {
    await as(null)
    const course = await val<string>(`insert into courses (title, subject) values ('Физика ЕГЭ', 'physics') returning id`)
    await db.query(`insert into course_unlock_modes (course_id, mode) values ($1, 'progress')`, [course])
    const mod = await val<string>(`insert into modules (course_id, title, order_index) values ($1, 'Механика', 1) returning id`, [course])
    const t = async (title: string, nums: number[]) =>
      val<string>(`insert into topics (module_id, title, order_index, ege_task_numbers) values ($1, $2, 1, $3) returning id`, [mod, title, nums])
    id.green = await t('Кинематика', [1])
    id.mixed = await t('Кинематика и динамика', [1, 2])
    id.closed = await t('Оптика', [13])
    id.none = await t('Без номеров', [])
    await db.query(`insert into student_topic_overrides (student_id, topic_id, state) values ($1, $2, 'closed')`, [id.kid, id.closed])
    const tariff = await val<string>(`insert into subscription_tariffs (course_id, title, price_rub, trial_days, is_active) values ($1, 'Месяц', 500, 3, true) returning id`, [course])
    await db.query(`insert into student_subscriptions (student_id, course_id, tariff_id, status, source, access_until)
                    values ($1, $2, $3, 'trial', 'trial', now() + interval '3 days')`, [id.kid, course, tariff])
    const opens = async () => (await db.query<{ topic_id: string; state: string; note: string | null }>(
      `select topic_id, state, note from student_topic_overrides where student_id = $1 order by topic_id`, [id.kid])).rows
    expect((await opens()).filter((o) => o.state === 'open')).toHaveLength(0)

    await db.query(`update student_subscriptions set status = 'active', source = 'purchase' where student_id = $1`, [id.kid])
    const after = await opens()
    expect(after.filter((o) => o.state === 'open').map((o) => o.topic_id)).toEqual([id.green])
    expect(after.find((o) => o.topic_id === id.green)?.note).toBe('диагностика')
    expect(after.find((o) => o.topic_id === id.closed)?.state).toBe('closed')
    expect(await val(`select count(*)::int from student_topic_override_log where student_id = $1 and action = 'diagnostic'`, [id.kid])).toBe(1)
  })

  it('«пройти заново» (админ): сессия и ответы удалены, анкета — «не пройдена», открытые уроки остаются', async () => {
    await as(ADMIN)
    expect(await val(`select diagnostic_reset($1)`, [id.kid])).toBe(true)
    expect(await val(`select count(*)::int from diagnostic_answers where profile_id = $1`, [KID])).toBe(0)
    expect(await val(`select diagnostic_status from student_onboarding where profile_id = $1`, [KID])).toBe('none')
    expect(await val(`select count(*)::int from student_topic_overrides where student_id = $1 and state = 'open'`, [id.kid])).toBe(1)
  })
})
