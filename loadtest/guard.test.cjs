'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {validate,checkUrl}=require('./runner.cjs')
const {safelyAllowedRequest}=require('./flows.cjs')
const COMMIT_MAIN='6f6e1a849d844dba3d6ed498cf22327b728d4893'
const COMMIT_PR='d0eeee0dd990ce062515ee5311866997c6444fc4'
const supabase='https://abcdefghijklmnopqrst.supabase.co'
function cfg(){
 const root={isolatedDbVerified:true,previewBuildVerified:true,readOnlyFixtureConfirmed:true,supabaseUrl:supabase}
 return {main:{...root,url:'https://almiron-main-abcde12345.vercel.app',expectedCommit:COMMIT_MAIN},
  pr4:{...root,url:'https://almiron-pr4-123abc456.vercel.app',expectedCommit:COMMIT_PR}}
}
function csv(){
 return ['email,password,groupId,topicId',...Array.from({length:20},(_,i)=>{
  const id=String(i+1).padStart(12,'0'), topic=String(i+101).padStart(12,'0')
  return 'loadtest-'+(i+1)+'@example.test,password1234567,00000000-0000-4000-8000-'+id+',00000000-0000-4000-8000-'+topic
 })].join('\n')
}
test('fixture: 20 unique synthetic students and isolated previews pass',()=>assert.equal(validate(cfg(),csv()),true))
test('live School Supabase always blocked',()=>{
 const c=cfg(); c.main.supabaseUrl='https://kthfozyfruorwjhvvsbw.supabase.co'
 assert.throws(()=>validate(c,csv()),/NEW, dedicated/)
})
test('preview deployment cannot use production alias',()=>{
 assert.throws(()=>checkUrl('https://school-almiron.vercel.app/','app'),/stable production alias/)
 assert.throws(()=>checkUrl('https://alminion.ru/','app'),/production/)
})
test('both previews must share one isolated project',()=>{
 const c=cfg();c.pr4.supabaseUrl='https://zyxwvutsrqponmlkjihg.supabase.co'
 assert.throws(()=>validate(c,csv()),/same dedicated/)
})
test('20 different fixture identities mandatory',()=>{
 assert.throws(()=>validate(cfg(),csv().replace('loadtest-20@','loadtest-19@')),/duplicate/)
 assert.throws(()=>validate(cfg(),csv().split('\n').slice(0,-1).join('\n')),/exactly 20/)
})
test('unverified preview or database fails closed',()=>{
 const c=cfg();c.main.previewBuildVerified=false
 assert.throws(()=>validate(c,csv()),/manual verification/)
})
test('only explicit RPC allowlist and isolated auth are allowed',()=>{
 const req=(url,method)=>({url:()=>url,method:()=>method})
 const app='https://almiron-main-abcde12345.vercel.app'
 assert.equal(safelyAllowedRequest(req(supabase+'/rest/v1/rpc/my_course_access','POST'),app,supabase),true)
 assert.equal(safelyAllowedRequest(req(supabase+'/rest/v1/rpc/submit_mock_exam','POST'),app,supabase),false)
 assert.equal(safelyAllowedRequest(req(supabase+'/rest/v1/rpc/school_presence_touch','POST'),app,supabase),true)
 assert.equal(safelyAllowedRequest(req(supabase+'/rest/v1/group_students','PATCH'),app,supabase),false)
 assert.equal(safelyAllowedRequest(req(supabase+'/auth/v1/token','POST'),app,supabase),true)
 assert.equal(safelyAllowedRequest(req(supabase+'/auth/v1/signup','POST'),app,supabase),false)
 assert.equal(safelyAllowedRequest(req('https://kthfozyfruorwjhvvsbw.supabase.co/rest/v1/profiles','GET'),app,supabase),false)
})
