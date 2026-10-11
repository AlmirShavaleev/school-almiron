import { motion } from 'framer-motion'
import { useState, type FormEvent } from 'react'
import { Reveal, Stagger } from './motion'
import { staggerChild, useAnim } from './anim'

/**
 * Лист ожидания. Отправки пока нет: в базе нет таблицы для заявок, а новые
 * миграции в этой задаче запрещены (ЛЕНДИНГ_ТЗ.md §0). Контакт никуда не
 * уходит — форма только благодарит. Куда писать — в отчёте лендинга.
 */
function WaitList({ subject }: { subject: string }) {
  const anim = useAnim()
  const [value, setValue] = useState('')
  const [done, setDone] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    setDone(true)
  }

  if (done) {
    return (
      <motion.div initial={anim ? { scale: 0.9 } : false} animate={{ scale: 1 }} transition={{ duration: 0.3 }}>
        <span className="tag tag-ok">Сообщим о запуске ✓</span>
      </motion.div>
    )
  }
  return (
    <form className="wl" onSubmit={submit}>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder="Telegram или email"
        aria-label={`Контакт для листа ожидания: ${subject}`}
      />
      <button type="submit">Ждать</button>
    </form>
  )
}

const SOON: Array<[string, string]> = [
  ['ЕГЭ · 11 класс', 'Математика профиль'],
  ['ОГЭ · 9 класс', 'Физика'],
  ['ОГЭ · 9 класс', 'Математика'],
]

export function Subjects() {
  return (
    <section id="subjects">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Предметы и экзамены</span>
          <h2>Начинаем с физики. Дальше — математика и ОГЭ</h2>
        </Reveal>
        <Stagger className="grid subj">
          <motion.div className="card s-card live" variants={staggerChild}>
            <span className="ex">ЕГЭ · 11 класс</span>
            <h3>Физика</h3>
            <span className="tag tag-ok">Доступно</span>
            <div className="sp" />
            <a className="btn btn-p" href="#prices">Начать</a>
          </motion.div>
          {SOON.map(([ex, h]) => (
            <motion.div key={ex + h} className="card s-card" variants={staggerChild}>
              <span className="ex">{ex}</span>
              <h3>{h}</h3>
              <span className="tag tag-soon">Скоро</span>
              <div className="sp" />
              <WaitList subject={`${ex}, ${h}`} />
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
