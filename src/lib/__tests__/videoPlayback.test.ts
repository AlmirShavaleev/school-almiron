import { describe, expect, it } from 'vitest'
import { bunnyGuidOf, playUrl } from '@/lib/videoPlayback'

/** Письмо 27.10: плеер по нажатию — сразу играет и не тянет ролик заранее. */
describe('playUrl / bunnyGuidOf', () => {
  const GUID = '0016b4df-58da-4ba4-b94a-cdc2d4584d86'
  it('Bunny: autoplay=true, preload=false, свои параметры сохраняются', () => {
    const u = new URL(playUrl(`https://iframe.mediadelivery.net/embed/726880/${GUID}?responsive=true`))
    expect(u.searchParams.get('autoplay')).toBe('true')
    expect(u.searchParams.get('preload')).toBe('false')
    expect(u.searchParams.get('responsive')).toBe('true')
  })
  it('YouTube и прочие: autoplay=1; кривой адрес — как есть', () => {
    expect(new URL(playUrl('https://www.youtube.com/embed/abc')).searchParams.get('autoplay')).toBe('1')
    expect(playUrl('не адрес')).toBe('не адрес')
  })
  it('guid из embed и play-адреса; чужой адрес — null', () => {
    expect(bunnyGuidOf(`https://iframe.mediadelivery.net/embed/726880/${GUID}`)).toBe(GUID)
    expect(bunnyGuidOf(`https://player.mediadelivery.net/play/726880/${GUID}`)).toBe(GUID)
    expect(bunnyGuidOf('https://www.youtube.com/embed/abc')).toBeNull()
  })
})
