import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, Clock, Video, ArrowRight, CheckCircle } from 'lucide-react'
import { rememberTutoringIntent, clearTutoringIntent } from '@/lib/tutoring/intent'
import { useAuthStore } from '@/store/authStore'
import { canReschedule, moscowDate, moscowFull, moscowTime, payment, STATUS, tutoringRpc, type Booking, type CalendarData } from '@/lib/tutoring/api'

export function TutoringPage({ demo = false }: { demo?: boolean }) {
 const profile = useAuthStore(s => s.profile)
 const [params, setParams] = useSearchParams()
 const [data, setData] = useState<CalendarData | null>(null)
 const [loading, setLoading] = useState(true)
 const [error, setError] = useState('')
 const [busy, setBusy] = useState(false)
 const [day, setDay] = useState('')
 const [slot, setSlot] = useState('')
 const [subject, setSubject] = useState('math')
 const [question, setQuestion] = useState(params.get('topic') ? `Хочу разобрать тему: ${params.get('topic')}` : '')
 const [email, setEmail] = useState(profile?.email ?? '')
 const [consent, setConsent] = useState(false)
 const [moving, setMoving] = useState<string | null>(null)
 const [notice, setNotice] = useState('')
 const [clock] = useState(() => Date.now())
 const load = useCallback(async () => {
  if (demo) {
   const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate()+1)
   const base = moscowDate(tomorrow.toISOString())
   setData({ enabled: true, server_now: new Date().toISOString(), bookings: [], slots: ['15:00','16:00','18:00'].map((t,i) => ({ id: `demo-${i}`, starts_at: `${base}T${t}:00+03:00` })) })
   setLoading(false); return
  }
  try { setData(await tutoringRpc<CalendarData>('tutoring_list')) }
  catch { setError('Не удалось загрузить запись. Попробуйте обновить страницу.') }
  finally { setLoading(false) }
 }, [demo])
 useEffect(() => { const timer=setTimeout(()=>void load(),0);return ()=>clearTimeout(timer) }, [load])
 useEffect(() => { if (!demo && profile?.role==='student') clearTutoringIntent() }, [demo,profile?.role])
 const bookingParam = params.get('booking')
 const sync = useCallback(async (id: string) => {
  setBusy(true); setError('')
  try {
   const result = await payment('sync',id)
   setNotice(result.status === 'paid' ? 'Оплата подтверждена. Жду вас на занятии!' : result.status === 'payment_conflict' ? 'Платёж получен, но выбранное время недоступно. Свяжитесь с преподавателем для согласования.' : 'Подтверждение ещё не получено. Можно проверить статус повторно — новая оплата не создаётся.')
   await load()
  } catch(e) { setError(e instanceof Error ? e.message : 'Не удалось проверить оплату') }
  finally { setBusy(false) }
 }, [load])
 useEffect(() => {
  if (!demo && bookingParam && /^[0-9a-f-]{36}$/i.test(bookingParam)) {const timer=setTimeout(()=>void sync(bookingParam),0);return ()=>clearTimeout(timer)}
 }, [bookingParam, demo, sync])
 const selectedDay = day || (data?.slots[0] ? moscowDate(data.slots[0].starts_at) : '')
 const times = data?.slots.filter(s => moscowDate(s.starts_at) === selectedDay) ?? []
 const selectedSlot = times.find(s=>s.id===slot)
 const now = data ? new Date(data.server_now).getTime() : clock
 async function checkout(id: string) {
  const result = await payment('checkout',id)
  if (!result.confirmation_url) throw new Error('Не получена ссылка на оплату')
  window.location.assign(result.confirmation_url)
 }
 async function submit(e: React.FormEvent) {
  e.preventDefault(); if (!selectedSlot) return
  setError(''); setNotice(''); setBusy(true)
  try {
   if (demo) {
    const b: Booking = { id:'demo-booking', slot_id:selectedSlot.id, starts_at:selectedSlot.starts_at, subject, question, status:'paid', amount_rub:1500, reserved_until:new Date(clock+900000).toISOString(), meeting_url:null, confirmation_url:null }
    setData(d => d ? { ...d, bookings:[b], slots:d.slots.filter(s=>s.id!==selectedSlot.id) } : d)
    setNotice('Демонстрация: запись подтверждена. Платёж не создавался.'); setSlot(''); return
   }
   if (moving) {
    await tutoringRpc('tutoring_reschedule', { p_booking_id:moving, p_slot_id:selectedSlot.id })
    setMoving(null); setNotice('Занятие перенесено. Новое время — в карточке ниже.'); await load()
   } else {
    const id = await tutoringRpc<string>('tutoring_reserve',{ p_slot_id:selectedSlot.id,p_subject:subject,p_question:question,p_email:email,p_consent:consent })
    await load(); await checkout(id)
   }
  } catch(e) { setError(e instanceof Error ? e.message : 'Не удалось записаться'); await load() }
  finally { setBusy(false) }
 }
 async function continuePayment(id: string) {
  setBusy(true); setError('')
  try { await checkout(id) } catch(e) { setError(e instanceof Error ? e.message : 'Ошибка оплаты') } finally { setBusy(false) }
 }
 return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
  {demo && <div className="rounded-2xl bg-amber-50 p-4 text-amber-900" role="status">Предпросмотр записи. Время вымышленное, оплаты и записи в базу нет.</div>}
  <div className="rounded-[28px] bg-primary-600 p-6 text-white sm:p-9">
   <span className="text-sm font-semibold uppercase tracking-wide text-blue-100">Личный разбор · математика и физика</span>
   <h1 className="mt-3 max-w-2xl text-3xl font-bold sm:text-4xl">Застряли в задаче? Разберём вместе.</h1>
   <p className="mt-3 max-w-2xl text-blue-50">На занятии один на один разберём ваш ход решения, найдём трудное место и потренируемся на похожей задаче.</p>
   <div className="mt-6 flex flex-wrap gap-5 text-sm font-semibold"><span className="flex items-center gap-2"><Clock size={18}/>45 минут</span><span>1500 ₽ за занятие</span><span className="flex items-center gap-2"><Video size={18}/>Телемост</span></div>
  </div>
  {notice && <p className="rounded-2xl bg-green-50 p-4 text-green-900" role="status">{notice}</p>}
  {error && <div className="rounded-2xl bg-red-50 p-4 text-red-900" role="alert">{error} <button className="underline" onClick={()=>void load()}>Обновить</button></div>}
  {loading ? <p>Загружаем свободное время…</p> : data?.enabled ? <form onSubmit={submit} className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
   <div className="space-y-5 rounded-[24px] border border-blue-100 bg-white p-6">
    <h2 className="flex items-center gap-2 text-xl font-bold"><CalendarDays size={22}/>{moving ? 'Выберите новое время' : 'Выберите дату и время'}</h2>
    <p className="text-sm text-slate-500">Всё время указано по Москве (UTC+3). Показаны только свободные окна.</p>
    <label className="block font-medium">Дата<input aria-label="Дата занятия" type="date" required value={selectedDay} min={moscowDate(new Date(clock).toISOString())} max={moscowDate(new Date(clock+90*86400000).toISOString())} onChange={e=>{setDay(e.target.value);setSlot('')}} className="mt-2 block w-full rounded-xl border border-slate-200 p-3" /></label>
    <div className="flex flex-wrap gap-2">{times.map(s=><button type="button" aria-pressed={slot===s.id} key={s.id} onClick={()=>setSlot(s.id)} className={`rounded-xl border px-5 py-3 font-semibold ${slot===s.id?'border-primary-600 bg-primary-600 text-white':'border-blue-100 text-primary-600'}`}>{moscowTime(s.starts_at)}</button>)}</div>
    {!times.length && <p className="rounded-xl bg-slate-50 p-4 text-slate-600">На эту дату свободных окон нет. Выберите другой день.</p>}
    {data.slots.length>0 && <div className="flex flex-wrap gap-2">{[...new Set(data.slots.map(s=>moscowDate(s.starts_at)))].slice(0,14).map(d=><button type="button" key={d} className="text-sm text-primary-600 underline" onClick={()=>{setDay(d);setSlot('')}}>{new Date(`${d}T12:00:00+03:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})}</button>)}</div>}
    {!moving && <>
     <label className="block font-medium">Предмет<select value={subject} onChange={e=>setSubject(e.target.value)} className="mt-2 block w-full rounded-xl border border-slate-200 p-3"><option value="math">Математика</option><option value="physics">Физика</option></select></label>
     <label className="block font-medium">Что хотите разобрать?<textarea required minLength={5} maxLength={3000} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Напишите тему, условие задачи и что именно не получается. Можно добавить ссылку на задачу." className="mt-2 block min-h-28 w-full rounded-xl border border-slate-200 p-3" /></label>
     <label className="block font-medium">Email для чека<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 block w-full rounded-xl border border-slate-200 p-3" /></label>
    </>}
   </div>
   <aside className="h-fit space-y-4 rounded-[24px] border border-blue-100 bg-white p-6">
    <h2 className="text-xl font-bold">{moving ? 'Перенос занятия' : 'Ваш личный разбор'}</h2>
    <p className="text-slate-600">Преподаватель — Шавалеев Альмир</p>
    <p className="text-3xl font-bold">{moving?'Без повторной оплаты':'1500 ₽'}<span className="ml-2 text-base font-normal text-slate-500">45 минут</span></p>
    <p>{selectedSlot?moscowFull(selectedSlot.starts_at):'Выберите удобное время в календаре'}</p>
    <p className="text-sm text-slate-500">Занятие оплачивается отдельно от подписки на курс. При оформлении время резервируется на 15 минут. Ссылка Телемоста появится после подтверждения оплаты.</p>
    <p className="text-sm text-slate-500">Перенос — не позднее чем за 2 часа до начала. По отмене и возврату свяжитесь с преподавателем.</p>
    {!moving && <label className="flex gap-2 text-sm"><input required type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Понимаю условия записи и переноса. Если мне нет 18 лет, запись согласована с родителем.</span></label>}
    {!demo && !profile ? <div className="space-y-2"><Link className="block rounded-xl bg-primary-600 p-3 text-center font-semibold text-white" to="/login" onClick={rememberTutoringIntent}>Войти и записаться</Link><Link className="block text-center text-primary-600 underline" to="/register" onClick={rememberTutoringIntent}>Создать аккаунт ученика</Link></div> : <button disabled={busy||!selectedSlot} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 font-semibold text-white disabled:opacity-40">{busy?'Подождите…':moving?'Подтвердить перенос':demo?'Посмотреть подтверждение':'Перейти к тестовой оплате'}<ArrowRight size={18}/></button>}
    {moving && <button type="button" className="underline" onClick={()=>setMoving(null)}>Отменить перенос</button>}
   </aside>
  </form> : !error && <div className="rounded-2xl border border-blue-100 bg-white p-6">Запись пока не открыта. Преподаватель скоро добавит свободное время.</div>}
  <section className="space-y-3"><h2 className="text-2xl font-bold">Мои занятия</h2>
   {!data?.bookings.length && <p className="text-slate-500">Здесь появятся ваши записи и ссылки на встречи.</p>}
   {data?.bookings.map(b=><article key={b.id} className="space-y-3 rounded-2xl border border-blue-100 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{moscowFull(b.starts_at)} · {b.subject==='math'?'Математика':'Физика'}</h3><span className="rounded-full bg-blue-50 px-3 py-1 text-sm text-primary-600">{b.status==='pending'&&new Date(b.reserved_until).getTime()<=now?'Резерв истёк':STATUS[b.status]??b.status}</span></div>
    <p className="whitespace-pre-wrap text-slate-600">{b.question}</p>
    <div className="flex flex-wrap gap-3">
     {b.status==='paid' && b.meeting_url && <a href={b.meeting_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-white"><Video size={18}/>Войти в Телемост</a>}
     {canReschedule(b,now) && !demo && <button disabled={busy} className="rounded-xl border px-4 py-2" onClick={()=>{setMoving(b.id);setSlot('');window.scrollTo({top:0,behavior:'smooth'})}}>Перенести</button>}
     {b.status==='pending' && !demo && <>
      {new Date(b.reserved_until).getTime()>now && <button disabled={busy} className="rounded-xl border px-4 py-2" onClick={()=>void continuePayment(b.id)}>Продолжить оплату</button>}
      <button disabled={busy} className="rounded-xl border px-4 py-2" onClick={()=>{setParams({});void sync(b.id)}}>Проверить оплату</button>
     </>}
     {b.status==='paid' && <span className="flex items-center gap-2 text-sm text-green-700"><CheckCircle size={17}/>45 минут · оплачено</span>}
    </div>
   </article>)}
  </section>
  <Link to="/subscription" className="inline-block text-primary-600 underline">К курсам</Link>
 </div>
}
