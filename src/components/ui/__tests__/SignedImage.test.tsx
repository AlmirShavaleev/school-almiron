import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const getSignedFileUrl = vi.fn()
vi.mock('@/lib/storage', () => ({
  getSignedFileUrl: (...args: unknown[]) => getSignedFileUrl(...args),
}))

import { SignedImage } from '@/components/ui/SignedImage'

function renderImage() {
  return render(
    <SignedImage bucket="topic-materials" path="topic-1/file.png" alt="картинка" />,
  )
}

describe('SignedImage', () => {
  beforeEach(() => {
    getSignedFileUrl.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('показывает картинку после подписи', async () => {
    getSignedFileUrl.mockResolvedValue('https://signed/one.png')
    renderImage()
    const img = await screen.findByTestId('signed-image')
    expect(img).toHaveAttribute('src', 'https://signed/one.png')
  })

  /**
   * Регрессия §97. С `loading="lazy"` браузер не присылает ни `load`, ни
   * `error` — картинка не грузится, а компонент ждёт `onLoad`, чтобы её
   * показать. Итог на проде — вечный спиннер, который нечем прервать.
   */
  it('не ставит loading="lazy" — с ним не приходит ни load, ни error', async () => {
    getSignedFileUrl.mockResolvedValue('https://signed/one.png')
    renderImage()
    const img = await screen.findByTestId('signed-image')
    expect(img).not.toHaveAttribute('loading', 'lazy')
  })

  /** Вторая половина той же ловушки: скрытая картинка тоже не грузится. */
  it('не прячет картинку, пока она грузится', async () => {
    getSignedFileUrl.mockResolvedValue('https://signed/one.png')
    renderImage()
    const img = await screen.findByTestId('signed-image')
    expect(img.className).not.toContain('hidden')
  })

  it('после ошибки подписывает ссылку ещё раз — протухшая чинится сама', async () => {
    getSignedFileUrl
      .mockResolvedValueOnce('https://signed/stale.png')
      .mockResolvedValueOnce('https://signed/fresh.png')
    renderImage()

    fireEvent.error(await screen.findByTestId('signed-image'))

    await waitFor(async () =>
      expect(await screen.findByTestId('signed-image')).toHaveAttribute('src', 'https://signed/fresh.png'))
    expect(getSignedFileUrl).toHaveBeenCalledTimes(2)
  })

  it('вторая ошибка подряд даёт заглушку, а не бесконечные попытки', async () => {
    getSignedFileUrl.mockResolvedValue('https://signed/broken.png')
    renderImage()

    fireEvent.error(await screen.findByTestId('signed-image'))
    fireEvent.error(await screen.findByTestId('signed-image'))

    expect(await screen.findByTestId('signed-image-failed')).toBeInTheDocument()
    expect(getSignedFileUrl).toHaveBeenCalledTimes(2)
  })

  it('отказ подписи показывает заглушку', async () => {
    getSignedFileUrl.mockRejectedValue(new Error('нет прав'))
    renderImage()
    expect(await screen.findByTestId('signed-image-failed')).toBeInTheDocument()
  })

  it('пустой путь не уходит в подпись', async () => {
    render(<SignedImage bucket="topic-materials" path={null} alt="картинка" />)
    expect(await screen.findByTestId('signed-image-failed')).toBeInTheDocument()
    expect(getSignedFileUrl).not.toHaveBeenCalled()
  })
})
