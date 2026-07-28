import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface ZoomedImage {
  src: string
  alt: string
}

/**
 * Полноэкранный просмотр картинок из задач каталога.
 *
 * Зачем: иллюстрации в задачах намеренно ужаты CSS-ом (max-width 50%,
 * у математики 35% — компактность списков), и графики/таблицы-картинки
 * становятся нечитаемыми. Решение владельца (2026-07-28): списки остаются
 * компактными, а клик по картинке раскрывает её на весь экран.
 *
 * Монтируется ОДИН раз в App и слушает клики на document в capture-фазе:
 * так одна точка покрывает все поверхности с HTML каталога (каталог,
 * конструктор теста, прохождение теста учеником, корзина …) без правки
 * каждого рендерера, а перехват в capture не даёт клику по картинке
 * заодно сработать как «выбор карточки» под ней.
 *
 * Что зумим: любые <img> внутри .catalog-html, КРОМЕ
 *  - шаблонов ответа (.catalog-answer-template — служебная плашка);
 *  - мелких инлайновых формул без figure-класса (naturalWidth/Height < 80):
 *    зум символа в строке — только шум.
 * Печатный портал PDF живёт в отдельном window — сюда не попадает.
 */
export function CatalogImageLightbox() {
  const [img, setImg] = useState<ZoomedImage | null>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target
      if (!(t instanceof HTMLImageElement)) return
      if (!t.closest('.catalog-html')) return
      if (t.classList.contains('catalog-answer-template')) return

      const isFigure =
        t.classList.contains('catalog-condition-figure') ||
        t.classList.contains('catalog-solution-image')
      if (!isFigure && t.naturalWidth < 80 && t.naturalHeight < 80) return

      e.preventDefault()
      e.stopPropagation()
      setImg({ src: t.currentSrc || t.src, alt: t.alt })
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])

  useEffect(() => {
    if (!img) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setImg(null)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [img])

  if (!img) return null

  return (
    <div
      data-testid="catalog-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Увеличенное изображение"
      className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/80 p-4"
      onClick={() => setImg(null)}
    >
      <button
        type="button"
        aria-label="Закрыть"
        className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25"
        onClick={() => setImg(null)}
      >
        <X size={20} />
      </button>
      {/* Белая подложка: формулы и графики часто чёрным по прозрачному. */}
      <img
        src={img.src}
        alt={img.alt}
        className="max-h-[92vh] max-w-[95vw] rounded-lg bg-white object-contain p-2 shadow-2xl"
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}
