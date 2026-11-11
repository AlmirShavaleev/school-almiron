/** Only a verified test payment belonging to this booking may update access. */
export function verifiedTutoringPayment(payment: unknown, booking: { id: string; yookassa_id: string; amount_rub: number }): boolean {
 if (!payment || typeof payment !== 'object') return false
 const p=payment as Record<string,unknown>
 const meta=p.metadata as Record<string,unknown>|undefined
 const amount=p.amount as Record<string,unknown>|undefined
 const sum=typeof amount?.value==='string' && /^\d+(\.\d{1,2})?$/.test(amount.value) ? Number(amount.value) : NaN
 return p.test===true && p.id===booking.yookassa_id && meta?.origin==='tutoring_v1' && meta.booking_id===booking.id
  && amount?.currency==='RUB' && Number.isFinite(sum) && sum===Number(booking.amount_rub)
  && typeof p.status==='string' && ['pending','waiting_for_capture','succeeded','canceled'].includes(p.status)
}
