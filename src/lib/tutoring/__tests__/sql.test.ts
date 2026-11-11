import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
const ADMIN='00000000-0000-0000-0000-000000000001', A='00000000-0000-0000-0000-000000000002', B='00000000-0000-0000-0000-000000000003'
let db:PGlite
async function uid(id:string) { await db.query("select set_config('test.uid',$1,false)",[id]) }
async function value<T>(query:string,args:unknown[]=[]):Promise<T> { const r=await db.query<Record<string,T>>(query,args);return Object.values(r.rows[0])[0] }
async function slot(hours:number) { await uid(ADMIN);return value<string>("select tutoring_admin_slot(now()+make_interval(hours=>$1))",[hours]) }
async function reserve(id:string,user=A) { await uid(user);return value<string>("select tutoring_reserve($1,'math','Разобрать задачу','kid@example.ru',true)",[id]) }
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table profiles(id uuid primary key,full_name text,role text);
 insert into profiles values('${ADMIN}','Admin','admin'),('${A}','A','student'),('${B}','B','student');
 create function is_admin_or_owner() returns boolean language sql stable security definer as $$select exists(select 1 from profiles where id=auth.uid() and role='admin')$$;`)
 await db.exec(readFileSync('supabase/pending/personal_lessons.sql','utf8'))
 await uid(ADMIN);await db.query("select tutoring_admin_settings(true,'https://telemost.yandex.ru/j/example')")
},30000)
afterAll(async()=>{await db.close()})
afterEach(async()=>{await db.exec("update tutoring_bookings set status='expired' where status='pending'")})
describe('запись и права',()=>{
 it('не допускает пересечение окон',async()=>{await slot(24);await expect(slot(24)).rejects.toThrow('пересекается')})
 it('чужой ученик не может занять зарезервированное время',async()=>{const s=await slot(26);await reserve(s);await expect(reserve(s,B)).rejects.toThrow('занято')})
 it('повтор резерва идемпотентен',async()=>{const s=await slot(28);const a=await reserve(s);expect(await reserve(s)).toBe(a)})
 it('ученик не меняет расписание и не видит чужие записи',async()=>{await uid(B);await expect(value('select tutoring_admin_list()')).rejects.toThrow('Нет доступа');const d=await value<{bookings:unknown[]}>('select tutoring_list()');expect(d.bookings).toHaveLength(0)})
 it('не выдаёт ссылку на встречу до оплаты и не принимает другую сумму',async()=>{
  const s=await slot(30),b=await reserve(s)
  await db.query("update tutoring_bookings set yookassa_id='yk-1' where id=$1",[b])
  let d=await value<{bookings:{id:string;meeting_url:string|null}[]}>('select tutoring_list()');expect(d.bookings.find(x=>x.id===b)?.meeting_url).toBeNull()
  await expect(value("select tutoring_apply_payment($1,'yk-1','succeeded',1)",[b])).rejects.toThrow('Несовпадение')
  await value("select tutoring_apply_payment($1,'yk-1','succeeded',1500)",[b]);await value("select tutoring_apply_payment($1,'yk-1','succeeded',1500)",[b])
  expect(await value<number>("select count(*)::int from tutoring_events where booking_id=$1 and event='paid'",[b])).toBe(1)
  d=await value('select tutoring_list()');expect(d.bookings.find(x=>x.id===b)?.meeting_url).toContain('telemost.yandex.ru')
 })
 it('оплаченное занятие переносится, старое окно освобождается',async()=>{
  const s=await slot(34),next=await slot(36),b=await reserve(s)
  await db.query("update tutoring_bookings set yookassa_id='yk-2' where id=$1",[b]);await value("select tutoring_apply_payment($1,'yk-2','succeeded',1500)",[b])
  await value('select tutoring_reschedule($1,$2)',[b,next]);expect(await value('select slot_id from tutoring_bookings where id=$1',[b])).toBe(next)
  await reserve(s,B)
 })
 it('перенос меньше чем за два часа запрещён',async()=>{
  const s=await slot(1),next=await slot(38),b=await reserve(s,B)
  await db.query("update tutoring_bookings set yookassa_id='yk-3' where id=$1",[b]);await value("select tutoring_apply_payment($1,'yk-3','succeeded',1500)",[b])
  await expect(value('select tutoring_reschedule($1,$2)',[b,next])).rejects.toThrow('2 часа')
 })
 it('поздний платёж не забирает чужую новую запись',async()=>{
  const s=await slot(40),b=await reserve(s,B)
  await db.query("update tutoring_bookings set reserved_until=now()-interval '1 minute',yookassa_id='yk-late' where id=$1",[b])
  const newer=await reserve(s)
  expect(await value("select tutoring_apply_payment($1,'yk-late','succeeded',1500)",[b])).toBe('payment_conflict')
  expect(await value('select status from tutoring_bookings where id=$1',[newer])).toBe('pending')
 })
 it('authenticated не может читать закрытые таблицы или подтверждать платежи',async()=>{
  await db.exec('set role authenticated')
  try {await expect(db.query('select * from tutoring_bookings')).rejects.toThrow();await expect(db.query("select tutoring_apply_payment(gen_random_uuid(),'x','succeeded',1500)")).rejects.toThrow()}
  finally {await db.exec('reset role')}
 })
})
