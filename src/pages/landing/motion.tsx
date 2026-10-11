import { motion, type Variants } from 'framer-motion'
import type { ReactNode } from 'react'
import { EASE, useAnim } from './anim'

/**
 * Появление блока при прокрутке (в прототипе — `data-r`): снизу вверх, один
 * раз. При «уменьшить движение» блок рисуется сразу в конечном виде.
 */
export function Reveal({ children, className, style, id, amount = 0.2 }: {
  children: ReactNode
  className?: string
  style?: React.CSSProperties
  id?: string
  amount?: number
}) {
  const anim = useAnim()
  return (
    <motion.div
      id={id}
      className={className}
      style={style}
      initial={anim ? { opacity: 0, y: 34 } : false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: 0.7, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

const staggerParent: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.09 } },
}

/** Сетка карточек, дети въезжают по очереди (`data-stagger` прототипа). */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const anim = useAnim()
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial={anim ? 'hidden' : false}
      whileInView="shown"
      viewport={{ once: true, amount: 0.15 }}
    >
      {children}
    </motion.div>
  )
}
