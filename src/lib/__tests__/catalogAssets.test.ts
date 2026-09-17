import { describe, expect, it } from 'vitest'
import {
  CATALOG_ASSETS_BUCKET,
  CATALOG_ASSET_ACCEPT,
  buildCatalogAssetPath,
  catalogAssetProblem,
  copyablePaths,
  isDuplicateStorageError,
  normalizeAssetFileName,
  normalizeAssetFolder,
  type CatalogAssetUploadResult,
} from '@/lib/catalogAssets'

/**
 * §195. Правила бакета картинок каталога, проверенные до всякой сети: что
 * поедет в бакет, каким ключом ляжет и как отличить «уже есть» от настоящей
 * ошибки. Всё это решает, потеряет человек файлы в папке-призраке или нет.
 */

const MB = 1024 * 1024
const file = (name: string, type: string, size = 1024) => ({ name, type, size })

describe('normalizeAssetFolder — папка из того, что набрали руками', () => {
  it('срезает слеши по краям и склеивает двойные', () => {
    expect(normalizeAssetFolder('/physics-ege/author-kinematics/')).toBe('physics-ege/author-kinematics')
    expect(normalizeAssetFolder('physics-ege//author-kinematics')).toBe('physics-ege/author-kinematics')
  })

  it('убирает пробелы по краям и у каждого сегмента', () => {
    expect(normalizeAssetFolder('  physics-ege / author-kinematics  ')).toBe('physics-ege/author-kinematics')
  })

  it('пустая строка и один слеш — корень бакета', () => {
    expect(normalizeAssetFolder('')).toBe('')
    expect(normalizeAssetFolder('   ')).toBe('')
    expect(normalizeAssetFolder('/')).toBe('')
  })
})

describe('buildCatalogAssetPath — ключ объекта', () => {
  it('папка + имя файла', () => {
    expect(buildCatalogAssetPath('/physics-ege/author-kinematics/', 'fig-1.png'))
      .toBe('physics-ege/author-kinematics/fig-1.png')
  })

  it('без папки — корень, без ведущего слеша', () => {
    expect(buildCatalogAssetPath('', 'fig-1.png')).toBe('fig-1.png')
  })

  it('имя не переименовывает: пробелы, скобки и кириллица остаются как на диске', () => {
    expect(buildCatalogAssetPath('physics-ege/kin', '64981 - 3 (копия).png'))
      .toBe('physics-ege/kin/64981 - 3 (копия).png')
  })

  it('разделители пути внутри имени не создают вложенность', () => {
    expect(normalizeAssetFileName('kinematics/fig 1.png')).toBe('kinematics_fig 1.png')
    expect(buildCatalogAssetPath('physics-ege', 'a/b.png')).toBe('physics-ege/a_b.png')
  })
})

describe('catalogAssetProblem — отбор до загрузки', () => {
  it('пропускает форматы бакета', () => {
    expect(catalogAssetProblem(file('a.svg', 'image/svg+xml'))).toBeNull()
    expect(catalogAssetProblem(file('a.png', 'image/png'))).toBeNull()
    expect(catalogAssetProblem(file('a.jpg', 'image/jpeg'))).toBeNull()
    expect(catalogAssetProblem(file('a.webp', 'image/webp'))).toBeNull()
  })

  it('отсеивает чужой формат и называет допустимые', () => {
    const why = catalogAssetProblem(file('scan.pdf', 'application/pdf'))
    expect(why).toMatch(/\.pdf/)
    expect(why).toMatch(/SVG, PNG, JPEG или WebP/)
  })

  it('судит по расширению, когда браузер не сообщил тип', () => {
    expect(catalogAssetProblem(file('a.png', ''))).toBeNull()
    expect(catalogAssetProblem(file('a.gif', 'application/octet-stream'))).toMatch(/\.gif/)
  })

  it('отсеивает файл больше 5 МБ и показывает его размер', () => {
    expect(catalogAssetProblem(file('big.png', 'image/png', 5 * MB))).toBeNull()
    const why = catalogAssetProblem(file('big.png', 'image/png', 5 * MB + 1))
    expect(why).toMatch(/5 МБ/)
    expect(why).toMatch(/5\.0 МБ/)
  })

  it('у большого файла чужого формата первым называется формат — его и можно исправить', () => {
    expect(catalogAssetProblem(file('raw.dng', 'image/x-adobe-dng', 30 * MB))).toMatch(/\.dng/)
  })
})

describe('isDuplicateStorageError — «уже есть» это не ошибка', () => {
  it('узнаёт отказ Storage по коду', () => {
    expect(isDuplicateStorageError({ statusCode: '409', message: 'The resource already exists' })).toBe(true)
    expect(isDuplicateStorageError({ status: 409, message: 'nope' })).toBe(true)
  })

  it('узнаёт его по тексту, когда кода нет', () => {
    expect(isDuplicateStorageError({ message: 'Duplicate' })).toBe(true)
  })

  it('не путает с отказом прав и с сетью', () => {
    expect(isDuplicateStorageError({ statusCode: '403', message: 'new row violates row-level security policy' })).toBe(false)
    expect(isDuplicateStorageError(new Error('Failed to fetch'))).toBe(false)
    expect(isDuplicateStorageError(null)).toBe(false)
  })
})

describe('copyablePaths — что уезжает в буфер', () => {
  const row = (path: string, status: CatalogAssetUploadResult['status']): CatalogAssetUploadResult =>
    ({ fileName: path, path, size: 1, status, detail: null })

  it('берёт залитые, перезаписанные и пропущенные — они все лежат в бакете', () => {
    expect(copyablePaths([row('a.png', 'uploaded'), row('b.png', 'skipped'), row('c.png', 'replaced')]))
      .toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('упавшие не берёт: их путь вёл бы в никуда', () => {
    expect(copyablePaths([row('a.png', 'uploaded'), row('b.png', 'failed')])).toEqual(['a.png'])
  })
})

describe('константы бакета', () => {
  it('имя бакета одно на приложение', () => {
    expect(CATALOG_ASSETS_BUCKET).toBe('catalog-assets')
  })

  it('accept пикера перечисляет и типы, и расширения', () => {
    expect(CATALOG_ASSET_ACCEPT).toContain('image/svg+xml')
    expect(CATALOG_ASSET_ACCEPT).toContain('.webp')
    expect(CATALOG_ASSET_ACCEPT).not.toContain('image/*')
  })
})
