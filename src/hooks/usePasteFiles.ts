import { useEffect, useRef } from 'react'
import { imagesFromTransfer } from '@/lib/clipboardFiles'

/**
 * Вставка картинок из буфера (Ctrl+V) в область загрузки.
 *
 * Слушаем `document`, а не свой контейнер. Событие `paste` приходит туда, где
 * стоит курсор: если он не в поле ввода, целью будет `body`, и обработчик на
 * `div` не сработал бы вовсе. В виджете поддержки это не всплыло только
 * потому, что его панель почти целиком состоит из полей ввода.
 *
 * Отсюда вторая забота: областей загрузки на экране может быть несколько
 * (модалка темы держит и материалы, и ДЗ). Слушатели складываются в стопку, и
 * картинку забирает ВЕРХНИЙ — тот, что смонтирован последним, то есть самый
 * верхний по интерфейсу. Иначе один скриншот прилетел бы сразу в два места.
 */
const stack: Array<{ handle: (files: File[]) => void }> = []

export function usePasteFiles(
  onFiles: (files: File[]) => void,
  enabled = true,
): void {
  // Через ref, чтобы не перевешивать слушателя на каждый ре-рендер: сам
  // обработчик почти всегда новая функция.
  const ref = useRef(onFiles)
  ref.current = onFiles

  useEffect(() => {
    if (!enabled) return

    const entry = { handle: (files: File[]) => ref.current(files) }
    stack.push(entry)

    function onPaste(e: ClipboardEvent) {
      if (stack[stack.length - 1] !== entry) return
      const files = imagesFromTransfer(e.clipboardData)
      if (files.length === 0) return
      // Текст в буфере не трогаем: если рядом есть поле ввода, пусть вставится
      // как обычно. Забираем только картинки и только если они там есть.
      e.preventDefault()
      entry.handle(files)
    }

    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('paste', onPaste)
      const i = stack.indexOf(entry)
      if (i !== -1) stack.splice(i, 1)
    }
  }, [enabled])
}
