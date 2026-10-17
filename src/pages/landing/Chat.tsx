import { motion, useInView } from 'framer-motion'
import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAnim } from './anim'
import { PHOTO } from './icons'

export type Msg = { me?: boolean; text: ReactNode }

/** Длина текста сообщения — от неё зависит, сколько «печатает» Альмир. */
function textLength(node: ReactNode): number {
  let n = 0
  Children.forEach(node, ch => {
    if (typeof ch === 'string' || typeof ch === 'number') n += String(ch).length
    else if (isValidElement<{ children?: ReactNode }>(ch)) n += textLength(ch.props.children)
  })
  return n
}

/** Пауза «печатает…» как в прототипе: свои реплики — 650 мс, Альмира — по длине. */
function typingDelay(m: Msg) {
  return m.me ? 650 : Math.min(1300, 450 + textLength(m.text) * 7)
}

/**
 * Диалог (прототип: `playChat`). Сообщения появляются по одному, у реплик
 * Альмира сначала «печатает…».
 *
 * Без сдвига раскладки (CLS): все сообщения стоят на своих местах с самого
 * начала, просто прозрачные; точки «печатает…» лежат поверх скрытого текста,
 * поэтому пузырь сразу нужного размера. Текст всегда в DOM — читалка и поиск
 * видят его без анимации.
 *
 * `autoStart` — запуск сразу (первый экран), иначе — когда диалог виден
 * наполовину. `onDone` — после последней реплики (кнопки под диалогом).
 */
export function Chat({ msgs, className, autoStart = false, instant = false, onDone }: {
  msgs: Msg[]
  className?: string
  autoStart?: boolean
  /** Сразу в конечном виде, без «печатает…» (кабинет: повторный заход на главную). */
  instant?: boolean
  onDone?: () => void
}) {
  const anim = useAnim() && !instant
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const [shown, setShown] = useState(0)
  const [typing, setTyping] = useState(-1)
  const doneRef = useRef(onDone)
  useEffect(() => { doneRef.current = onDone }, [onDone])

  const go = anim && (autoStart || inView)

  useEffect(() => {
    if (!anim) { doneRef.current?.(); return }
    if (!go) return
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let t = 0
    msgs.forEach((m, i) => {
      timers.push(setTimeout(() => { setShown(i + 1); setTyping(m.me ? -1 : i) }, t))
      t += typingDelay(m)
      timers.push(setTimeout(() => setTyping(-1), t))
    })
    timers.push(setTimeout(() => doneRef.current?.(), t))
    return () => timers.forEach(clearTimeout)
  }, [anim, go, msgs])

  const visible = anim ? shown : msgs.length

  return (
    <div className={className ? `chat ${className}` : 'chat'} ref={ref}>
      {msgs.map((m, i) => (
        <motion.div
          key={i}
          className={m.me ? 'msg me' : 'msg'}
          data-chat
          initial={anim ? { opacity: 0, y: 12, scale: 0.96 } : false}
          animate={i < visible ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.3 }}
        >
          <div className="av">
            {m.me ? 'Ты' : <img src={PHOTO.avatar.src} alt="Альмир" width={40} height={40} decoding="async" />}
          </div>
          <div className={typing === i ? 'bub typing' : 'bub'}>
            {typing === i && <span className="dots" aria-hidden="true"><i /><i /><i /></span>}
            <span className="txt">{m.text}</span>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
