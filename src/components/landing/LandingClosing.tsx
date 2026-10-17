import {useId,useState} from 'react';import type {FormEvent} from 'react';import {AnimatePresence,motion} from 'framer-motion';import {ArrowRight,ChevronDown,CheckCircle2} from 'lucide-react';import {Link} from 'react-router-dom';import {faqItems} from './data';import {Brand} from './LandingHeader';import {MotionReveal} from './MotionReveal'
type LeadState='idle'|'loading'|'success'
const GOAL_OPTIONS:[string,string][]=[['oge','ОГЭ'],['ege','ЕГЭ'],['improvement','Повышение успеваемости']]
const ERROR_MESSAGES:Record<string,string>={invalid_phone:'Проверьте номер телефона',invalid_name:'Укажите имя',invalid_goal:'Выберите цель'}
function LeadForm(){const[state,setState]=useState<LeadState>('idle');const[name,setName]=useState('');const[phone,setPhone]=useState('');const[social,setSocial]=useState('');const[goal,setGoal]=useState('');const[comment,setComment]=useState('');const[website,setWebsite]=useState('')
  const[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});const[formError,setFormError]=useState('')
  function validate(){const errs:Record<string,string>={}
    if(name.trim().length<1)errs.name='Укажите имя'
    if(phone.length<5||phone.length>30||!/^[+\d\s()-]+$/.test(phone))errs.phone='Проверьте номер телефона'
    if(!goal)errs.goal='Выберите цель'
    return errs}
  async function submit(e:FormEvent){e.preventDefault();if(state==='loading')return
    const errs=validate();setFieldErrors(errs);setFormError('')
    if(Object.keys(errs).length>0)return
    setState('loading')
    try{const res=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-lead`,{method:'POST',headers:{'Content-Type':'application/json',apikey:import.meta.env.VITE_SUPABASE_ANON_KEY},body:JSON.stringify({name,phone,social,goal,comment,website})})
      if(res.status===429){setState('idle');setFormError('Слишком много заявок, попробуйте через несколько минут.');return}
      if(!res.ok){const body=await res.json().catch(()=>null);const code=body?.error;setState('idle')
        if(code&&ERROR_MESSAGES[code]){setFieldErrors({[code.replace('invalid_','')]:ERROR_MESSAGES[code]})}
        else setFormError('Не удалось отправить, попробуйте позже.')
        return}
      setState('success')
    }catch{setState('idle');setFormError('Не удалось отправить, попробуйте позже.')}}
  if(state==='success')return <div className="lead-form-success"><CheckCircle2/><span>Заявка отправлена, мы свяжемся с вами.</span></div>
  return <form className="lead-form" onSubmit={submit} noValidate>
    <input type="text" name="website" value={website} onChange={e=>setWebsite(e.target.value)} className="lead-form-hp" tabIndex={-1} autoComplete="off" aria-hidden="true"/>
    <div className="lead-field"><input placeholder="Ваше имя" value={name} onChange={e=>setName(e.target.value)} maxLength={100} className={fieldErrors.name?'field-error':''}/>{fieldErrors.name&&<small className="lead-form-error">{fieldErrors.name}</small>}</div>
    <div className="lead-field"><input type="tel" placeholder="+7 999 123-45-67" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={30} className={fieldErrors.phone?'field-error':''}/>{fieldErrors.phone&&<small className="lead-form-error">{fieldErrors.phone}</small>}</div>
    <input placeholder="Ник в TG или VK" value={social} onChange={e=>setSocial(e.target.value)} maxLength={100}/>
    <div className="lead-field"><div className="lead-goal-chips">{GOAL_OPTIONS.map(([v,label])=><button type="button" key={v} className={`lead-chip${goal===v?' active':''}`} onClick={()=>setGoal(v)}>{label}</button>)}</div>{fieldErrors.goal&&<small className="lead-form-error">{fieldErrors.goal}</small>}</div>
    <textarea placeholder="Комментарий (необязательно)" value={comment} onChange={e=>setComment(e.target.value)} maxLength={1000}/>
    <button className="al-btn cta-button" type="submit" disabled={state==='loading'}>{state==='loading'?'Отправляем…':<>Записаться на диагностику <ArrowRight/></>}</button>
    {formError?<small className="lead-form-error">{formError}</small>:<small>Диагностика не обязывает покупать обучение.</small>}
  </form>}
function FaqItem({q,a}:{q:string;a:string}){const[open,setOpen]=useState(false);const id=useId();return <div className={`faq-item ${open?'open':''}`}><button onClick={()=>setOpen(v=>!v)} aria-expanded={open} aria-controls={id}><span>{q}</span><ChevronDown/></button><AnimatePresence initial={false}>{open&&<motion.div id={id} role="region" initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:.32,ease:[.22,1,.36,1]}}><p>{a}</p></motion.div>}</AnimatePresence></div>}
export function LandingFaq(){return <section className="al-faq" id="faq"><div className="al-wrap faq-layout"><MotionReveal><span className="al-label dark">FAQ</span><h2>Перед первым<br/>занятием</h2><p>Главное о формате, проверке заданий и доступе к платформе.</p></MotionReveal><div>{faqItems.map(([q,a])=><FaqItem key={q} q={q} a={a}/>)}</div></div></section>}
export function LandingCta(){return <section className="al-cta" id="diagnostic"><motion.svg viewBox="0 0 1400 500" className="cta-line"><motion.path d="M-20 410 C270 40 560 620 830 180 S1190 40 1420 190" initial={{pathLength:0}} whileInView={{pathLength:1}} viewport={{once:true}} transition={{duration:2}}/></motion.svg><div className="al-wrap cta-layout"><MotionReveal><span className="al-label">Первый шаг</span><h2>Начните подготовку<br/>с понимания<br/>текущего уровня</h2><p>На диагностике определим пробелы, цель и подходящий формат занятий.</p><LeadForm/></MotionReveal><MotionReveal direction="right" className="plan-preview"><header><span>Персональный план</span><b>01 / Диагностика</b></header>{['Определим текущий уровень','Зафиксируем цель','Найдём ключевые пробелы','Выберем формат и темп'].map((x,i)=><div key={x}><CheckCircle2/><span><small>Шаг 0{i+1}</small><b>{x}</b></span></div>)}<footer><span>Результат</span><b>Понятный маршрут подготовки</b></footer></MotionReveal></div></section>}
export function LandingFooter(){return <footer className="al-footer"><div className="al-wrap footer-grid"><Brand/><div><b>Разделы</b><a href="#story">Как работает</a><a href="#platform">Платформа</a><a href="#formats">Форматы</a><a href="#results">Результаты</a></div><div><b>Информация</b><a href="#teacher">Преподаватель</a><a href="#faq">Вопросы</a><Link to="/login">Войти в кабинет</Link></div><div><b>Документы</b><a href="#">Политика конфиденциальности</a><a href="#">Пользовательское соглашение</a></div></div><div className="al-wrap footer-bottom"><span>© 2026 School Almiron</span><span>Репетитор + собственная образовательная платформа</span></div></footer>}
