import { Link } from 'react-router-dom'
import { Reveal } from './motion'

export function PersonalHelp() {
 return <section id="personal-help"><div className="wrap"><Reveal>
  <div style={{ border:'1px solid var(--line, #dbe4ff)',borderRadius:28,padding:'clamp(24px, 5vw, 56px)',background:'var(--card, #f0f5ff)' }}>
   <p style={{fontWeight:700,color:'var(--blue, #3159ed)'}}>Лично с Альмиром · математика и физика</p>
   <h2 style={{fontSize:'clamp(28px, 4vw, 46px)',lineHeight:1.12,maxWidth:750,margin:'16px 0'}}>Не получается самостоятельно?<br/>Разберём вместе один на один.</h2>
   <p style={{maxWidth:680,fontSize:18,lineHeight:1.6}}>Застряли в задаче или не поняли тему — выберите удобное время. На личном занятии найдём трудное место и потренируемся решать самостоятельно.</p>
   <p style={{margin:'20px 0',fontWeight:700}}>45 минут · 1500 ₽ · онлайн в Телемосте</p>
   <div className="chat-actions"><Link className="btn btn-navy" to="/tutoring">Выбрать дату и время →</Link></div>
   <p style={{fontSize:14,marginTop:14,opacity:.7}}>Оплачивается отдельно от курса. Перенос — не позднее чем за 2 часа.</p>
  </div>
 </Reveal></div></section>
}
