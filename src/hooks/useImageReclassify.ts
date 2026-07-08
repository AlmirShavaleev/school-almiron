import { type RefObject, useEffect } from 'react'
import { isAnswerTemplateSvg } from '@/pages/catalog/classifyAnswerTemplate'

/**
 * After images load, verify / correct the catalog-answer-template classification
 * using actual image dimensions (naturalWidth / naturalHeight).
 * resolveTaskHtml classifies by alt-text alone; this hook confirms with real pixels.
 */
export function useImageReclassify(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[],
) {
  useEffect(() => {
    const root = ref.current
    if (!root) return

    function reclassify(img: HTMLImageElement) {
      const { naturalWidth: nw, naturalHeight: nh } = img
      if (!nw) return
      const alt    = img.getAttribute('alt') ?? ''
      const should = isAnswerTemplateSvg(nw, nh, img.classList.contains('math-display'), alt)
      const has    = img.classList.contains('catalog-answer-template')
      if (should && !has) img.classList.add('catalog-answer-template')
      if (!should && has) img.classList.remove('catalog-answer-template')
    }

    const imgs = [...root.querySelectorAll<HTMLImageElement>('img')]
    imgs.forEach(img => {
      if (img.complete && img.naturalWidth > 0) reclassify(img)
      else img.addEventListener('load', () => reclassify(img), { once: true })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
