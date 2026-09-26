import { describe, expect, it, vi } from 'vitest'
import { HEIC_REFUSAL, isHeic, prepareWorkFiles, WORK_FILE_MAX_BYTES } from '@/lib/heicToJpeg'

/** §229. Файлы второй части: отбор как у ДЗ, HEIC → JPEG до загрузки, понятный отказ. */

const file = (name: string, type: string, size = 10) => {
  const f = new File(['x'.repeat(Math.min(size, 64))], name, { type })
  if (size > 64) Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('prepareWorkFiles', () => {
  it('HEIC переводится в JPEG — уходит JPEG, не HEIC', async () => {
    const jpg = file('IMG_1.jpg', 'image/jpeg')
    const convert = vi.fn(async () => jpg)
    const r = await prepareWorkFiles([file('IMG_1.HEIC', 'image/heic')], convert)
    expect(convert).toHaveBeenCalledTimes(1)
    expect(r.accepted).toEqual([jpg])
    expect(r.rejected).toEqual([])
  })

  it('браузер не смог перевести HEIC — отказ ДО загрузки: «сохраните как JPG»', async () => {
    const heic = file('IMG_2.heif', '')
    const r = await prepareWorkFiles([heic, file('p.jpg', 'image/jpeg')], async () => null)
    expect(r.accepted.map(f => f.name)).toEqual(['p.jpg'])
    expect(r.rejected).toEqual([{ file: heic, problem: HEIC_REFUSAL }])
    expect(HEIC_REFUSAL).toContain('Сохраните фото как JPG')
  })

  it('PDF принимается как есть; RAW (.dng) — отказ §173; PDF больше 50 МБ — отказ словами', async () => {
    const pdf = file('скан.pdf', 'application/pdf')
    const big = file('огромный.pdf', 'application/pdf', WORK_FILE_MAX_BYTES + 1)
    const dng = file('IMG_3.DNG', 'image/x-adobe-dng')
    const r = await prepareWorkFiles([pdf, big, dng], async () => null)
    expect(r.accepted).toEqual([pdf])
    expect(r.rejected.map(x => x.file.name)).toEqual(['IMG_3.DNG', 'огромный.pdf'])
    expect(r.rejected[0].problem).toMatch(/RAW/)
    expect(r.rejected[1].problem).toMatch(/50 МБ/)
  })

  it('HEIC узнаётся и по расширению при пустом типе', () => {
    expect(isHeic({ name: 'a.HEIC', type: '' })).toBe(true)
    expect(isHeic({ name: 'a.jpg', type: 'image/heif' })).toBe(true)
    expect(isHeic({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false)
  })
})
