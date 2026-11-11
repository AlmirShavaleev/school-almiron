import { useCallback, useEffect, useState } from 'react'
import { moscowFull, STATUS, tutoringRpc, type AdminData } from '@/lib/tutoring/api'

export function TutoringAdminPage() {
 const [data,setData] = useState<AdminData|null>(null)
 const [enabled,setEnabled] = useState(false)
 const [url,setUrl] = useState('')
 const [start,setStart] = useState('')
 const [error,setError] = useState('')
 const [message,setMessage] = useState('')
 const [busy,setBusy] = useState(false)
 const load = useCallback(async()=>{
  try { const d=await tutoringRpc<AdminData>('tutoring_admin_list');setData(d);setEnabled(d.settings.enabled);setUrl(d.settings.meeting_url);setError('') }
  catch { setError('Не удалось загрузить настройки личных занятий. Модуль может быть ещё не подключён.') }
 },[])
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return ()=>clearTimeout(timer)},[load])
 async function run(action:()=>Promise<unknown>,success:string) {
  setBusy(true);setError('');setMessage('')
  try { await action();await load();setMessage(success) } catch(e) { setError(e instanceof Error?e.message:'Не удалось сохранить') } finally { setBusy(false) }
 }
 return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
  <div><h1 className="text-3xl font-bold">Личные занятия</h1><p className="mt-2 text-slate-500">45 минут · 1500 ₽ · время по Москве. Оплата первой версии — через тестовый магазин ЮKassa.</p></div>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
  {message&&<p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{message}</p>}
  <form className="space-y-4 rounded-2xl border bg-white p-6" onSubmit={e=>{e.preventDefault();void run(()=>tutoringRpc('tutoring_admin_settings',{p_enabled:enabled,p_meeting_url:url}),'Настройки сохранены')}}>
   <h2 className="text-xl font-bold">Запись и Телемост</h2>
   <label className="block">Ссылка на встречу Телемоста<input type="url" placeholder="https://telemost.yandex.ru/j/…" value={url} onChange={e=>setUrl(e.target.value)} className="mt-2 block w-full rounded-xl border p-3"/></label>
   <p className="text-sm text-slate-500">Ссылка видна только преподавателю и оплатившему ученику. Существующая запись сохраняет ссылку, действовавшую в момент оплаты.</p>
   <label className="flex gap-2"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Открыть запись ученикам</label>
   <button disabled={busy||!data} className="rounded-xl bg-primary-600 px-5 py-3 text-white disabled:opacity-40">Сохранить</button>
  </form>
  <form className="space-y-4 rounded-2xl border bg-white p-6" onSubmit={e=>{e.preventDefault();void run(()=>tutoringRpc('tutoring_admin_slot',{p_starts_at:new Date(`${start}:00+03:00`).toISOString()}),'Свободное окно добавлено')}}>
   <h2 className="text-xl font-bold">Добавить свободное время</h2>
   <label className="block">Начало занятия (Москва)<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)} className="mt-2 block rounded-xl border p-3"/></label>
   <p className="text-sm text-slate-500">Каждое окно — 45 минут. Пересекающиеся окна не сохранятся. Даты можно добавить на 90 дней вперёд.</p>
   <button disabled={busy||!data} className="rounded-xl bg-primary-600 px-5 py-3 text-white disabled:opacity-40">Добавить окно</button>
   <div className="flex flex-wrap gap-2">{data?.slots.map(s=><button key={s.id} type="button" disabled={busy} onClick={()=>void run(()=>tutoringRpc('tutoring_admin_slot',{p_starts_at:null,p_id:s.id,p_open:!s.is_open}),'Доступность окна изменена')} className={`rounded-xl border p-3 text-sm ${s.is_open?'border-blue-200 text-blue-700':'bg-slate-100 text-slate-400'}`}>{moscowFull(s.starts_at)} · {s.is_open?'Закрыть':'Открыть'}</button>)}</div>
  </form>
  <section className="space-y-3"><h2 className="text-2xl font-bold">Записи учеников</h2>
   {!data?.bookings.length&&<p className="text-slate-500">Записей пока нет.</p>}
   {data?.bookings.map(b=><article key={b.id} className="space-y-2 rounded-2xl border bg-white p-5">
    <div className="flex flex-wrap justify-between gap-2"><b>{b.name||'Ученик'} · {moscowFull(b.starts_at)}</b><span>{STATUS[b.status]??b.status}</span></div>
    <p>{b.subject==='math'?'Математика':'Физика'} · 1500 ₽</p><p className="whitespace-pre-wrap text-slate-600">{b.question}</p>
    {b.status==='payment_conflict'&&<p className="font-medium text-red-700">Платёж подтверждён после потери резерва: согласуйте другое время или возврат с учеником.</p>}
    {b.status==='paid'&&b.meeting_url&&<a href={b.meeting_url} target="_blank" rel="noreferrer" className="text-primary-600 underline">Открыть Телемост</a>}
   </article>)}
  </section>
 </div>
}
