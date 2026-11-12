import { supabase } from '@/lib/supabase'
export type FinanceMode='real'|'test'
export interface FinancePayment { id:string;student_id:string;course_id:string;subscription_id:string;kind:string;status:string;amount_rub:number;is_test:boolean|null;created_at:string;paid_at:string|null;refunded_at:string|null;period_end:string|null;is_first:boolean }
export interface FinanceSubscription { id:string;student_id:string;course_id:string;status:string;access_until:string|null;auto_renew:boolean;source:string;full_name:string;email:string;is_test:boolean|null }
export interface FinanceEnrollment { student_id:string;course_id:string;full_name:string;email:string }
export interface FinanceSnapshot { now:string;courses:{id:string;title:string}[];unknown_payments:number;payments:FinancePayment[];refunds:{id:string;payment_id:string;at:string;amount_rub:number}[];subscriptions:FinanceSubscription[];enrollments:FinanceEnrollment[] }
export interface AttentionRow extends FinanceEnrollment {access_until:string|null;auto_renew:boolean;note:string}
export const rub=(v:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(v)
export const mskMonth=(iso:string)=>new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(iso))
export const mskDay=(iso:string)=>new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(iso))
export function shiftMonth(month:string,delta:number){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7)}
export const monthLabel=(month:string)=>new Intl.DateTimeFormat('ru-RU',{month:'short',year:'2-digit',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`))
export const dateLabel=(iso:string|null)=>iso?new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Moscow'}).format(new Date(iso)):'—'
const sum=(items:FinancePayment[])=>items.reduce((n,p)=>n+Math.round(Number(p.amount_rub)*100),0)/100
const pair=(s:{student_id:string;course_id:string})=>`${s.student_id}:${s.course_id}`
export function financeReport(data:FinanceSnapshot,month:string,course:string,mode:FinanceMode){
 const matches=(s:{course_id:string})=>!course||s.course_id===course
 const env=(v:boolean|null)=>v!==null&&v===(mode==='test')
 const payments=data.payments.filter(p=>matches(p)&&env(p.is_test))
 const paid=payments.filter(p=>!!p.paid_at&&['succeeded','refunded'].includes(p.status))
 const inMonth=(p:FinancePayment,m=month)=>mskMonth(p.paid_at!)===m
 const selected=paid.filter(p=>inMonth(p)),fresh=selected.filter(p=>p.is_first),renew=selected.filter(p=>!p.is_first)
 const gross=sum(selected),previous=sum(paid.filter(p=>inMonth(p,shiftMonth(month,-1))))
 const ids=new Set(payments.map(p=>p.id))
 const partialRefunds=data.refunds.filter(r=>ids.has(r.payment_id)&&mskMonth(r.at)===month)
 const refunds=partialRefunds.reduce((n,r)=>n+Math.round(Number(r.amount_rub)*100),0)/100+sum(payments.filter(p=>p.refunded_at&&mskMonth(p.refunded_at)===month&&p.status==='refunded'))
 const now=Date.parse(data.now)
 const access=(s:FinanceSubscription)=>['trial','active','past_due'].includes(s.status)&&!!s.access_until&&Date.parse(s.access_until)>now
 const subs=data.subscriptions.filter(matches)
 const active=subs.filter(s=>access(s)&&env(s.is_test))
 const monthly=Array.from({length:12},(_,i)=>{
   const key=shiftMonth(month,i-11),rows=paid.filter(p=>inMonth(p,key))
   const end=Math.min(Date.parse(`${shiftMonth(key,1)}-01T00:00:00+03:00`),now)
   const latest=new Map<string,FinancePayment>()
   for(const p of paid.filter(p=>Date.parse(p.paid_at!)<end).sort((a,b)=>Date.parse(a.paid_at!)-Date.parse(b.paid_at!)))latest.set(pair(p),p)
   const expired=[...latest.values()].filter(p=>p.period_end&&mskMonth(p.period_end)===key&&Date.parse(p.period_end)<end)
   return {key,label:monthLabel(key),newRevenue:sum(rows.filter(p=>p.is_first)),renewRevenue:sum(rows.filter(p=>!p.is_first)),newCount:new Set(rows.filter(p=>p.is_first).map(pair)).size,renewCount:new Set(rows.filter(p=>!p.is_first).map(pair)).size,notRenewed:new Set(expired.map(pair)).size}
 })
 const days=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate()
 const daily=Array.from({length:days},(_,i)=>{const key=`${month}-${String(i+1).padStart(2,'0')}`;return {day:i+1,amount:key>mskDay(data.now)?null:sum(selected.filter(p=>mskDay(p.paid_at!)===key))}})
 const byCourse=data.courses.filter(c=>!course||c.id===course).map(c=>({...c,amount:sum(selected.filter(p=>p.course_id===c.id))})).sort((a,b)=>b.amount-a.amount)
 const attention=(s:FinanceSubscription,note:string):AttentionRow=>({...s,note})
 const ending=active.filter(s=>Date.parse(s.access_until!)<=now+7*86400000).sort((a,b)=>Date.parse(a.access_until!)-Date.parse(b.access_until!)).map(s=>attention(s,`Осталось ${Math.max(1,Math.ceil((Date.parse(s.access_until!)-now)/86400000))} дн.`))
 const expired=subs.filter(s=>env(s.is_test)&&s.status!=='pending'&&!access(s)&&s.access_until&&Date.parse(s.access_until)<=now).map(s=>attention(s,'Доступ закончился'))
 const unpaid=data.enrollments.filter(matches).filter(e=>!subs.some(s=>pair(s)===pair(e)&&access(s))).map(e=>({...e,access_until:null,auto_renew:false,note:'Нет действующей подписки'}))
 const pendingByPair=new Map<string,AttentionRow>()
 for(const p of payments.filter(p=>['created','pending','waiting_for_capture','canceled','failed'].includes(p.status)).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))){
   // A later successful payment closes the abandoned attempt for this list.
   if(paid.some(q=>q.subscription_id===p.subscription_id&&Date.parse(q.paid_at!)>=Date.parse(p.created_at)))continue
   const sub=subs.find(s=>s.id===p.subscription_id)
   if(sub)pendingByPair.set(pair(sub),attention(sub,p.status==='canceled'?'Платёж отменён':p.status==='failed'?'Ошибка оплаты':'Оплата не завершена'))
 }
 return {gross,refunds,net:gross-refunds,previous,change:previous>0?Math.round((gross-previous)/previous*100):null,newCount:fresh.length,newRevenue:sum(fresh),renewCount:renew.length,renewRevenue:sum(renew),automaticRenewals:renew.filter(p=>p.kind==='renewal').length,manualRenewals:renew.filter(p=>p.kind!=='renewal').length,activeStudents:new Set(active.map(s=>s.student_id)).size,activeSubscriptions:active.length,average:selected.length?gross/selected.length:0,monthly,daily,byCourse,attention:{ending,expired,unpaid,pending:[...pendingByPair.values()]}}
}
export function financePurchases(data:FinanceSnapshot,month:string,course:string,mode:FinanceMode){
 return data.payments.filter(p=>(!course||p.course_id===course)&&p.is_test===(mode==='test')&&p.paid_at&&mskMonth(p.paid_at)===month&&['succeeded','refunded'].includes(p.status))
  .map(p=>{const sub=data.subscriptions.find(s=>s.id===p.subscription_id);return {...p,full_name:sub?.full_name??'Без имени',email:sub?.email??'',course_title:data.courses.find(c=>c.id===p.course_id)?.title??'Курс'}})
  .sort((a,b)=>Date.parse(b.paid_at!)-Date.parse(a.paid_at!)||b.id.localeCompare(a.id))
}
export async function fetchFinance(month:string):Promise<FinanceSnapshot>{
 const {data,error}=await supabase.rpc('admin_finance_snapshot' as never,{p_month:`${month}-01`} as never)
 if(error)throw new Error(error.message)
 return data as unknown as FinanceSnapshot
}
export async function verifyFinancePayments():Promise<string|null>{
 const {data,error}=await supabase.functions.invoke('finance-sync',{body:{}})
 if(error)return 'Проверка режима платежей недоступна. Непроверенные суммы исключены.'
 return data?.warning??null
}
export function csvCell(value:unknown){const s=String(value??'');return '"'+(/^(\s*[=+\-@]|[\t\r])/.test(s)?"'"+s:s).replaceAll('"','""')+'"'}
export function financeCsv(data:FinanceSnapshot,month:string,course:string,mode:FinanceMode){
 const rows=data.payments.filter(p=>(!course||p.course_id===course)&&p.is_test===(mode==='test')&&p.paid_at&&mskMonth(p.paid_at)===month&&['succeeded','refunded'].includes(p.status))
 return '\uFEFF'+[['Платёж','Дата МСК','Курс','Ученик','Сумма ₽','Тип','Режим','Статус'],...rows.map(p=>{const s=data.subscriptions.find(s=>s.id===p.subscription_id);return [p.id,new Date(p.paid_at!).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}),data.courses.find(c=>c.id===p.course_id)?.title,s?.full_name??'',p.amount_rub,p.is_first?'Новая подписка':'Продление',mode==='test'?'Тестовый':'Реальный',p.status]})].map(r=>r.map(csvCell).join(';')).join('\r\n')
}
