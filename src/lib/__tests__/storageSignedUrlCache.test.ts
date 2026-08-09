import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

let issued = 0
const createSignedUrl = vi.fn(async () => {
  issued += 1
  // Настоящий Storage каждый раз отдаёт НОВЫЙ адрес: token в query другой.
  return { data: { signedUrl: `https://storage/object/sign/topic-materials/file.pdf?token=${issued}` }, error: null }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUrl: (...a: unknown[]) => createSignedUrl(...(a as [])) }) } },
}))

import {
  getSignedFileUrl, forgetSignedUrl, clearSignedUrlCache,
  SIGNED_URL_TTL_S, SHORT_SIGNED_URL_TTL_S,
} from '@/lib/storage'

const PATH = 'topic-1/1786140236248_konspekt.pdf'

/**
 * §105. Браузерный кэш ключуется по URL целиком. Пока подпись выдавалась
 * заново на каждый показ, `Cache-Control: max-age=3600` на объекте не
 * срабатывал ни разу — каждое открытие PDF было повторной закачкой.
 */
describe('Кэш подписанных ссылок', () => {
  beforeEach(() => {
    issued = 0
    createSignedUrl.mockClear()
    clearSignedUrlCache()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('второй показ того же файла даёт ТОТ ЖЕ адрес', async () => {
    const first = await getSignedFileUrl('topic-materials', PATH)
    const second = await getSignedFileUrl('topic-materials', PATH)

    expect(second).toBe(first)
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('десять картинок одной темы разом — одна подпись на путь', async () => {
    const urls = await Promise.all(Array.from({ length: 10 }, () => getSignedFileUrl('topic-materials', PATH)))

    expect(new Set(urls).size).toBe(1)
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('разные файлы не путаются', async () => {
    const a = await getSignedFileUrl('topic-materials', PATH)
    const b = await getSignedFileUrl('topic-materials', 'topic-1/другой.pdf')

    expect(a).not.toBe(b)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('один путь в разных бакетах — разные ссылки', async () => {
    await getSignedFileUrl('topic-materials', PATH)
    await getSignedFileUrl('topic-homework', PATH)

    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('срок вышел — подписываем заново', async () => {
    vi.useFakeTimers()
    const first = await getSignedFileUrl('topic-materials', PATH)

    // Запас в минуту: ссылку у самого края срока не переиспользуем, иначе
    // большой файл оборвался бы на середине закачки.
    vi.advanceTimersByTime((SIGNED_URL_TTL_S - 30) * 1000)
    const second = await getSignedFileUrl('topic-materials', PATH)

    expect(second).not.toBe(first)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('в пределах срока ссылка живёт', async () => {
    vi.useFakeTimers()
    const first = await getSignedFileUrl('topic-materials', PATH)

    vi.advanceTimersByTime((SIGNED_URL_TTL_S - 120) * 1000)
    expect(await getSignedFileUrl('topic-materials', PATH)).toBe(first)
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  /** Гейт §95: у решения свой, короткий срок — и свой ключ в кэше. */
  it('короткая ссылка не подменяется длинной', async () => {
    const long = await getSignedFileUrl('topic-materials', PATH, SIGNED_URL_TTL_S)
    const short = await getSignedFileUrl('topic-materials', PATH, SHORT_SIGNED_URL_TTL_S)

    expect(short).not.toBe(long)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
    expect(createSignedUrl.mock.calls[1][1]).toBe(SHORT_SIGNED_URL_TTL_S)
  })

  it('короткая ссылка перестаёт переиспользоваться раньше длинной', async () => {
    vi.useFakeTimers()
    const first = await getSignedFileUrl('topic-materials', PATH, SHORT_SIGNED_URL_TTL_S)

    vi.advanceTimersByTime((SHORT_SIGNED_URL_TTL_S - 30) * 1000)
    expect(await getSignedFileUrl('topic-materials', PATH, SHORT_SIGNED_URL_TTL_S)).not.toBe(first)
  })

  it('forgetSignedUrl заставляет подписать заново — и длинную, и короткую', async () => {
    const first = await getSignedFileUrl('topic-materials', PATH)
    await getSignedFileUrl('topic-materials', PATH, SHORT_SIGNED_URL_TTL_S)

    forgetSignedUrl('topic-materials', PATH)

    expect(await getSignedFileUrl('topic-materials', PATH)).not.toBe(first)
    expect(await getSignedFileUrl('topic-materials', PATH, SHORT_SIGNED_URL_TTL_S)).toBeTruthy()
    expect(createSignedUrl).toHaveBeenCalledTimes(4)
  })

  it('ошибка подписи не кэшируется', async () => {
    createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'нет прав' } } as never)

    await expect(getSignedFileUrl('topic-materials', PATH)).rejects.toThrow()
    // Второй заход обязан сходить в Storage снова, а не отдать «ошибку из кэша».
    await expect(getSignedFileUrl('topic-materials', PATH)).resolves.toContain('token=')
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('имя для скачивания не смешивается с просмотром', async () => {
    const view = await getSignedFileUrl('topic-materials', PATH)
    const download = await getSignedFileUrl('topic-materials', PATH, SIGNED_URL_TTL_S, 'конспект.pdf')

    expect(download).not.toBe(view)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('пустой путь в Storage не ходит', async () => {
    expect(await getSignedFileUrl('topic-materials', null)).toBeNull()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})

/**
 * §105, второй уровень: ссылка переживает F5, иначе весь выигрыш держался бы
 * на памяти вкладки. Хранилище — sessionStorage: умирает вместе с вкладкой.
 */
describe('Ссылки переживают перезагрузку', () => {
  beforeEach(() => {
    issued = 0
    createSignedUrl.mockClear()
    clearSignedUrlCache()
  })

  it('после перезагрузки адрес тот же — файл берётся из кэша браузера', async () => {
    const first = await getSignedFileUrl('topic-materials', PATH)

    // Перезагрузка страницы: модуль поднимается заново, память вкладки пуста,
    // sessionStorage переживает. Именно так это и выглядит после F5.
    vi.resetModules()
    const reloaded = await import('@/lib/storage')

    expect(await reloaded.getSignedFileUrl('topic-materials', PATH)).toBe(first)
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('файл под гейтом в sessionStorage не сохраняется', async () => {
    await getSignedFileUrl('topic-materials', PATH, SHORT_SIGNED_URL_TTL_S)

    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('signed-url:'))
    expect(keys).toHaveLength(0)
  })

  it('обычная ссылка в sessionStorage сохраняется', async () => {
    await getSignedFileUrl('topic-materials', PATH)

    const keys = Object.keys(sessionStorage).filter(k => k.startsWith('signed-url:'))
    expect(keys).toHaveLength(1)
  })
})
