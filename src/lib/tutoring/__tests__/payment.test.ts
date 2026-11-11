import { describe, expect, it } from 'vitest'
import { verifiedTutoringPayment } from '../../../../supabase/functions/tutoring-payment/verify'
import { canReschedule, moscowDate, moscowTime, type Booking } from '../api'
const booking={ id:'b1',yookassa_id:'yk1',amount_rub:1500 }
const good={ id:'yk1',test:true,status:'succeeded',metadata:{origin:'tutoring_v1',booking_id:'b1'},amount:{value:'1500.00',currency:'RUB'} }
describe('проверка платежа',()=>{
 it('принимает только настоящий тестовый платёж с точным назначением и суммой',()=>{expect(verifiedTutoringPayment(good,booking)).toBe(true)})
 it.each([
  {...good,test:false}, {...good,id:'other'}, {...good,status:'made-up'}, {...good,metadata:{origin:'subscription_282',booking_id:'b1'}},
  {...good,metadata:{origin:'tutoring_v1',booking_id:'b2'}}, {...good,amount:{value:'1.00',currency:'RUB'}}, {...good,amount:{value:'1500',currency:'USD'}}, null,
 ])('отклоняет чужой или неподходящий ответ %#',p=>expect(verifiedTutoringPayment(p,booking)).toBe(false))
 it('граница переноса — ровно два часа',()=>{const b={status:'paid',starts_at:'2026-11-20T12:00:00Z'} as Booking;expect(canReschedule(b,Date.parse('2026-11-20T10:00:00Z'))).toBe(true);expect(canReschedule(b,Date.parse('2026-11-20T10:00:01Z'))).toBe(false)})
 it('дата и часы показаны по Москве независимо от устройства',()=>{expect(moscowDate('2026-11-20T22:00:00Z')).toBe('2026-11-21');expect(moscowTime('2026-11-20T22:00:00Z')).toBe('01:00')})
})
