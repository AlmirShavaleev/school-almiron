// Read-only requests to YooKassa; this function never creates payments or changes access.
import { createClient } from 'jsr:@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
Deno.serve(async req => {
 if (req.method === 'OPTIONS') return new Response(null,{headers:cors})
 if (req.method !== 'POST') return json({error:'Method not allowed'},405)
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
 const token=(req.headers.get('Authorization')??'').replace(/^Bearer\s+/i,'')
 const {data:auth,error:authError}=await db.auth.getUser(token)
 if(authError||!auth.user)return json({error:'Нужен вход'},401)
 const {data:profile}=await db.from('profiles').select('role').eq('id',auth.user.id).single()
 if(!profile||!['admin','owner'].includes(profile.role))return json({error:'Только администратор'},403)
 const shop=Deno.env.get('SUBSCRIPTION_YK_SHOP_ID'),secret=Deno.env.get('SUBSCRIPTION_YK_SECRET_KEY')
 if(!shop||!secret)return json({verified:0,warning:'Магазин ЮKassa не настроен. Непроверенные оплаты исключены из сумм.'})
 const {data:payments,error}=await db.from('subscription_payments').select('id,yookassa_payment_id').is('is_test',null).not('yookassa_payment_id','is',null).order('created_at',{ascending:false}).limit(50)
 if(error)return json({error:'Не удалось загрузить платежи'},500)
 let verified=0,failed=0
 // Five GETs at a time, bounded to 50 records per dashboard refresh.
 for(let i=0;i<(payments?.length??0);i+=5){
   await Promise.all(payments!.slice(i,i+5).map(async p=>{
     try{
       const id=String(p.yookassa_payment_id)
       if(!/^[a-zA-Z0-9-]+$/.test(id)){failed++;return}
       const res=await fetch(`https://api.yookassa.ru/v3/payments/${id}`,{headers:{Authorization:`Basic ${btoa(`${shop}:${secret}`)}`},signal:AbortSignal.timeout(6000)})
       if(!res.ok){failed++;return}
       const obj=await res.json()
       if(obj.id!==id||typeof obj.test!=='boolean'){failed++;return}
       const {error:e}=await db.from('subscription_payments').update({is_test:obj.test,finance_verified_at:new Date().toISOString()}).eq('id',p.id).eq('yookassa_payment_id',id).is('is_test',null)
       if(e)failed++;else verified++
     }catch{failed++}
   }))
 }
 return json({verified,warning:failed?'Часть платежей не удалось проверить. Они не включены в финансовые суммы.':null})
})
