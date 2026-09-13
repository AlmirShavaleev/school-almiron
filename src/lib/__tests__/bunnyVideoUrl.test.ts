import { describe, expect, it } from 'vitest'
import {
  BUNNY_DEFAULT_LIBRARY_ID,
  bunnyEmbedUrl,
  normalizeBunnyVideoUrl,
  parseBunnyVideoUrl,
} from '@/lib/bunnyVideoUrl'

/**
 * §168. Панель Bunny даёт скопировать четыре вида адреса одного ролика, а
 * плеер платформы и статистика §146 понимают один. Каждый вид — своя проверка:
 * два из них (play и поток CDN) 12.09 реально были прикреплены к темам.
 */

const GUID = '0016b4df-58da-4ba4-b94a-cdc2d4584d86'
const EMBED = `https://iframe.mediadelivery.net/embed/726880/${GUID}`

describe('normalizeBunnyVideoUrl — пять видов адреса', () => {
  it('embed-адрес остаётся embed-адресом', () => {
    expect(normalizeBunnyVideoUrl(EMBED)).toBe(EMBED)
  })

  it('страница «play» приводится к embed той же библиотеки', () => {
    expect(normalizeBunnyVideoUrl(`https://player.mediadelivery.net/play/726880/${GUID}`)).toBe(EMBED)
    // Тот же глагол на хосте iframe — Bunny даёт и такой «Direct Play».
    expect(normalizeBunnyVideoUrl(`https://iframe.mediadelivery.net/play/726880/${GUID}`)).toBe(EMBED)
  })

  it('прямой поток CDN (playlist.m3u8) — библиотека наша по умолчанию', () => {
    expect(normalizeBunnyVideoUrl(`https://vz-8c1e2d3f-a4b.b-cdn.net/${GUID}/playlist.m3u8`)).toBe(EMBED)
    expect(normalizeBunnyVideoUrl(`https://vz-8c1e2d3f-a4b.b-cdn.net/${GUID}/play_720p.mp4`)).toBe(EMBED)
  })

  it('голый guid — библиотека наша по умолчанию', () => {
    expect(normalizeBunnyVideoUrl(GUID)).toBe(EMBED)
    expect(normalizeBunnyVideoUrl(`  ${GUID}\n`)).toBe(EMBED)
  })

  it('не-Bunny ссылка — null, вызывающий оставляет её как есть', () => {
    expect(normalizeBunnyVideoUrl('https://youtu.be/abc123')).toBeNull()
    expect(normalizeBunnyVideoUrl('https://www.youtube.com/embed/abc123')).toBeNull()
    expect(normalizeBunnyVideoUrl('https://rutube.ru/video/1234567890abcdef/')).toBeNull()
    expect(normalizeBunnyVideoUrl('https://example.com/video.mp4')).toBeNull()
    expect(normalizeBunnyVideoUrl('')).toBeNull()
    expect(normalizeBunnyVideoUrl(null)).toBeNull()
    expect(normalizeBunnyVideoUrl('не ссылка')).toBeNull()
  })
})

describe('normalizeBunnyVideoUrl — детали', () => {
  it('библиотека берётся из адреса, а не подменяется нашей', () => {
    expect(normalizeBunnyVideoUrl(`https://iframe.mediadelivery.net/embed/999/${GUID}`))
      .toBe(`https://iframe.mediadelivery.net/embed/999/${GUID}`)
    expect(normalizeBunnyVideoUrl(`https://player.mediadelivery.net/play/999/${GUID}`))
      .toBe(`https://iframe.mediadelivery.net/embed/999/${GUID}`)
  })

  it('параметры плеера (?autoplay=…) отбрасываются — в базе ~350 адресов без них', () => {
    expect(normalizeBunnyVideoUrl(`${EMBED}?autoplay=false&preload=false`)).toBe(EMBED)
  })

  it('адрес без схемы и guid в верхнем регистре тоже узнаются', () => {
    expect(normalizeBunnyVideoUrl(`iframe.mediadelivery.net/embed/726880/${GUID}`)).toBe(EMBED)
    expect(normalizeBunnyVideoUrl(GUID.toUpperCase())).toBe(EMBED)
  })

  it('хост Bunny с чужим путём или не-guid идентификатором — не видео', () => {
    expect(normalizeBunnyVideoUrl('https://iframe.mediadelivery.net/embed/726880/not-a-guid')).toBeNull()
    expect(normalizeBunnyVideoUrl('https://iframe.mediadelivery.net/')).toBeNull()
    expect(normalizeBunnyVideoUrl('https://vz-abc.b-cdn.net/not-a-guid/playlist.m3u8')).toBeNull()
    // Похожий домен — не Bunny.
    expect(normalizeBunnyVideoUrl(`https://mediadelivery.net.example.com/embed/726880/${GUID}`)).toBeNull()
  })
})

describe('parseBunnyVideoUrl / bunnyEmbedUrl', () => {
  it('возвращает guid и библиотеку, когда она есть в адресе', () => {
    expect(parseBunnyVideoUrl(EMBED)).toEqual({ libraryId: '726880', guid: GUID })
    expect(parseBunnyVideoUrl(`https://vz-x.b-cdn.net/${GUID}/playlist.m3u8`)).toEqual({ libraryId: null, guid: GUID })
    expect(parseBunnyVideoUrl(GUID)).toEqual({ libraryId: null, guid: GUID })
    expect(parseBunnyVideoUrl('https://youtu.be/abc')).toBeNull()
  })

  it('embed-адрес собирается с нашей библиотекой по умолчанию', () => {
    expect(BUNNY_DEFAULT_LIBRARY_ID).toBe('726880')
    expect(bunnyEmbedUrl(GUID)).toBe(EMBED)
    expect(bunnyEmbedUrl(GUID, '1')).toBe(`https://iframe.mediadelivery.net/embed/1/${GUID}`)
  })
})
