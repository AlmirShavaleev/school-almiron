import { describe,it,expect } from 'vitest'
import { adminPaymentMessage } from '../../../supabase/functions/_shared/admin-payment-message'
const p={studentName:'Иван <Петров>',courseTitle:'Физика & ЕГЭ',amountRub:1500,paidAt:'2026-11-12T12:00:00Z',isTest:true,firstPayment:true,automatic:false,accessUntil:'2026-12-12T12:00:00Z'}
describe('уведомление админу об оплате',()=>{
 it('содержит имя, курс, сумму, тип и московское время',()=>{
  const text=adminPaymentMessage(p)
  expect(text).toContain('Иван &lt;Петров&gt;');expect(text).toContain('Физика &amp; ЕГЭ')
  expect(text).toMatch(/1\s*500.*₽/);expect(text).toContain('Новая подписка');expect(text).toContain('15:00')
  expect(text).toContain('Тестовая оплата');expect(text).toContain('Реальные деньги не списывались')
 })
 it('разделяет ручные и автоматические продления',()=>{
  expect(adminPaymentMessage({...p,firstPayment:false})).toContain('Продление вручную')
  expect(adminPaymentMessage({...p,firstPayment:false,automatic:true})).toContain('Автопродление')
 })
 it('не называет неизвестный режим реальным или тестовым',()=>{
  const text=adminPaymentMessage({...p,isTest:null})
  expect(text).toContain('режим не проверен');expect(text).not.toContain('Реальные деньги не списывались')
  expect(adminPaymentMessage({...p,isTest:false})).toContain('Получена оплата')
 })
})
