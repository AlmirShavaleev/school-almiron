import {readFileSync,readdirSync} from 'node:fs'
import path from 'node:path'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,afterAll,describe,it,expect} from 'vitest'
const root=path.resolve(import.meta.dirname,'../../..')
const U=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const names=['student_exam_evidence_rows','student_solved_task_days','progress_open_by_student','_progress_state']
let db:PGlite
const fixture=(n:string)=>readFileSync(path.join(root,'src/test/sql',n),'utf8')
async function rows(sql:string,args:unknown[]=[]){return (await db.query(sql,args)).rows}
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(fixture('innerReadPlansStubs.sql'))
 let original=fixture('innerReadPlansBeforeOptimization.sql')
 // The before wrappers call the original progress helper, not the replacement.
 for(const n of names)original=original.replaceAll('public.'+n+'(', 'public.'+n+'_before(')
 await db.exec(original)
 await db.exec(fixture('innerReadPlansBeforeOptimization.sql'))
 await db.exec(`revoke all on function student_exam_evidence_rows(uuid,timestamptz),student_solved_task_days(uuid,date),
 progress_open_by_student(uuid[],uuid[]),_progress_state(uuid,uuid[]) from public,anon,authenticated;
 grant execute on function student_exam_evidence_rows(uuid,timestamptz),student_solved_task_days(uuid,date),
 progress_open_by_student(uuid[],uuid[]),_progress_state(uuid,uuid[]) to service_role;`)
 const staged=process.env.INNER_PLANS_MIGRATION
 const file=staged?path.resolve(root,staged):path.join(root,'supabase/migrations',readdirSync(path.join(root,'supabase/migrations')).find(f=>/^\d+_cache_inner_read_query_plans\.sql$/.test(f))!)
 await db.exec(readFileSync(file,'utf8'))
 const settings=process.env.INNER_PLAN_SETTINGS_MIGRATION
 const savedSettings=readdirSync(path.join(root,'supabase/migrations')).find(f=>/^\d+_reuse_generic_plans_for_inner_reads\.sql$/.test(f))
 if(settings||savedSettings)await db.exec(readFileSync(settings?path.resolve(root,settings):path.join(root,'supabase/migrations',savedSettings!),'utf8'))
 await db.exec(`
 insert into students values ('${U(1)}','${U(1)}'),('${U(2)}','${U(2)}');
 insert into courses values ('${U(10)}','math','ege');
 insert into groups values ('${U(11)}','${U(10)}');
 insert into group_students values ('${U(11)}','${U(1)}'),('${U(11)}','${U(2)}');
 insert into course_unlock_modes values ('${U(10)}','progress');
 insert into modules values ('${U(12)}','${U(10)}');
 insert into topics values ('${U(20)}','${U(12)}',array[1],null,1,null),
 ('${U(21)}','${U(12)}',array[2],null,2,null),('${U(22)}','${U(12)}',array[3],null,3,null);
 insert into topic_homework values ('${U(30)}','${U(20)}',false,'hundred',true);
 insert into topic_homework_attempts values ('${U(31)}','${U(30)}','${U(1)}','accepted',now()-interval '1 day',1,now()-interval '2 days');
 insert into topic_homework_reviews values ('${U(32)}','${U(31)}',75,now()-interval '1 hour');
 insert into topic_homework_review_tasks values ('${U(31)}',' 1 ','correct'),('${U(31)}','2','partial');
 insert into topic_autocheck_tasks values ('${U(33)}','${U(21)}');
 insert into topic_autocheck_answers values ('${U(1)}','${U(33)}',true,now()-interval '1 day');
 insert into catalog_sections values ('${U(40)}',1,'ЕГЭ','Математика',true);
 insert into catalog_tasks values ('${U(41)}','${U(40)}',true,null);
 insert into catalog_task_attempts values ('${U(42)}','${U(41)}','${U(1)}',now()-interval '5 days','wrong',false),
 ('${U(43)}','${U(41)}','${U(1)}',now()-interval '4 days','correct',false),
 ('${U(44)}','${U(41)}','${U(2)}',now()-interval '3 days','correct',false);
 insert into catalog_task_progress values ('${U(41)}','${U(1)}',true,now()-interval '4 days',now());
 insert into topic_test_assignments values ('${U(50)}','${U(20)}');
 insert into topic_test_items values ('${U(51)}','${U(41)}',2);
 insert into topic_test_attempts values ('${U(52)}','${U(1)}','${U(50)}','completed',now()-interval '3 days');
 insert into topic_test_answers values ('${U(53)}','${U(52)}','${U(51)}',1,false);
 insert into mock_exam_templates values ('${U(60)}',array[4]);
 insert into mock_exams values ('${U(61)}','math','ege','${U(60)}',now()-interval '2 days',now()-interval '2 days');
 insert into mock_exam_task_scores values ('${U(61)}','${U(1)}',1,3);
 insert into test_variant_items values ('${U(70)}','${U(41)}');
 insert into test_variant_student_assignments values ('${U(71)}','${U(1)}',now()-interval '1 day');
 insert into test_variant_answers values ('${U(72)}','${U(71)}','${U(70)}',true,2,now()-interval '1 day',null,null,now()-interval '1 day');
 `)
},60000)
afterAll(async()=>{await db?.close()})
const sorted=(r:unknown[])=>r.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
async function compare(name:string,args:unknown[],cast:string){
 const scalar=name==='progress_open_by_student'
 const a=sorted(await rows(scalar?'select '+name+'('+cast+') as value':'select * from '+name+'('+cast+')',args))
 const b=sorted(await rows(scalar?'select '+name+'_before('+cast+') as value':'select * from '+name+'_before('+cast+')',args))
 expect(a).toEqual(b);return a as any[]
}
describe('cached inner read plans',()=>{
 it('preserves all five evidence sources and scores',async()=>{
 const r=await compare('student_exam_evidence_rows',[U(1),'2000-01-01'],'$1::uuid,$2::timestamptz')
 expect(new Set(r.map(x=>x.source))).toEqual(new Set(['hw','test','mock','catalog']))
 expect(r.find(x=>x.item.startsWith('variant:')).score).toBe('0.5')
 expect(Number(r.find(x=>x.source==='mock').score)).toBe(0.75)
 expect(r.filter(x=>x.source==='hw')).toHaveLength(2)
 })
 it('keeps per-source solved counts and task deduplication',async()=>{
 const r=await compare('student_solved_task_days',[U(1),'2000-01-01'],'$1::uuid,$2::date')
 expect(r.reduce((n,x)=>n+(x.source==='catalog'?x.n:0),0)).toBe(1)
 expect(new Set(r.map(x=>x.source))).toEqual(new Set(['hw','catalog','mock','test']))
 })
 it('keeps students separated after repeated calls and date parameter changes',async()=>{
 for(let i=0;i<12;i++){
 const uid=U(i%2+1),date=i%3===0?'2099-01-01':'2000-01-01'
 await compare('student_exam_evidence_rows',[uid,date],'$1::uuid,$2::timestamptz')
 await compare('student_solved_task_days',[uid,date],'$1::uuid,$2::date')
 }
 })
 it('keeps progress state and open maps after plan reuse for different students',async()=>{
 for(let i=0;i<12;i++){
 const ids=[U(i%2+1)]
 await compare('_progress_state',[U(10),ids],'$1::uuid,$2::uuid[]')
 await compare('progress_open_by_student',[[U(10)],ids],'$1::uuid[],$2::uuid[]')
 }
 const r=await rows('select * from _progress_state($1,$2)',[U(10),[U(1),U(2)]]) as any[]
 expect(r.find(x=>x.student_id===U(1)&&x.topic_id===U(22)).open).toBe(true)
 expect(r.find(x=>x.student_id===U(2)&&x.topic_id===U(22)).open).toBe(false)
 })
 it('does not cache data: later results, subscriptions and overrides are visible',async()=>{
 await db.exec(`insert into student_topic_overrides values ('${U(1)}','${U(22)}','closed');
 insert into student_subscriptions values ('${U(2)}','${U(10)}','trial','trial',now()+interval '1 day')`)
 await compare('_progress_state',[U(10),[U(1),U(2)]],'$1::uuid,$2::uuid[]')
 await db.exec(`insert into catalog_task_progress values ('${U(99)}','${U(2)}',true,now(),now())`)
 await compare('student_solved_task_days',[U(2),'2000-01-01'],'$1::uuid,$2::date')
 await db.exec('delete from student_topic_overrides;delete from student_subscriptions')
 })
 it('keeps results across generic/custom planning modes and changing arguments',async()=>{
 for(const mode of ['force_generic_plan','force_custom_plan']){
 await db.exec('set plan_cache_mode='+mode)
 for(let i=0;i<8;i++){
 const id=U(i%2+1)
 await compare('student_exam_evidence_rows',[id,'2000-01-01'],'$1::uuid,$2::timestamptz')
 await compare('student_solved_task_days',[id,'2000-01-01'],'$1::uuid,$2::date')
 await compare('_progress_state',[U(10),[id]],'$1::uuid,$2::uuid[]')
 await compare('progress_open_by_student',[[U(10)],[id]],'$1::uuid[],$2::uuid[]')
 }
 }
 await db.exec('reset plan_cache_mode')
 })
 it('preserves empty and missing filters and does not expose internal helpers to the browser',async()=>{
 for(const args of [[null,null],[[],null],[null,[]],[[U(10)],[]],[null,[U(99)]]])
 await compare('progress_open_by_student',args,'$1::uuid[],$2::uuid[]')
 await compare('student_exam_evidence_rows',[U(99),'2000-01-01'],'$1::uuid,$2::timestamptz')
 for(const sig of ['student_exam_evidence_rows(uuid,timestamptz)','student_solved_task_days(uuid,date)','progress_open_by_student(uuid[],uuid[])','_progress_state(uuid,uuid[])']){
 const r=await rows("select has_function_privilege('authenticated',$1,'execute') as allowed",[sig]) as any[]
 expect(r[0].allowed).toBe(false)
 }
 })
 it('restores the caller planning mode after each helper returns',async()=>{
 await db.exec('set plan_cache_mode=force_custom_plan')
 await rows('select * from student_exam_evidence_rows($1,$2)',[U(1),'2000-01-01'])
 await rows('select * from _progress_state($1,$2)',[U(10),[U(1)]])
 const r=await rows("select current_setting('plan_cache_mode') as mode") as any[]
 expect(r[0].mode).toBe('force_custom_plan')
 await db.exec('reset plan_cache_mode')
 })
})

