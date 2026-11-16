import { readFileSync,readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll,afterAll,describe,it,expect } from 'vitest'
const root=path.resolve(import.meta.dirname,'../../..')
const U=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const AT='2026-11-15T12:00:00Z'
let db:PGlite
const val=async<T=any>(sql:string,args:unknown[]=[]):Promise<T>=>Object.values((await db.query<Record<string,T>>(sql,args)).rows[0])[0]
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table students(id uuid primary key,profile_id uuid);
 create table courses(id uuid primary key,subject text,exam_type text);
 create table groups(id uuid primary key,course_id uuid);
 create table group_students(group_id uuid,student_id uuid);
 create table modules(id uuid primary key,course_id uuid);
 create table topics(id uuid primary key,module_id uuid,is_open boolean,available_from date);
 create table catalog_sections(id uuid primary key,subject text,exam_type text,exam_number int,title text,is_published boolean,position int);
 create table student_exam_goals(profile_id uuid,subject text,goal int,updated_at timestamptz);
 create table student_subject_targets(student_id uuid,subject text,exam_type text,target_score int,updated_at timestamptz);
 create table evidence_fixture(profile_id uuid,subject text,ns int[],source text,score numeric,at timestamptz,item text,kim_total int);
 create table solved_fixture(profile_id uuid,subject text,n int,at timestamptz);
 create sequence evidence_calls;
 create function student_exam_evidence_rows(p_profile_id uuid,p_from timestamptz)
 returns table(subject text,ns int[],source text,score numeric,at timestamptz,item text,kim_total int)
 language plpgsql stable as $$begin perform nextval('evidence_calls');
 return query select e.subject,e.ns,e.source,e.score,e.at,e.item,e.kim_total from evidence_fixture e where e.profile_id=p_profile_id and e.at>=p_from;end$$;
 create function catalog_reward_rules() returns jsonb language sql stable as $$ select jsonb_build_object('window_days',coalesce(nullif(current_setting('test.window',true),''),'30')::int,'low',0.4,'high',0.8) $$;
 create function catalog_zone_of(p numeric) returns text language sql stable as $$select case when p is null or p<0.4 then 'growth' when p<=0.8 then 'progress' else 'confident' end$$;
 create function catalog_counted_solutions(p uuid) returns table(subject text,n int,at timestamptz) language sql stable as $$select e.subject,e.n,e.at from solved_fixture e where e.profile_id=p$$;
 create table day_fixture(profile_id uuid,day date);
 create sequence day_calls;
 create function student_solve_days(p uuid) returns table(day date) language plpgsql stable as $$begin
 perform nextval('day_calls'); return query select distinct d.day from day_fixture d where d.profile_id=p;end$$;
 create table app_visits(profile_id uuid,visited_on date);
 create function student_solved_task_days(uuid,date) returns table(day date,source text,n int) language sql stable as $$select null::date,null::text,null::int where false$$;
 create function topic_done_events(uuid[]) returns table(student_id uuid,topic_id uuid) language sql stable as $$select null::uuid,null::uuid where false$$;
 create function progress_open_by_student(uuid[],uuid[]) returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create function topic_open_with(jsonb,text,boolean,date) returns boolean language sql stable as $$select coalesce($3,$4 is null or $4<=current_date)$$;
 grant usage on schema public,auth to authenticated;
 `)
 const original=readFileSync(path.join(root,'src/test/sql/forecastActivityBeforeOptimization.sql'),'utf8')
 await db.exec(original.replace('public.student_forecast_evidence_of(','public.student_forecast_evidence_before(').replace('public.student_home_activity(','public.student_home_activity_before('))
 await db.exec(original)
 await db.exec('revoke all on function student_forecast_evidence_of(uuid,timestamptz) from public,anon,authenticated;revoke all on function student_home_activity(int) from public,anon;grant execute on function student_home_activity(int) to authenticated')
 const file=process.env.FORECAST_ACTIVITY_MIGRATION
 const migration=file?path.resolve(root,file):path.join(root,'supabase/migrations',readdirSync(path.join(root,'supabase/migrations')).find(f=>/^\d+_reuse_forecast_evidence_and_activity_days\.sql$/.test(f))!)
 await db.exec(readFileSync(migration,'utf8'))
},60000)
afterAll(async()=>{await db?.close()})
async function reset(){
 await db.exec(`reset role;truncate students,courses,groups,group_students,modules,topics,catalog_sections,student_exam_goals,
 student_subject_targets,evidence_fixture,solved_fixture,day_fixture,app_visits;
 select set_config('test.uid','${U(1)}',false),set_config('test.window','30',false);
 insert into students values ('${U(1)}','${U(1)}'),('${U(2)}','${U(2)}');
 insert into courses values ('${U(10)}','math','ege');
 insert into groups values ('${U(11)}','${U(10)}');insert into group_students values ('${U(11)}','${U(1)}');
 insert into catalog_sections values ('${U(20)}','Математика','ЕГЭ',1,'One',true,1),('${U(21)}','Математика','ЕГЭ',2,'Two',true,2);`)
}
async function forecast(fn='student_forecast_evidence_of'){return val(`select ${fn}($1,$2::timestamptz)`,[U(1),AT])}
async function sameForecast(){expect(await forecast()).toEqual(await forecast('student_forecast_evidence_before'))}
describe('reuse expensive forecast/activity inputs',()=>{
 it('preserves the internal forecast ACL and the authenticated activity ACL',async()=>{
 expect(await val("select has_function_privilege('authenticated','student_forecast_evidence_of(uuid,timestamptz)','execute')")).toBe(false)
 expect(await val("select has_function_privilege('authenticated','student_home_activity(int)','execute')")).toBe(true)
 })
 it('preserves empty evidence, subject selection and missing profiles',async()=>{
 await reset();await sameForecast()
 const x=await val('select student_forecast_evidence_of($1,$2)',[U(2),AT])
 expect(x.subjects).toEqual([]);expect(x.evidence).toEqual([])
 })
 it('preserves weights, 180-day evidence, reward-window boundaries and future exclusions',async()=>{
 await reset()
 const data=[
 ['a',[1],1,'-1 day'],['b',[1,2],0.5,'-2 days'],['c',[1,2,3,4],0,'-3 days'],
 ['d',[],0,'-4 days'],['e',[1],0,'-30 days'],['f',[1],1,'-31 days'],
 ['g',[1],0.5,'-181 days'],['h',[1],1,'0 seconds'],['i',[1],0,'1 second'],
 ]
 for(const [item,ns,score,offset] of data)
 await db.query("insert into evidence_fixture values ($1,'math',$2,'catalog',$3,$4::timestamptz+$5::interval,$6,null)",[U(1),ns,score,AT,offset,item])
 await sameForecast()
 for(const window of [7,180,300]){
 await db.query("select set_config('test.window',$1,false)",[String(window)]);await sameForecast()
 }
 })
 it('collects evidence once instead of twice',async()=>{
 await reset();await db.exec('alter sequence evidence_calls restart with 1')
 await forecast('student_forecast_evidence_before')
 expect(await val('select last_value::int from evidence_calls')).toBe(2)
 await db.exec('alter sequence evidence_calls restart with 1');await forecast()
 expect(await val('select last_value::int from evidence_calls')).toBe(1)
 })
 it('preserves streaks, record, future exclusion, date clamp and visits',async()=>{
 await reset()
 await db.exec(`insert into day_fixture select '${U(1)}',((now() at time zone 'Europe/Moscow')::date)+d from unnest(array[-5,-4,-3,-1,0,1]) d;
 insert into app_visits values ('${U(1)}',(now() at time zone 'Europe/Moscow')::date)`)
 for(const days of [null,1,7,84,500]){
 const a=await val('select student_home_activity($1)',[days])
 expect(a).toEqual(await val('select student_home_activity_before($1)',[days]))
 expect(a.streak).toBe(2);expect(a.record).toBe(3);expect(a.solved_today).toBe(true)
 }
 })
 it('collects solve days once and still rejects an anonymous user',async()=>{
 await reset();await db.exec('alter sequence day_calls restart with 1')
 await val('select student_home_activity_before(84)');expect(await val('select last_value::int from day_calls')).toBe(2)
 await db.exec('alter sequence day_calls restart with 1')
 await val('select student_home_activity(84)');expect(await val('select last_value::int from day_calls')).toBe(1)
 await db.exec("select set_config('test.uid','',false);set role authenticated")
 await expect(db.query('select student_home_activity(84)')).rejects.toThrow(/нужен вход/)
 await db.exec('reset role')
 })
})

