import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CatalogImageLightbox } from '@/components/catalog/CatalogImageLightbox'

/**
 * Лайтбокс слушает клики на document (capture), поэтому картинку рендерим
 * обычным HTML рядом с компонентом — как в реальных рендерерах каталога.
 */
function setup(imgHtml: string) {
  render(
    <>
      <div className="catalog-html" dangerouslySetInnerHTML={{ __html: imgHtml }} />
      <CatalogImageLightbox />
    </>,
  )
}

afterEach(cleanup)

describe('CatalogImageLightbox', () => {
  it('клик по иллюстрации задачи открывает полноэкранный просмотр', () => {
    setup('<img class="catalog-condition-figure" src="https://x/fig.png" alt="График">')
    fireEvent.click(document.querySelector('img.catalog-condition-figure')!)
    expect(screen.getByTestId('catalog-image-lightbox')).toBeInTheDocument()
    // внутри лайтбокса — та же картинка
    const zoomed = screen.getByTestId('catalog-image-lightbox').querySelector('img')!
    expect(zoomed.getAttribute('src')).toBe('https://x/fig.png')
  })

  it('Escape закрывает просмотр', () => {
    setup('<img class="catalog-solution-image" src="https://x/sol.png" alt="">')
    fireEvent.click(document.querySelector('img.catalog-solution-image')!)
    expect(screen.getByTestId('catalog-image-lightbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('catalog-image-lightbox')).toBeNull()
  })

  it('клик по фону закрывает просмотр', () => {
    setup('<img class="catalog-condition-figure" src="https://x/fig.png" alt="">')
    fireEvent.click(document.querySelector('img.catalog-condition-figure')!)
    fireEvent.click(screen.getByTestId('catalog-image-lightbox'))
    expect(screen.queryByTestId('catalog-image-lightbox')).toBeNull()
  })

  it('мелкая инлайновая формула без figure-класса не зумится', () => {
    // в jsdom naturalWidth = 0 < 80 — ровно случай инлайновой формулы
    setup('<img src="https://x/formula.svg" alt="x^2">')
    fireEvent.click(document.querySelector('img')!)
    expect(screen.queryByTestId('catalog-image-lightbox')).toBeNull()
  })

  it('шаблон ответа не зумится', () => {
    setup('<img class="catalog-condition-figure catalog-answer-template" src="https://x/tpl.svg" alt="">')
    fireEvent.click(document.querySelector('img')!)
    expect(screen.queryByTestId('catalog-image-lightbox')).toBeNull()
  })

  it('картинки вне .catalog-html не трогаются', () => {
    render(
      <>
        <img className="catalog-condition-figure" src="https://x/outside.png" alt="" />
        <CatalogImageLightbox />
      </>,
    )
    fireEvent.click(document.querySelector('img')!)
    expect(screen.queryByTestId('catalog-image-lightbox')).toBeNull()
  })
})
