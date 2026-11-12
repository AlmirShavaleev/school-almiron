import { describe,it,expect,vi } from 'vitest'
vi.mock('@/lib/supabase',()=>({supabase:{}}))
import { financeReport,financeCsv,mskMonth,shiftMonth,csvCell,type FinanceSnapshot,type FinancePayment } from '../finance'
const p=(id:string,extra:Partial<FinancePayment>={}):FinancePayment=>({id,student_id:'s1',course_id:'c1',subscription_id:'sub1',kind:'initial',status:'succeeded',amount_rub:500,is_test:true,created_at:'2026-11-03T10:00:00Z',paid_at:'2026-11-03T10:00:00Z',refunded_at:null,period_end:'2026-12-03T10:00:00Z',is_first:true,...extra})
const fixture=(payments:FinancePayment[]=[]):FinanceSnapshot=>({now:'2026-11-12T10:00:00Z',courses:[{id:'c1',title:'Физика'},{id:'c2',title:'Математика'}],unknown_payments:0,payments,refunds:[],subscriptions:[{id:'sub1',student_id:'s1',course_id:'c1',status:'active',access_until:'2026-11-15T10:00:00Z',auto_renew:false,source:'purchase',full_name:'Ученик',email:'test@example.com',is_test:true}],enrollments:[{student_id:'s1',course_id:'c1',full_name:'Ученик',email:'test@example.com'},{student_id:'s2',course_id:'c1',full_name:'Без оплаты',email:'none@example.com'}]})
describe('финансовые расчёты',()=>{
 it('реальные, тестовые и неизвестные режимы не смешиваются',()=>{
  const d=fixture([p('test'),p('real',{is_test:false,amount_rub:1500}),p('unknown',{is_test:null,amount_rub:9000}),p('failed',{status:'canceled',paid_at:null})])
  expect(financeReport(d,'2026-11','','real').gross).toBe(1500)
  expect(financeReport(d,'2026-11','','test').gross).toBe(500)
 })
 it('ручная повторная оплата является продлением даже с kind initial',()=>{
  const r=financeReport(fixture([p('first'),p('manual',{is_first:false}),p('auto',{is_first:false,kind:'renewal'})]),'2026-11','','test')
  expect(r).toMatchObject({newCount:1,newRevenue:500,renewCount:2,renewRevenue:1000,automaticRenewals:1,manualRenewals:1,average:500})
 })
 it('месяцы считаются по Москве, сравнение и дневная сумма согласованы',()=>{
  expect(mskMonth('2026-10-31T21:30:00Z')).toBe('2026-11')
  const r=financeReport(fixture([p('now',{paid_at:'2026-10-31T21:30:00Z',amount_rub:600}),p('prev',{paid_at:'2026-10-03T10:00:00Z',amount_rub:500})]),'2026-11','','test')
  expect(r).toMatchObject({gross:600,previous:500,change:20})
  expect(r.daily[0].amount).toBe(600)
  expect(r.daily[29].amount).toBeNull()
  expect(r.monthly.at(-1)?.newRevenue).toBe(600)
 })
 it('возврат учитывается в месяце возврата, а оплата остаётся в поступлениях',()=>{
  const d=fixture([p('full',{status:'refunded',refunded_at:'2026-11-05T10:00:00Z',paid_at:'2026-10-05T10:00:00Z'}),p('partial')]);d.refunds=[{id:'r1',payment_id:'partial',at:'2026-11-06T10:00:00Z',amount_rub:100}]
  expect(financeReport(d,'2026-11','','test')).toMatchObject({gross:500,refunds:600,net:-100})
 })
 it('фильтр курса применяется к графикам, итогам и спискам',()=>{
  const r=financeReport(fixture([p('a'),p('b',{course_id:'c2',amount_rub:1000})]),'2026-11','c2','test')
  expect(r.gross).toBe(1000);expect(r.byCourse).toHaveLength(1);expect(r.byCourse[0].id).toBe('c2');expect(r.attention.unpaid).toHaveLength(0)
 })
 it('списки текущие: срок, отсутствие доступа, последующая успешная оплата закрывает попытку',()=>{
  const d=fixture([p('old',{status:'pending',paid_at:null,created_at:'2026-11-01T00:00:00Z'}),p('ok')]);const r=financeReport(d,'2026-10','','test')
  expect(r.attention.ending).toHaveLength(1);expect(r.attention.unpaid.map(x=>x.student_id)).toEqual(['s2']);expect(r.attention.pending).toHaveLength(0)
 })
 it('непродление считается по концу оплаченного периода и состоянию на конец месяца',()=>{
  const d=fixture([p('oct',{paid_at:'2026-10-01T10:00:00Z',period_end:'2026-11-01T10:00:00Z'})]);let r=financeReport(d,'2026-11','','test');expect(r.monthly.at(-1)?.notRenewed).toBe(1)
  d.payments.push(p('nov',{is_first:false,paid_at:'2026-11-03T10:00:00Z',period_end:'2026-12-03T10:00:00Z'}));r=financeReport(d,'2026-11','','test');expect(r.monthly.at(-1)?.notRenewed).toBe(0)
 })
 it('десятичные суммы не накапливают погрешность; пустой период не делится на ноль',()=>{
  expect(financeReport(fixture([p('a',{amount_rub:.1}),p('b',{amount_rub:.2})]),'2026-11','','test').gross).toBe(.3)
  expect(financeReport(fixture(),'2026-11','','real')).toMatchObject({average:0,change:null})
  expect(shiftMonth('2026-01',-1)).toBe('2025-12')
 })
 it('CSV содержит выбранные успешные оплаты и защищает формулы в ячейках',()=>{
  const csv=financeCsv(fixture([p('test'),p('real',{is_test:false})]),'2026-11','','test')
  expect(csv).toContain('"test"');expect(csv).not.toContain('"real"');expect(csvCell(' =1+1')).toBe('"\' =1+1"')
 })
})
