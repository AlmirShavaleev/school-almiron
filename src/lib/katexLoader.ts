import { upgradeCatalogMath, type KatexLike } from './catalogMarkdown'

/**
 * §269. Ленивая загрузка KaTeX для формул каталога.
 *
 * KaTeX (~270 КБ JS + стили + шрифты) нужен только задачам в Markdown — грузим
 * его отдельным чанком при первой встрече с формулой, а не в общем бандле.
 * Шрифты KaTeX собирает Vite из `katex/dist/fonts` и отдаёт с нашего домена —
 * никаких CDN (в России Cloudflare-CDN тормозит).
 */

let loaded: KatexLike | null = null
let pending: Promise<KatexLike> | null = null

/** KaTeX, если уже загружен (иначе null — формулы пока исходником). */
export function getLoadedKatex(): KatexLike | null {
  return loaded
}

export function loadKatex(): Promise<KatexLike> {
  if (loaded) return Promise.resolve(loaded)
  if (!pending) {
    pending = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([mod]) => {
        loaded = (mod as unknown as { default?: KatexLike }).default ?? (mod as unknown as KatexLike)
        return loaded
      })
      .catch(err => {
        pending = null
        throw err
      })
  }
  return pending
}

/** Загрузить KaTeX и дорисовать «ждущие» формулы внутри узла. */
export async function upgradeMathIn(root: ParentNode | null | undefined): Promise<void> {
  if (!root || !root.querySelector('.catalog-math-pending')) return
  try {
    const katex = await loadKatex()
    upgradeCatalogMath(root, katex)
  } catch {
    // Чанк не догрузился (обрыв сети) — формулы остаются читаемым исходником.
  }
}

/**
 * Страховка для мест, которые кладут HTML каталога в DOM сами (PDF-печать,
 * карточка задачи дня, превью раздела): следим за документом и дорисовываем
 * формулы, где бы они ни появились. Ставится один раз в main.tsx.
 */
export function installCatalogMathObserver(doc: Document = document): () => void {
  if (typeof MutationObserver === 'undefined' || !doc.body) return () => {}
  let scheduled = false
  const run = () => {
    scheduled = false
    void upgradeMathIn(doc.body)
  }
  const observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    const raf = doc.defaultView?.requestAnimationFrame
    if (raf) raf(run)
    else setTimeout(run, 0)
  })
  observer.observe(doc.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}
