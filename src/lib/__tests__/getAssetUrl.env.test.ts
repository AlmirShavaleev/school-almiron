import { describe, it, expect, vi } from 'vitest'

// getAssetUrl reads import.meta.env at module load; test the R2 branch by
// stubbing the env before a dynamic import of a fresh module instance.
describe('getAssetUrl with VITE_ASSETS_BASE_URL', () => {
  it('builds encoded R2 URLs from decoded storage paths', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_ASSETS_BASE_URL', 'https://assets.alminion.ru/')
    const { getAssetUrl } = await import('@/hooks/useCatalog')
    expect(getAssetUrl('math-oge/312908/1%20(1).png')).toBe(
      'https://assets.alminion.ru/math-oge/312908/1%20(1).png'
    )
    expect(getAssetUrl('physics-ege/117331/64981 - 3.png')).toBe(
      'https://assets.alminion.ru/physics-ege/117331/64981%20-%203.png'
    )
    expect(getAssetUrl('math-ege/1/plain.svg')).toBe(
      'https://assets.alminion.ru/math-ege/1/plain.svg'
    )
    vi.unstubAllEnvs()
  })
})
