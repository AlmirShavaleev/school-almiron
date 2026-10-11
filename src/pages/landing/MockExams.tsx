import { motion } from 'framer-motion'
import { Reveal } from './motion'
import { EASE, useAnim } from './anim'
import { Icon3D } from './Icon3D'

/** Условный рост балла от пробника к пробнику (подпись «Цифры условные» не убирать). */
const MONTHS: Array<[string, number]> = [
  ['окт', 52], ['ноя', 56], ['дек', 61], ['янв', 63], ['фев', 67], ['мар', 70], ['апр', 72], ['май', 75],
]

export function MockExams() {
  const anim = useAnim()
  return (
    <section id="mock" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <Reveal className="card mock">
          <div className="mock-top">
            <div>
              <span className="eyebrow">Пробники</span>
              <h2>1 пробник ЕГЭ каждый месяц</h2>
              <p className="lead" style={{ marginTop: 10 }}>Полный вариант в формате экзамена: первая часть с автопроверкой, вторая — по критериям ФИПИ. После каждого — баллы, разбор ошибок и новый прогноз. К маю ты пишешь экзамен уже в восьмой раз.</p>
            </div>
            <div className="mock-count">
              <Icon3D name="mock" size={96} />
              <div className="mock-big">8</div>
              <small style={{ color: 'var(--ink2)', fontWeight: 700 }}>пробников до экзамена</small>
            </div>
          </div>
          <motion.div
            className="months"
            initial={anim ? 'hidden' : false}
            whileInView="shown"
            viewport={{ once: true, amount: 0.4 }}
          >
            {MONTHS.map(([m, v], i) => (
              <div className="mo" key={m}>
                <motion.span
                  className="sc"
                  variants={{ hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0, transition: { duration: 0.3, delay: i * 0.12 + 0.5 } } }}
                >
                  {v}
                </motion.span>
                <div className="colbox">
                  <motion.div
                    className="col"
                    style={{ height: `${v}%` }}
                    variants={{ hidden: { scaleY: 0 }, shown: { scaleY: 1, transition: { duration: 0.7, delay: i * 0.12, ease: EASE } } }}
                  />
                </div>
                <span className="nm">{m}</span>
              </div>
            ))}
          </motion.div>
          <p className="foot">Пример: как может расти балл от пробника к пробнику. Цифры условные.</p>
        </Reveal>
      </div>
    </section>
  )
}
