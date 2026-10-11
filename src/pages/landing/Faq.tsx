import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { Reveal } from './motion'
import { useAnim } from './anim'

type Audience = 's' | 'p'

const FAQ: Record<Audience, Array<[string, string]>> = {
  s: [
    ['Я ничего не понимаю в физике. Мне подойдёт?', 'Да. Диагностика покажет, с чего начать, а план выстроит темы от простого к сложному.'],
    ['Сколько времени нужно в неделю?', 'Зависит от времени до экзамена. План считает это сам: обычно 2–3 темы в неделю и пробник раз в месяц.'],
    ['А если я пришёл поздно, в марте?', 'Все темы, прошедшие по графику, уже открыты. План сожмётся и начнёт с номеров, которые дают больше баллов.'],
    ['Что если я застряну на задаче?', 'После 2–3 ошибок появится подсказка, у каждой задачи есть разбор.'],
    ['Почему так дёшево?', 'Это ранний доступ: курс растёт вместе с первыми учениками. Мы не тратим деньги на менеджеров продаж и рассрочки.'],
  ],
  p: [
    ['Как я пойму, что ребёнок занимается?', 'На платформе есть ссылка для родителя: по ней видно, что и сколько сделал ребёнок — закрытые темы, ДЗ, пробники и прогноз балла. А ещё можно получать отчёт в Telegram.'],
    ['Кто проверяет работы?', 'Первую часть — автоматическая проверка. Вторую — ИИ по критериям ФИПИ, итоговый балл подтверждает преподаватель в течение 48 часов.'],
    ['Как отменить подписку?', 'В личном кабинете, в один клик. Можно платить помесячно — годовая подписка по желанию, она просто выгоднее.'],
    ['Что такое демо-доступ?', 'После регистрации 3 дня полного доступа бесплатно и без привязки карты. Понравится — оформишь подписку.'],
    ['Вы гарантируете балл?', 'Нет, честно гарантировать балл не может никто. Мы показываем прогноз по реальным результатам, чтобы было видно, что подтянуть.'],
  ],
}

/**
 * Вопрос-аккордеон. Ответ появляется через opacity/transform, без анимации
 * высоты (правило ТЗ: только transform/opacity).
 */
function Question({ q, a, i }: { q: string; a: string; i: number }) {
  const anim = useAnim()
  const [open, setOpen] = useState(false)
  return (
    <motion.div
      className={open ? 'q open' : 'q'}
      initial={anim ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: i * 0.05 }}
    >
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {q}<span aria-hidden="true">+</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="a"
            initial={anim ? { opacity: 0, y: -6 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={anim ? { opacity: 0, transition: { duration: 0.15 } } : undefined}
            transition={{ duration: 0.3 }}
          >
            <p>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function Faq() {
  const [who, setWho] = useState<Audience>('s')
  return (
    <section id="faq">
      <div className="wrap faq">
        <Reveal className="sec-head center">
          <span className="eyebrow">Вопросы</span>
          <h2>Частые вопросы</h2>
        </Reveal>
        <div className="center">
          <div className="tabs" role="tablist" aria-label="Для кого вопросы">
            <button type="button" role="tab" aria-selected={who === 's'} className={who === 's' ? 'on' : undefined} onClick={() => setWho('s')}>Ученикам</button>
            <button type="button" role="tab" aria-selected={who === 'p'} className={who === 'p' ? 'on' : undefined} onClick={() => setWho('p')}>Родителям</button>
          </div>
        </div>
        <div key={who}>
          {FAQ[who].map(([q, a], i) => <Question key={q} q={q} a={a} i={i} />)}
        </div>
      </div>
    </section>
  )
}
