import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const db=new PGlite()
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
CREATE FUNCTION public.topic_material_can_manage(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.staff',true),'false')='true'$$;
CREATE FUNCTION public.course_student_can_see_topic(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT true$$;
CREATE FUNCTION public.auth_student_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT auth.uid()$$;
CREATE TABLE topics(id uuid primary key,source_topic_id uuid);
CREATE TABLE topic_autocheck_tasks(id uuid primary key,topic_id uuid,code text,position int,statement_path text,statement_md text,answer_type text,digits_any_order boolean,unit text,answer_value numeric,answer_tol numeric,answer_text text,solution_path text,solution_md text);
CREATE TABLE topic_autocheck_answers(task_id uuid,profile_id uuid,is_correct boolean,attempt_no int,answer_raw text);
CREATE TABLE topic_homework(id uuid,topic_id uuid);
CREATE TABLE topic_homework_attempts(homework_id uuid,student_id uuid,status text);
CREATE TABLE app_feature_flags(key text,enabled boolean);
CREATE FUNCTION public.topic_autocheck_task_closed(p_task_id uuid,p_profile_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(bool_or(is_correct) or count(*)>=3,false) FROM topic_autocheck_answers WHERE task_id=p_task_id AND profile_id=p_profile_id$$;
`)
await db.exec(readFileSync(new URL('../supabase/migrations/20261117073827_autocheck_solutions_after_finish.sql',import.meta.url),'utf8'))
const topic='00000000-0000-0000-0000-000000000001',uid='00000000-0000-0000-0000-000000000099'
await db.exec(`SELECT set_config('test.uid','${uid}',false); SELECT set_config('test.staff','false',false);
INSERT INTO topics(id,autocheck_solutions_after_finish) VALUES('${topic}',true);
INSERT INTO topic_autocheck_tasks(id,topic_id,code,position,statement_path,statement_md,answer_type,answer_value,solution_path,solution_md)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${topic}','D'||i,i,'statement'||i,'condition','number',i,'solution'||i,'secret solution' FROM generate_series(11,12)i;`)
const state=async()=> (await db.query(`SELECT topic_autocheck_state('${topic}') s`)).rows[0].s
const locked=s=>s.tasks.every(t=>t.solution_md===null&&t.solution_path===null&&t.answer_value===null)
assert(locked(await state()))
await db.exec(`INSERT INTO topic_autocheck_answers VALUES('00000000-0000-0000-0000-000000000011','${uid}',true,1,'11')`)
assert(locked(await state()),'one closed task must not reveal any solution')
assert.equal((await db.query(`select topic_solution_unlocked('${topic}') v`)).rows[0].v,false)
assert.equal((await db.query(`select topic_autocheck_object_visible('solution11') v`)).rows[0].v,false)
await db.exec(`INSERT INTO topic_autocheck_answers SELECT '00000000-0000-0000-0000-000000000012','${uid}',false,i,'0' FROM generate_series(1,3)i`)
let s=await state();assert(s.finished);assert.equal(s.grade,50);assert(s.tasks.every(t=>t.solution_md==='secret solution'))
assert.equal((await db.query(`select topic_solution_unlocked('${topic}') v`)).rows[0].v,true)
assert.equal((await db.query(`select topic_autocheck_object_visible('solution11') v`)).rows[0].v,true)
await db.exec(`DELETE FROM topic_autocheck_answers WHERE task_id='00000000-0000-0000-0000-000000000012'; UPDATE topics SET autocheck_solutions_after_finish=false`)
s=await state();assert.equal(s.tasks[0].solution_md,'secret solution');assert.equal(s.tasks[1].solution_md,null)
await db.exec(`INSERT INTO topics(id,autocheck_solutions_after_finish) VALUES('00000000-0000-0000-0000-000000000002',true); UPDATE topics SET source_topic_id='00000000-0000-0000-0000-000000000002' WHERE id='${topic}'`)
assert(locked(await state()),'copies inherit the template gate')
await db.exec(`SELECT set_config('test.staff','true',false)`)
assert((await state()).tasks.every(t=>t.solution_md==='secret solution'),'staff retain preview access')
console.log('PASS: unfinished/one closed/all closed/mixed failures/PDF/storage/legacy/copies/staff')
await db.close()
