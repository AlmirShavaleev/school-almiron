'use strict'
const fs=require('node:fs')
const path=require('node:path')
const root=__dirname
function get(filename){return JSON.parse(fs.readFileSync(path.join(root,'results',filename+'.json'),'utf8'))}
function metrics(result){
  const a=result.aggregate||result
  const h={...(a.histograms||{}),...(a.summaries||{})}
  const counts=a.counters||{}
  const one=name=>{
    const x=h[name]||{}
    return {p50:x.p50??x.median??null,p95:x.p95??null,p99:x.p99??null,mean:x.mean??null}
  }
  const keys=['almiron.my_courses_ready.ms','almiron.course_ready.ms','almiron.topic_ready.ms','almiron.return_my_courses_ready.ms','browser.page.lcp','http.response_time']
  return {sessions:{started:counts['vusers.created']??null,completed:counts['vusers.completed']??null,failed:counts['vusers.failed']??null},
   apiCalls:counts['almiron.api_requests']??null,
   requestCounts:Object.fromEntries(Object.entries(counts).filter(([k])=>k.startsWith('almiron.api.'))),
   latencies:Object.fromEntries(keys.map(k=>[k,one(k)]))}
}
function percentChange(a,b){return typeof a==='number' && typeof b==='number' && a>0?Math.round((b/a-1)*1000)/10:null}
function main(){
  const pre=get('main'),post=get('pr4'),b=metrics(pre),p=metrics(post)
  if(b.sessions.failed || p.sessions.failed) throw Error('Some VUs failed. Results may not be comparable.')
  if(b.sessions.completed!==20 || p.sessions.completed!==20) throw Error('Both runs must complete exactly 20 sessions.')
  const comparison={generatedAt:new Date().toISOString(),baseline:b,pr4:p,differences:{
     apiCallsPct:percentChange(b.apiCalls,p.apiCalls),
     readyP50Pct:Object.fromEntries(Object.keys(b.latencies).map(k=>[k,percentChange(b.latencies[k].p50,p.latencies[k].p50)])),
     readyP95Pct:Object.fromEntries(Object.keys(b.latencies).map(k=>[k,percentChange(b.latencies[k].p95,p.latencies[k].p95)])),
  }}
  const output=path.join(root,'results','comparison.json')
  fs.writeFileSync(output,JSON.stringify(comparison,null,2))
  console.log('Main vs PR#4 (negative change is faster/fewer):')
  console.table(Object.keys(b.latencies).map(k=>({
    measurement:k,main_p50:b.latencies[k].p50,pr4_p50:p.latencies[k].p50,
    delta_p50_pct:comparison.differences.readyP50Pct[k],main_p95:b.latencies[k].p95,pr4_p95:p.latencies[k].p95,
    delta_p95_pct:comparison.differences.readyP95Pct[k],
  })))
  console.log('API requests:',b.apiCalls,'→',p.apiCalls,'change',comparison.differences.apiCallsPct+'%')
  console.log('saved',output)
}
try{main()}catch(e){console.error('Cannot compare:',e.message);process.exitCode=1}
