/**
 * `Map.prototype.getOrInsertComputed` для pdf.js — иначе НИ ОДНА страница PDF
 * в приложении не рисуется.
 *
 * Что произошло. `pdfjs-dist` 6.1.200 вызывает `getOrInsertComputed` прямо на
 * пути отрисовки: `PDFPageProxy.render` → `getOptionalContentConfig` →
 * `#cacheSimpleMethod`. Метод — из предложения TC39 «upsert», которое в этом
 * виде так и не доехало ни до одного браузера (в Chromium 141 нет ни
 * `getOrInsertComputed`, ни `getOrInsert`). Значит любой `render()` падает с
 * `TypeError: this[#methodPromises].getOrInsertComputed is not a function`, и
 * на экране остаётся пустое место.
 *
 * Бьёт это по трём местам сразу: работа ученика в PDF у проверяющего
 * (`SubmissionReviewer`), решения в PDF (`SolutionPdfPages`) и всё, что через
 * них открывается. Проверено вживую: без полифилла настоящий PDF из 14
 * страниц не рисуется вовсе, с полифиллом рисуется полностью.
 *
 * Почему полифилл, а не откат версии: поведение метода однозначно (взять по
 * ключу, а если нет — вычислить, положить и вернуть), реализация в четыре
 * строки, а откат `pdfjs-dist` тянет за собой смену API рендеринга.
 *
 * Модуль подключается САМЫМ ПЕРВЫМ импортом в `main.tsx` — до того, как
 * что-либо успеет затащить pdf.js.
 *
 * Отдельно про воркер: в `pdf.worker.mjs` те же вызовы есть (12 штук), но на
 * пути разбора документа они не лежат — с полифиллом только в главном потоке
 * настоящий документ читается и рисуется целиком. Если когда-нибудь всплывёт
 * та же ошибка из воркера, лечится она тем же куском, но воркер придётся
 * поднимать своим `workerPort`.
 */

type Computed<K, V> = (key: K) => V

function install(proto: object, name: string): void {
  if (name in proto) return
  Object.defineProperty(proto, name, {
    value: function <K, V>(this: { has(k: K): boolean; get(k: K): V | undefined; set(k: K, v: V): unknown }, key: K, compute: Computed<K, V>): V {
      if (!this.has(key)) this.set(key, compute(key))
      return this.get(key) as V
    },
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

install(Map.prototype, 'getOrInsertComputed')
install(WeakMap.prototype, 'getOrInsertComputed')

export {}
