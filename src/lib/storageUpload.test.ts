import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sign, directUpload } = vi.hoisted(() => ({
  sign: vi.fn(),
  directUpload: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUploadUrl: sign, upload: directUpload }) } },
}))
vi.mock('@/lib/storage', () => ({ UPLOAD_CACHE_CONTROL_S: '3600' }))
import { uploadToStorage } from './storageUpload'

class FakeXHR {
  static latest: FakeXHR
  status = 200
  upload: { onprogress?: (e: { loaded: number; total: number; lengthComputable: boolean }) => void } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort = vi.fn(() => this.onabort?.())
  constructor() { FakeXHR.latest = this }
}

describe('timed homework upload idle timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    sign.mockReset()
    sign.mockResolvedValue({ data: { signedUrl: 'https://example.test/upload' }, error: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const file = () => new File(['photo'], 'page.jpg', { type: 'image/jpeg' })

  it('aborts when transfer makes no progress', async () => {
    const transfer = uploadToStorage('bucket', 'page.jpg', file(), undefined, { idleTimeoutMs: 1000 })
    const rejection = expect(transfer).rejects.toThrow('Нет прогресса загрузки')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(FakeXHR.latest.abort).toHaveBeenCalledOnce()
  })

  it('allows a long transfer as long as progress continues', async () => {
    const progress = vi.fn()
    const transfer = uploadToStorage('bucket', 'page.jpg', file(), progress, { idleTimeoutMs: 1000 })
    await Promise.resolve()
    const xhr = FakeXHR.latest
    for (const loaded of [1, 2, 3]) {
      await vi.advanceTimersByTimeAsync(900)
      xhr.upload.onprogress?.({ loaded, total: 4, lengthComputable: true })
    }
    xhr.onload?.()
    await transfer
    expect(progress).toHaveBeenLastCalledWith(75)
    await vi.advanceTimersByTimeAsync(1000)
    expect(xhr.abort).not.toHaveBeenCalled()
  })

  it('clears the timeout when the request fails', async () => {
    const transfer = uploadToStorage('bucket', 'page.jpg', file(), undefined, { idleTimeoutMs: 1000 })
    const rejection = expect(transfer).rejects.toThrow('Ошибка сети')
    await Promise.resolve()
    FakeXHR.latest.onerror?.()
    await rejection
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeXHR.latest.abort).not.toHaveBeenCalled()
  })
})
