import { afterEach, describe, it, expect, vi } from 'vitest'

// getAssetUrl reads import.meta.env at module load; test the R2 branch by
// stubbing the env before a dynamic import of a fresh module instance.
describe('getAssetUrl with VITE_ASSETS_BASE_URL', () => {
  afterEach(() => vi.unstubAllEnvs())

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
  })

  it('uses the restored graph and formula images for archived physics lessons', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_ASSETS_BASE_URL', 'https://assets.alminion.ru')
    const { getAssetUrl } = await import('@/hooks/useCatalog')

    expect(getAssetUrl('physics-ege/35343/17965.png')).toBe(
      '/assets/physics-legacy-v1/physics-ege/35343/17965.png',
    )
    expect(getAssetUrl('physics-ege/241059/index-43c011cb268a4bf951af31036aef5642.svg')).toBe(
      '/assets/physics-legacy-v1/physics-ege/241059/index-43c011cb268a4bf951af31036aef5642.svg',
    )
    expect(getAssetUrl('physics-ege/379701/175123%20(2).png')).toBe(
      '/assets/physics-legacy-v1/physics-ege/379701/175123%20(2).png',
    )
  })
})
