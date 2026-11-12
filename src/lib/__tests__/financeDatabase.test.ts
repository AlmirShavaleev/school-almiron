import { afterAll,beforeAll,describe,it,expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const db=new PGlite()
const admin='00000000-0000-4000-8000-000000000001',student='00000000-0000-4000-8000-000000000002',course='00000000-0000-4000-8000-000000000003',sub='00000000-0000-4000-8000-000000000004'
beforeAll(async()=>{
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table profiles(id uuid,role text,full_name text,email text);
 create function public.is_admin_or_owner() returns boolean language sql as $$ select exists(select 1 from profiles where id=auth.uid() and role in ('admin','owner')) $$;
 create table students(id uuid,profile_id uuid);
 create table courses(id uuid,title text,is_template boolean);
 create table groups(id uuid,course_id uuid);
 create table group_students(group_id uuid,student_id uuid);
 create table subscription_tariffs(course_id uuid,is_active boolean);
 create table student_subscriptions(id uuid,student_id uuid,course_id uuid,status text,access_until timestamptz,auto_renew boolean,source text);
 create table subscription_payments(id uuid,subscription_id uuid,student_id uuid,kind text,status text,amount_rub numeric,paid_at timestamptz,created_at timestamptz,refunded_at timestamptz,yookassa_payment_id text);
 create table subscription_log(id bigint,details jsonb,payment_id uuid,event text,yookassa_object_id text,created_at timestamptz);
 insert into profiles values('${admin}','admin','Admin','admin@test'),('${student}','student','Student','student@test');
 insert into students values('${student}','${student}');insert into courses values('${course}','Физика',false);
 insert into subscription_tariffs values('${course}',true);
 insert into student_subscriptions values('${sub}','${student}','${course}','active',now()+interval '30 days',false,'purchase');`)
 for(const file of ['20261112110546_admin_finance_dashboard.sql','20261112110650_admin_finance_coverage_history.sql'])await db.exec(readFileSync(`${process.cwd()}/supabase/migrations/${file}`,'utf8'))
 await db.exec(`insert into subscription_payments(id,subscription_id,student_id,kind,status,amount_rub,paid_at,created_at,is_test) values
 ('00000000-0000-4000-8000-000000000011','${sub}','${student}','initial','succeeded',500,now()-interval '2 days',now()-interval '2 days',true),
 ('00000000-0000-4000-8000-000000000012','${sub}','${student}','initial','succeeded',500,now()-interval '1 day',now()-interval '1 day',true);`)
},20000)
afterAll(()=>db.close())
async function role(id:string){await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`)}
describe('финансовая RPC',()=>{
 it('не допускает ученика и анонимный вызов',async()=>{
  await role(student);await expect(db.query("select public.admin_finance_snapshot(current_date)")).rejects.toThrow('Только администратор')
  await db.exec('reset role;set role anon');await expect(db.query('select public.admin_finance_snapshot(current_date)')).rejects.toThrow(/permission denied/)
  await db.exec('reset role')
 })
 it('выдаёт админу историю и отличает ручное продление от первой оплаты',async()=>{
  await role(admin)
  const {rows}=await db.query<{s:{payments:{is_first:boolean}[];courses:unknown[]}}>('select public.admin_finance_snapshot(current_date) as s')
  expect(rows[0].s.courses).toHaveLength(1);expect(rows[0].s.payments.filter(p=>p.is_first)).toHaveLength(1);expect(rows[0].s.payments.filter(p=>!p.is_first)).toHaveLength(1)
  await expect(db.query("select public.admin_finance_snapshot('2099-01-01')")).rejects.toThrow('Недопустимый месяц')
  await db.exec('reset role')
 })
})
