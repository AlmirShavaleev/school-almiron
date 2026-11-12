import { createClient } from 'jsr:@supabase/supabase-js@2'
import { adminPaymentMessage } from '../_shared/admin-payment-message.ts'
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
function equal(a:string,b:string){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}
Deno.serve(async req=>{
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 const secret=Deno.env.get('CRON_SECRET')
 if(!secret||!equal(req.headers.get('X-Cron-Secret')??'',secret))return json({error:'Unauthorized'},401)
 const token=Deno.env.get('TELEGRAM_BOT_TOKEN'),shop=Deno.env.get('SUBSCRIPTION_YK_SHOP_ID'),key=Deno.env.get('SUBSCRIPTION_YK_SECRET_KEY')
 const body=await req.json().catch(()=>({}))
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
 if(body?.health===true){
  let botReady=false,recipientReady=false
  try{
   if(token){
    const check=await fetch(`https://api.telegram.org/bot${token}/getMe`,{signal:AbortSignal.timeout(6000)})
    botReady=check.ok&&(await check.json())?.ok===true
    const {data:cfg}=await db.from('admin_payment_notification_settings').select('recipient_profile_id').eq('enabled',true).maybeSingle()
    if(botReady&&cfg){
     const {data:conn}=await db.from('telegram_connections').select('telegram_chat_id').eq('profile_id',cfg.recipient_profile_id).eq('is_enabled',true).is('disconnected_at',null).maybeSingle()
     if(conn){const chat=await fetch(`https://api.telegram.org/bot${token}/getChat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:conn.telegram_chat_id}),signal:AbortSignal.timeout(6000)});recipientReady=chat.ok&&(await chat.json())?.ok===true}
    }
   }
  }catch{/* Credentials and Telegram URLs must never enter logs. */}
  return json({ready:botReady&&recipientReady,botReady,recipientReady,yookassa:!!shop&&!!key})
 }
 if(!token)return json({error:'Bot not configured'},503)
 const {data:items,error}=await db.rpc('claim_admin_payment_notifications',{p_limit:10})
 if(error)return json({error:'Queue unavailable'},500)
 let sent=0,failed=0
 for(const item of items??[]){
  try{
   const {data:recipient}=await db.from('profiles').select('role').eq('id',item.recipient_profile_id).single()
   const {data:conn}=await db.from('telegram_connections').select('telegram_chat_id,is_enabled').eq('profile_id',item.recipient_profile_id).is('disconnected_at',null).maybeSingle()
   if(!recipient||!['admin','owner'].includes(recipient.role)||!conn?.is_enabled||!conn.telegram_chat_id){await db.from('admin_payment_notifications').update({status:'cancelled',last_error:'recipient_unavailable'}).eq('id',item.id);continue}
   const {data:p}=await db.from('subscription_payments').select('id,student_id,subscription_id,status,amount_rub,paid_at,is_test,kind,yookassa_payment_id').eq('id',item.payment_id).single()
   if(p?.status==='refunded'){await db.from('admin_payment_notifications').update({status:'cancelled',last_error:'payment_refunded_before_delivery'}).eq('id',item.id);continue}
   if(!p||p.status!=='succeeded')throw new Error('payment_not_confirmed')
   const {data:sub}=await db.from('student_subscriptions').select('course_id,access_until').eq('id',p.subscription_id).single()
   const {data:st}=await db.from('students').select('profile_id').eq('id',p.student_id).single()
   const {data:student}=await db.from('profiles').select('full_name').eq('id',st?.profile_id??'').single()
   const {data:course}=await db.from('courses').select('title').eq('id',sub?.course_id??'').single()
   if(!sub||!student||!course)throw new Error('payment_details_unavailable')
   let isTest=p.is_test as boolean|null
   if(isTest===null&&shop&&key&&p.yookassa_payment_id){
    const res=await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(p.yookassa_payment_id)}`,{headers:{Authorization:`Basic ${btoa(`${shop}:${key}`)}`},signal:AbortSignal.timeout(6000)})
    if(res.ok){const verified=await res.json();if(verified.id===p.yookassa_payment_id&&typeof verified.test==='boolean'){isTest=verified.test;await db.from('subscription_payments').update({is_test:isTest,finance_verified_at:new Date().toISOString()}).eq('id',p.id)}}
   }
   let history=db.from('subscription_payments').select('id',{count:'exact',head:true}).eq('subscription_id',p.subscription_id).not('paid_at','is',null).lt('paid_at',p.paid_at)
   if(isTest!==null)history=history.eq('is_test',isTest)
   const {count,error:countError}=await history
   if(countError)throw new Error('payment_history_unavailable')
   const text=adminPaymentMessage({studentName:student.full_name||'Без имени',courseTitle:course.title,amountRub:Number(p.amount_rub),paidAt:p.paid_at,isTest,firstPayment:!count,automatic:p.kind==='renewal',accessUntil:sub.access_until})
   const res=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:conn.telegram_chat_id,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:'Открыть финансы',url:'https://alminion.ru/admin/finance'}]]}}),signal:AbortSignal.timeout(10000)})
   const result=await res.json().catch(()=>null)
   if(!res.ok||result?.ok!==true)throw new Error(`telegram_http_${res.status}`)
   const {error:finishError}=await db.from('admin_payment_notifications').update({status:'sent',sent_at:new Date().toISOString(),last_error:null}).eq('id',item.id)
   if(finishError)throw new Error('delivery_record_failed')
   sent++
  }catch(e){failed++;const message=e instanceof Error?e.message:'';const reason=/^(payment_not_confirmed|payment_details_unavailable|payment_history_unavailable|telegram_http_\d{3}|delivery_record_failed)$/.test(message)?message:'delivery_failed';await db.from('admin_payment_notifications').update({status:item.attempts>=3?'failed':'pending',next_attempt_at:new Date(Date.now()+item.attempts*60000).toISOString(),last_error:reason.slice(0,160)}).eq('id',item.id)}
 }
 return json({sent,failed})
})
