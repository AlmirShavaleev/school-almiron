import { useCallback, useEffect, useRef } from 'react'
import { commentBoxHeight, commentBoxMaxHeight } from '@/lib/reviewCommentBox'

/**
 * §208. Текстовое поле, которое растёт под содержимое до потолка.
 *
 * Два решения, ради которых это хук, а не три строки в `onChange`:
 *
 *  1. Пересчёт привязан к ЗНАЧЕНИЮ, а не к набору с клавиатуры. В форму
 *     вердикта текст чаще приходит программно — разбор ИИ подставляется сам
 *     при открытии работы, — и поле, которое растёт только от нажатий клавиш,
 *     показало бы этот разбор в те же две строки, с которых всё началось.
 *  2. Уголок изменения размера остаётся рабочим. Браузер, когда его тянут,
 *     пишет высоту в тот же inline-стиль, куда пишем мы, — поэтому чужое
 *     значение в `style.height` читается как «растянули руками», и дальше поле
 *     принадлежит человеку: авто-рост в него больше не лезет.
 */
export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  /** Последняя высота, которую поставили МЫ. Всё прочее — работа человека. */
  const ourHeight = useRef<string | null>(null)
  const manual = useRef(false)
  /** Высота пустого поля (те самые шесть строк) — ниже неё не опускаемся. */
  const minHeight = useRef(0)

  const adjust = useCallback(() => {
    const el = ref.current
    if (!el || manual.current) return

    if (el.style.height && el.style.height !== ourHeight.current) {
      manual.current = true
      return
    }

    if (!minHeight.current) minHeight.current = el.clientHeight

    // Потолок считаем от окна: форма вердикта стоит внизу колонки документа, а
    // та занимает экран целиком за вычетом шапки. Мерить саму колонку нельзя —
    // она растёт вместе с полем, и мерка гналась бы за собственным результатом.
    const max = commentBoxMaxHeight(el.ownerDocument.defaultView?.innerHeight ?? 0)

    el.style.height = 'auto'
    const { height, scroll } = commentBoxHeight(el.scrollHeight, minHeight.current, max)
    const px = `${height}px`
    el.style.height = px
    ourHeight.current = px
    el.style.overflowY = scroll ? 'auto' : 'hidden'
  }, [])

  useEffect(() => { adjust() }, [value, adjust])

  return ref
}
