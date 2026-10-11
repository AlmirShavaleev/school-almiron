import { motion, type Variants } from 'framer-motion'
import { useAnim } from './anim'
import { iconSrc, type IconName } from './icons'

/**
 * «Выпрыгивание» при прокрутке: scale 0.6 → (перелёт ≈1.08 даёт пружина) → 1,
 * rotate −12° → 0. Имена вариантов те же, что у `Stagger`/`staggerChild`, —
 * иконка внутри карточки сетки получает их от родителя и въезжает со своей
 * карточкой (stagger), а не отдельно.
 */
const pop: Variants = {
  hidden: { opacity: 0, scale: 0.6, rotate: -12 },
  shown: { opacity: 1, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 260, damping: 11, delay: 0.12 } },
}

/** Фаза парения у каждой иконки своя — по имени, а не случайно (стабильно между рендерами). */
function floatPhase(name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { duration: 4 + (h % 21) / 10, delay: -((h >> 5) % 50) / 10 }
}

/**
 * Иконка с тремя слоями движения — каждый на своём элементе, чтобы
 * transform-ы не перетирали друг друга:
 *  1. `motion.span` — появление (pop);
 *  2. `.i3d-h` — наклон 9° и 1.1 при наведении на карточку (CSS);
 *  3. `.i3d-f` — бесконечное парение y ±6 px (CSS-петля, своя фаза).
 * Всё только transform/opacity. «Уменьшить движение» — иконка сразу на
 * месте, парение и наклон гасит CSS.
 *
 * `inherit` — варианты придут от родителя (карточка в `Stagger`), своего
 * наблюдения за прокруткой не нужно. `eager` — иконка первого экрана: без
 * lazy и с высоким приоритетом загрузки.
 */
export function Icon3D({ name, size, className, inherit = false, eager = false, still = false }: {
  name: IconName
  size: number
  className?: string
  inherit?: boolean
  eager?: boolean
  /** Без парения (например, когда иконку уже двигает своя анимация). */
  still?: boolean
}) {
  const anim = useAnim()
  const phase = floatPhase(name)
  const own = inherit ? {} : {
    initial: anim ? 'hidden' : false,
    whileInView: 'shown',
    viewport: { once: true, amount: 0.4 },
  } as const
  return (
    <motion.span
      className={className ? `i3d ${className}` : 'i3d'}
      style={{ width: size, height: size }}
      variants={anim ? pop : undefined}
      aria-hidden="true"
      data-icon={name}
      {...own}
    >
      <span className="i3d-h">
        <span
          className={still ? 'i3d-f still' : 'i3d-f'}
          style={{ animationDuration: `${phase.duration}s`, animationDelay: `${phase.delay}s` }}
        >
          <img
            src={iconSrc(name)}
            alt=""
            width={size}
            height={size}
            draggable={false}
            {...(eager ? { fetchPriority: 'high' as const, loading: 'eager' as const } : { loading: 'lazy' as const, decoding: 'async' as const })}
          />
        </span>
      </span>
    </motion.span>
  )
}
