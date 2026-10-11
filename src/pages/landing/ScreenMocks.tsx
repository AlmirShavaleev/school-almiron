import { motion } from 'framer-motion'
import { screenItem as item } from './anim'
import { Plate } from './Brand'

/**
 * Макеты экранов кабинета для блока «Как это выглядит». Каждый принимает
 * `image`: когда появятся реальные скриншоты платформы, передаётся адрес
 * картинки — и макет заменяется ею без правки разметки блока.
 *
 * Пункты внутри (задачи, критерии, чипы) въезжают по очереди при показе
 * вкладки (варианты `screenItem`, stagger задаёт родитель).
 */
export type ScreenProps = { image?: string; alt?: string }

function Shot({ image, alt }: { image: string; alt: string }) {
  return <img className="pane-img" src={image} alt={alt} loading="lazy" decoding="async" />
}

export function VideoScreen({ image, alt = 'Видеоконспект урока' }: ScreenProps) {
  if (image) return <Shot image={image} alt={alt} />
  return (
    <>
      <div className="vid">
        <svg viewBox="0 0 400 175" aria-hidden="true">
          <text x="40" y="65" className="vf">p = m · v</text>
          <line x1="60" y1="125" x2="230" y2="125" className="va" />
          <circle cx="60" cy="125" r="16" className="vb" />
          <text x="250" y="131" className="vt">v</text>
        </svg>
        <span className="play" aria-hidden="true">▶</span>
      </div>
      <div className="vbar"><i /></div>
      <div className="vmeta"><b>Импульс тела</b><span>Видеоконспект · 4 мин</span></div>
      <div className="chips">
        {['Определение', 'Направление импульса', 'Примеры'].map((c, i) => (
          <motion.span key={c} className={i === 0 ? 'chip on' : 'chip'} variants={item}>{c}</motion.span>
        ))}
      </div>
      <motion.div variants={item}>
        <Plate title="Из кодификатора ЕГЭ" note="п. 1.4.1">
          Импульс тела — векторная величина, направлен так же, как скорость:
          <span className="f"><span className="vec">p</span> = m<span className="vec">v</span></span>
        </Plate>
      </motion.div>
      <motion.div variants={item}>
        <Plate tone="trap" title="Ловушка ЕГЭ" note="частая ошибка">
          Мяч отскочил от стены с той же по модулю скоростью — импульс изменился на 2mv, а не на ноль.
        </Plate>
      </motion.div>
    </>
  )
}

export function HomeworkScreen({ image, alt = 'ДЗ с автопроверкой' }: ScreenProps) {
  if (image) return <Shot image={image} alt={alt} />
  return (
    <>
      <div className="hw-top"><b>ДЗ · Законы сохранения</b><span>6 из 8</span></div>
      <div className="pbar"><i style={{ width: '75%' }} /></div>
      <motion.div className="task" variants={item}>
        <div className="task-top"><span className="no dz">№ 1</span><span className="kim">КИМ 3</span></div>
        <p>Скорость тела массой 5 кг за 2 с изменилась на 4 м/с. Чему равна равнодействующая сила? (Н)</p>
        <div className="ans"><span className="inp">10</span><span className="tag tag-ok">✓ Верно</span></div>
      </motion.div>
      <motion.div className="task" variants={item}>
        <div className="task-top"><span className="no dz">№ 2</span><span className="kim">КИМ 4</span></div>
        <p>Период маятника 0,8 с. Массу груза увеличили в 2 раза. Каким станет период? (с)</p>
        <div className="ans"><span className="inp">1,6</span><span className="tag tag-soon">Неверно — попробуй ещё</span></div>
        <small className="hint">Подсказка: от чего зависит период математического маятника?</small>
      </motion.div>
    </>
  )
}

export function PartTwoScreen({ image, alt = 'Проверка второй части' }: ScreenProps) {
  if (image) return <Shot image={image} alt={alt} />
  return (
    <>
      <div className="hw-top"><b>Задача № 24 · вторая часть</b><span className="tag tag-ok">Проверено</span></div>
      <div className="p2">
        <div className="photo">
          <svg viewBox="0 0 160 200" aria-hidden="true">
            <path d="M15 30 C40 20,70 40,110 28" />
            <path d="M15 60 C50 52,90 70,140 58" />
            <path d="M15 90 C35 84,70 98,120 88" />
            <path d="M15 120 C50 112,80 128,130 118" />
            <path d="M15 150 C30 145,55 156,80 148" />
          </svg>
          <small>решение.jpg</small>
        </div>
        <div>
          <ul className="crit2">
            <motion.li className="ok" variants={item}>Записаны законы и формулы</motion.li>
            <motion.li className="ok" variants={item}>Верные преобразования</motion.li>
            <motion.li className="no" variants={item}>Не указаны единицы в ответе</motion.li>
          </ul>
          <div className="score2">2 <span>из 3</span></div>
        </div>
      </div>
      <div className="comment">«Решение верное, но в ответе нет единиц — на экзамене за это снимут балл».</div>
    </>
  )
}

const BANK: Array<[string, string, string]> = [
  ['КИМ 1', 'Тело движется по закону x = 6 − 2t − 4t². Найдите проекцию ускорения.', 'базовый'],
  ['КИМ 2', 'Расстояние между зарядами уменьшили в 2,5 раза. Как изменится сила?', 'базовый'],
  ['КИМ 7', 'Средняя кинетическая энергия молекул уменьшилась в 3 раза. Найдите температуру.', 'средний'],
  ['КИМ 8', 'Сколько теплоты нужно, чтобы расплавить 3 кг льда при 0 °C?', 'базовый'],
]

export function BankScreen({ image, alt = 'Банк задач по номерам ЕГЭ' }: ScreenProps) {
  if (image) return <Shot image={image} alt={alt} />
  return (
    <>
      <div className="kims">
        {Array.from({ length: 26 }, (_, i) => (
          <motion.span key={i} className={i === 0 ? 'chip on' : 'chip'} variants={item}>{i + 1}</motion.span>
        ))}
      </div>
      <div className="bank">
        {BANK.map(([k, p, l], i) => (
          <motion.div key={k} className="bk" variants={item}>
            <span className="no">№ {i + 1}</span><span className="kim">{k}</span><p>{p}</p><span className="lvl">{l}</span>
          </motion.div>
        ))}
      </div>
    </>
  )
}
