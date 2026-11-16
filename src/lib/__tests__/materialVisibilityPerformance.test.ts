import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../../..')
const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let db: PGlite
const fixture = (name: string) => readFileSync(path.join(root, 'src/test/sql', name), 'utf8')

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table students(id uuid primary key,profile_id uuid);
    create function auth_student_id() returns uuid language sql stable security definer set search_path=public,pg_temp as $$
      select id from students where profile_id=auth.uid() $$;
    create table topics(id uuid primary key,kind text);
    create table candidate_access(student_id uuid,topic_id uuid);
    create function student_candidate_topics() returns setof uuid language sql stable security definer set search_path=public,pg_temp as $$
      select c.topic_id from candidate_access c where c.student_id=auth_student_id() $$;
    create table app_feature_flags(key text,enabled boolean);
    create table topic_homework(id uuid primary key,topic_id uuid,opens_at timestamptz);
    create table topic_homework_attempts(id uuid primary key,homework_id uuid,student_id uuid,status text);
    create table personal_windows(homework_id uuid,student_id uuid,opens_at timestamptz);
    create function topic_homework_student_window(p_homework_id uuid,p_student_id uuid)
      returns table(opens_at timestamptz) language sql stable security definer set search_path=public,pg_temp as $$
      select case when w.homework_id is not null then w.opens_at else h.opens_at end
      from topic_homework h left join personal_windows w on w.homework_id=h.id and w.student_id=p_student_id where h.id=p_homework_id $$;
    create table courses(id uuid primary key,title text);
    create table groups(id uuid primary key,course_id uuid,created_at timestamptz);
    create table subscription_tariffs(id uuid primary key,title text,price_rub int,period_months int);
    create table student_subscriptions(id uuid primary key,student_id uuid,course_id uuid,tariff_id uuid,status text,
      access_until timestamptz,current_period_end timestamptz,auto_renew boolean,next_charge_at timestamptz,
      last_charge_error text,card_title text,created_at timestamptz);
    create table subscription_payment_methods(subscription_id uuid);
    create table subscription_promo_redemptions(subscription_id uuid,status text,kind text,percent int,payments_left int,
      tariff_id uuid,created_at timestamptz);
    create table subscription_payments(id uuid primary key,subscription_id uuid,kind text,amount_rub int,discount_rub int,
      status text,paid_at timestamptz,created_at timestamptz,refunded_at timestamptz);
    create function _promo_price(price int,percent int) returns int language sql immutable as $$ select price*(100-percent)/100 $$;
    grant usage on schema public,auth to authenticated;
    revoke all on students,topics,candidate_access,app_feature_flags,topic_homework,topic_homework_attempts,
      personal_windows,student_subscriptions,subscription_payments from authenticated;
  `)
  await db.exec(fixture('materialVisibilityGateHelpers.sql'))
  const old = fixture('materialVisibilityBeforeOptimization.sql')
  await db.exec(old.replaceAll('public.student_tmi_solution_topics()', 'public.student_tmi_solution_topics_before()')
    .replaceAll('public.student_tmi_condition_topics()', 'public.student_tmi_condition_topics_before()')
    .replaceAll('public.my_subscriptions()', 'public.my_subscriptions_before()'))
  await db.exec(old)
  await db.exec(`revoke all on function student_tmi_solution_topics(),student_tmi_condition_topics(),my_subscriptions() from public,anon;
    grant execute on function student_tmi_solution_topics(),student_tmi_condition_topics(),my_subscriptions() to authenticated,service_role;`)
  const staged = process.env.MATERIAL_VISIBILITY_MIGRATION
  const migration = staged ? path.resolve(root, staged) : path.join(root, 'supabase/migrations',
    readdirSync(path.join(root, 'supabase/migrations')).find(f => /^\d+_optimize_material_visibility_and_subscription_reads\.sql$/.test(f))!)
  await db.exec(readFileSync(migration, 'utf8'))
}, 60_000)
afterAll(async () => { await db?.close() })

async function reset() {
  await db.exec(`reset role; truncate students,topics,candidate_access,app_feature_flags,topic_homework,topic_homework_attempts,
    personal_windows,courses,groups,subscription_tariffs,student_subscriptions,subscription_payment_methods,
    subscription_promo_redemptions,subscription_payments;
    select set_config('test.uid','${U(1)}',false);
    insert into students values ('${U(1)}','${U(1)}'),('${U(2)}','${U(2)}');
    insert into topics values ('${U(10)}','lesson'),('${U(11)}','control'),('${U(12)}',null),('${U(13)}','check');
    insert into candidate_access values ('${U(1)}','${U(10)}'),('${U(1)}','${U(11)}'),('${U(1)}','${U(12)}'),('${U(2)}','${U(13)}');`)
}
async function value<T>(sql: string, args: unknown[] = []): Promise<T> {
  return Object.values((await db.query<Record<string,T>>(sql,args)).rows[0])[0]
}
async function ids(fn: string) { return (await value<string[]>(`select ${fn}()`)).sort() }
async function same() {
  for (const fn of ['student_tmi_solution_topics','student_tmi_condition_topics'])
    expect(await ids(fn)).toEqual(await ids(fn+'_before'))
  expect(await value('select my_subscriptions()')).toEqual(await value('select my_subscriptions_before()'))
}
describe('batched material visibility', () => {
  it('preserves execution privileges', async () => {
    for (const fn of ['student_tmi_solution_topics','student_tmi_condition_topics','my_subscriptions']) {
      expect(await value(`select has_function_privilege('anon','${fn}()','execute')`)).toBe(false)
      expect(await value(`select has_function_privilege('authenticated','${fn}()','execute')`)).toBe(true)
    }
  })
  it('keeps solutions open without homework, including null lesson kind', async () => {
    await reset()
    await same()
    expect(await ids('student_tmi_solution_topics')).toEqual([U(10),U(11),U(12)])
    expect(await ids('student_tmi_condition_topics')).toEqual([U(10),U(12)])
  })
  it('does not unlock solutions for draft/submitted/returned or another student', async () => {
    await reset()
    await db.exec(`insert into topic_homework values ('${U(20)}','${U(10)}',null);
      insert into topic_homework_attempts values ('${U(30)}','${U(20)}','${U(2)}','accepted')`)
    for (const status of ['draft','submitted','returned_for_revision','accepted']) {
      await db.exec(`delete from topic_homework_attempts where id='${U(31)}';
        insert into topic_homework_attempts values ('${U(31)}','${U(20)}','${U(1)}','${status}')`)
      await same()
      expect((await ids('student_tmi_solution_topics')).includes(U(10))).toBe(status==='accepted')
    }
  })
  it('read-only flag unlocks only candidate topics and returns an empty set to outsiders', async () => {
    await reset()
    await db.exec(`insert into topic_homework values ('${U(20)}','${U(10)}',null);
      insert into app_feature_flags values ('read_only_mode',true)`)
    await same()
    expect(await ids('student_tmi_solution_topics')).toEqual([U(10),U(11),U(12)])
    for (const uid of [U(99),'']) {
      await db.query(`select set_config('test.uid',$1,false)`,[uid])
      await same()
      expect(await ids('student_tmi_solution_topics')).toEqual([])
      expect(await ids('student_tmi_condition_topics')).toEqual([])
    }
  })
  it('keeps common/personal opening times, drafts and submitted work semantics', async () => {
    await reset()
    await db.exec(`insert into topic_homework values ('${U(20)}','${U(11)}',now()+interval '1 day')`)
    await same()
    expect(await ids('student_tmi_condition_topics')).not.toContain(U(11))
    await db.exec(`insert into topic_homework_attempts values ('${U(30)}','${U(20)}','${U(1)}','draft')`)
    await same()
    expect(await ids('student_tmi_condition_topics')).not.toContain(U(11))
    await db.exec(`insert into personal_windows values ('${U(20)}','${U(1)}',now()-interval '1 day')`)
    await same()
    expect(await ids('student_tmi_condition_topics')).toContain(U(11))
    await db.exec(`update personal_windows set opens_at=now()+interval '2 days'; update topic_homework_attempts set status='submitted'`)
    await same()
    expect(await ids('student_tmi_condition_topics')).toContain(U(11))
  })
  it('runs for an authenticated user without granting access to backing tables', async () => {
    await reset()
    await db.exec('set role authenticated')
    expect(await ids('student_tmi_solution_topics')).toHaveLength(3)
    await expect(db.query('select * from topic_homework_attempts')).rejects.toThrow(/permission denied/)
    await db.exec('reset role')
  })
  it('keeps own subscriptions, payments, promos and excludes created payments/other students', async () => {
    await reset()
    await db.exec(`insert into courses values ('${U(40)}','Course');
      insert into groups values ('${U(41)}','${U(40)}',now());
      insert into subscription_tariffs values ('${U(42)}','Tariff',1000,1);
      insert into student_subscriptions(id,student_id,course_id,tariff_id,status,access_until,created_at)
      values ('${U(43)}','${U(1)}','${U(40)}','${U(42)}','active',now()+interval '1 day',now()),
             ('${U(44)}','${U(2)}','${U(40)}','${U(42)}','active',now()+interval '1 day',now());
      insert into subscription_promo_redemptions values ('${U(43)}','applied','percent',20,2,null,now());
      insert into subscription_payments values ('${U(45)}','${U(43)}','renewal',800,200,'succeeded',now(),now(),null),
        ('${U(46)}','${U(43)}','renewal',800,200,'created',null,now(),null);`)
    await same()
    const mine = await value<Array<{id:string;has_access:boolean;payments:unknown[];promo:{next_amount_rub:number}}>>('select my_subscriptions()')
    expect(mine).toHaveLength(1)
    expect(mine[0].id).toBe(U(43))
    expect(mine[0].payments).toHaveLength(1)
    expect(mine[0].promo.next_amount_rub).toBe(800)
    expect(mine[0].has_access).toBe(true)
    await db.exec(`select set_config('test.uid','',false)`)
    expect(await value('select my_subscriptions()')).toEqual([])
  })
})
