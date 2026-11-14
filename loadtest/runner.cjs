'use strict'
/**
 * Fail-closed preflight. No network load is allowed before this script succeeds.
 * Commands: node runner.cjs preflight | main | pr4
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { URL } = require('node:url')
const root = __dirname
const PROD_SUPABASE_REFS = new Set([
  'kthfozyfruorwjhvvsbw', // Live School -- never use
  'wdypvzzfaewwgknpdmba', // Other existing projects are not load-test clones
  'ceuvlrszijebsscsrnqk',
  'oonewmfgziiiqhpiybvx',
])
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
}
function ensure(ok, text) { if (!ok) throw new Error('PRE-FLIGHT BLOCKED: ' + text) }
function checkUrl(value, type) {
  const u = new URL(value)
  ensure(u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash, type + ' must be clean HTTPS')
  ensure(u.pathname === '/', type + ' must be site origin, not deep link')
  ensure(!/(^|\.)alminion\.ru$|(^|\.)almiron\.ru$|(^|\.)school-almiron\.ru$/i.test(u.hostname), type + ' points to an owned production domain')
  ensure(!/localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(u.hostname), type + ' cannot be localhost in a shared DB comparison')
  if (type === 'app') {
    ensure(u.hostname.endsWith('.vercel.app'), 'only dedicated Vercel preview deployment domains are allowed')
    ensure(u.hostname !== 'school-almiron.vercel.app', 'stable production alias is forbidden')
    ensure(/-[a-z0-9]{7,}\.vercel\.app$/i.test(u.hostname), 'must be an immutable, deployment-specific preview URL')
  } else {
    ensure(u.hostname.endsWith('.supabase.co'), 'Supabase must be hosted project, not arbitrary URL')
    const ref = u.hostname.split('.')[0]
    ensure(/^[a-z]{20}$/.test(ref) && !PROD_SUPABASE_REFS.has(ref), 'Supabase ref must be a NEW, dedicated test project')
  }
  return u.origin
}
function validate(config, csv) {
  ensure(config && config.main && config.pr4, 'targets.local.json requires main and pr4')
  for (const version of ['main', 'pr4']) {
    const t = config[version]
    ensure(t && t.isolatedDbVerified === true && t.previewBuildVerified === true,
      version + ': manual verification of test DB and deployed build required')
    ensure(t.readOnlyFixtureConfirmed === true, version + ': seeded fixtures must contain ONLY synthetic students')
    ensure(typeof t.expectedCommit === 'string' && /^[a-f0-9]{40}$/i.test(t.expectedCommit), 'expected commit SHA required')
    checkUrl(t.url, 'app')
    checkUrl(t.supabaseUrl, 'supabase')
  }
  ensure(config.main.expectedCommit === '6f6e1a849d844dba3d6ed498cf22327b728d4893', 'main SHA mismatch')
  ensure(config.pr4.expectedCommit === 'd0eeee0dd990ce062515ee5311866997c6444fc4', 'PR #4 SHA mismatch')
  ensure(config.main.url !== config.pr4.url, 'main and PR must be distinct preview deployments')
  ensure(config.main.supabaseUrl === config.pr4.supabaseUrl, 'main and PR must use same dedicated test Supabase instance')
  const lines = csv.trim().split(/\r?\n/)
  ensure(lines.length === 21, 'exactly 20 test students + one header are required')
  ensure(lines[0] === 'email,password,groupId,topicId', 'fixture CSV header must match')
  const ids = new Set(), emails = new Set()
  for (const [idx,line] of lines.slice(1).entries()) {
    const row = line.split(',')
    ensure(row.length === 4, 'CSV entry ' + (idx+1) + ' must have 4 fields with no commas')
    const [email,password,groupId,topicId] = row
    ensure(/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email) &&
      /^(loadtest|lt)-/i.test(email.split('@')[0]), 'account ' + (idx+1) + ' must be explicitly synthetic')
    ensure(password.length >= 12 && password !== 'REPLACE_PASSWORD', 'set strong test-only password')
    ensure(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(groupId) && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(topicId),
      'valid seeded group/topic UUIDs required')
    ensure(!emails.has(email) && !ids.has(groupId + ':' + topicId), 'duplicate accounts or group/topic pairs')
    emails.add(email); ids.add(groupId + ':' + topicId)
  }
  return true
}
async function verifyDeployedAssets(config) {
  // Safety proof: inspect the actual served SPA bundle for isolated Supabase URL.
  // This is only a small number of GET requests; not a load run.
  for (const version of ['main','pr4']) {
    const t = config[version]
    const htmlResponse = await fetch(t.url, { signal: AbortSignal.timeout(15_000), redirect:'error' })
    ensure(htmlResponse.ok, version + ': preview not reachable')
    const html = await htmlResponse.text()
    const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"/i)
      || html.match(/<script[^>]*src="([^"]+\.js)"[^>]*type="module"/i)
    ensure(match, version + ': cannot locate built JavaScript asset')
    const assetUrl = new URL(match[1], t.url)
    ensure(assetUrl.origin === new URL(t.url).origin, 'unexpected cross-origin bundle')
    const scriptResponse = await fetch(assetUrl, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
    ensure(scriptResponse.ok, version + ': bundle not reachable')
    const js = await scriptResponse.text()
    ensure(js.includes(t.supabaseUrl), version + ': deployed bundle does not prove isolated Supabase connection')
    for (const ref of PROD_SUPABASE_REFS) ensure(!js.includes(ref), version + ': production/other Supabase ref in bundle')
    process.stdout.write('verified deployed frontend assets: ' + version + '\n')
  }
}
async function main() {
  const command = process.argv[2]
  ensure(['preflight','main','pr4'].includes(command), 'usage: node runner.cjs preflight|main|pr4')
  ensure(fs.existsSync(path.join(root,'targets.local.json')), 'targets.local.json missing')
  ensure(fs.existsSync(path.join(root,'students.local.csv')), 'students.local.csv missing')
  const config=readJson('targets.local.json')
  validate(config,fs.readFileSync(path.join(root,'students.local.csv'),'utf8'))
  await verifyDeployedAssets(config)
  if (command==='preflight') { console.log('Preflight passed, NO load executed.');return }
  ensure(process.env.LOADTEST_EXECUTE === 'I_CONFIRM_ISOLATED_LOADTEST', 'explicit opt-in required to start workload')
  const target=config[command]
  const resultDir=path.join(root,'results')
  fs.mkdirSync(resultDir,{recursive:true})
  const out=path.join(resultDir,command+'.json')
  const artifact=path.join(resultDir,command+'.guard.json')
  fs.writeFileSync(artifact,JSON.stringify({
    version:command,expectedCommit:target.expectedCommit,origin:target.url,
    isolatedSupabase:target.supabaseUrl,concurrency:20,
    executedAt:new Date().toISOString()
  },null,2))
  const cmd=process.platform==='win32'?'npx.cmd':'npx'
  const args=['--no-install','artillery','run','--output',out,'artillery.yml']
  const exec=spawnSync(cmd,args,{cwd:root,stdio:'inherit',shell:false,env:{
    ...process.env,
    LOADTEST_ARMED:'isolated-20vu',
    LOADTEST_TARGET_URL:target.url,
    LOADTEST_SUPABASE_URL:target.supabaseUrl,
  }})
  ensure(!exec.error && exec.status===0,command+' load test failed; do not compare incomplete results')
  console.log('Result:',out)
}
if (require.main===module) main().catch(e=>{ console.error(e.message); process.exitCode=1 })
module.exports={validate,checkUrl}
