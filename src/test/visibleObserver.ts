import { beforeAll } from 'vitest'

/**
 * В jsdom нет IntersectionObserver, а анимации «при появлении в экране»
 * (framer-motion: whileInView/useInView — главная ученика и лендинг) стоят на
 * нём. Заглушка сразу сообщает «элемент виден» — блоки доезжают до конечного
 * вида. Подключается в файле теста, а не глобально: часть кода проверяет
 * `typeof IntersectionObserver === 'undefined'` и ведёт себя иначе.
 */
export function useVisibleObserver() {
  beforeAll(() => {
    class VisibleObserver {
      private cb: IntersectionObserverCallback
      constructor(cb: IntersectionObserverCallback) { this.cb = cb }
      observe(target: Element) {
        this.cb([{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    }
    globalThis.IntersectionObserver = VisibleObserver as unknown as typeof IntersectionObserver
  })
}
