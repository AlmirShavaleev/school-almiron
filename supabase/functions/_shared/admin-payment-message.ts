export interface AdminPaymentMessage {
 studentName:string; courseTitle:string; amountRub:number; paidAt:string|null;
 isTest:boolean|null; firstPayment:boolean; automatic:boolean; accessUntil:string|null;
}
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
const when=(s:string|null)=>s&&Number.isFinite(Date.parse(s))?new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(s)):'—'
export function adminPaymentMessage(p:AdminPaymentMessage){
 const label=p.isTest===true?'🧪 Тестовая оплата':p.isTest===false?'💳 Получена оплата':'💳 Оплата · режим не проверен'
 const type=p.firstPayment?'Новая подписка':p.automatic?'Автопродление':'Продление вручную'
 const sum=new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(p.amountRub)
 return `<b>${label}</b>\n\nУченик: <b>${escape(p.studentName)}</b>\nКурс: ${escape(p.courseTitle)}\nСумма: <b>${sum}</b>\nТип: ${type}\nОплачено: ${when(p.paidAt)} МСК\nДоступ до: ${when(p.accessUntil)} МСК`+(p.isTest===true?'\n\nРеальные деньги не списывались.':'')
}
