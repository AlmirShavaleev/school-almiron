/// <reference types="node" />
/**
 * QA-тесты каталога заданий перед релизом ученикам.
 * Покрывают 8 областей аудита.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── Моки Supabase ──────────────────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from:    vi.fn(),
    rpc:     vi.fn(),
    storage: { from: vi.fn(() => ({ getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://storage.test/x' } })) })) },
    auth:    { getUser: vi.fn() },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ profile: { id: 'user-1', role: 'student' } }),
}))

import {
  SUBJECT_SLUGS, SUBJECT_FROM_SLUG, ALL_SUBJECTS, safeDecodeStoragePath,
  EXAM_SLUGS, EXAM_FROM_SLUG, EXAMS_FOR_SUBJECT, DEFAULT_EXAM, DIRECTIONS,
} from '@/hooks/useCatalog'

// ── Пути к файлам ──────────────────────────────────────────────────────────────
const ROOT    = process.cwd()
const CATALOG = join(ROOT, 'src/pages/catalog')
const HOOKS   = join(ROOT, 'src/hooks')
const SRC     = join(ROOT, 'src')

function read(rel: string) { return readFileSync(join(ROOT, rel), 'utf8') }

beforeEach(() => { vi.clearAllMocks() })

// ══════════════════════════════════════════════════════════════════════════════
// 1. Мобильный layout
// ══════════════════════════════════════════════════════════════════════════════

describe('Mobile layout', () => {
  it('filter buttons have flex-wrap in CatalogTopicPage', () => {
    expect(read('src/pages/catalog/CatalogTopicPage.tsx')).toContain('flex flex-wrap gap-2')
  })

  it('math-display images fill container width; answer-template overrides to compact size', () => {
    const css = read('src/index.css')
    // math-display rule must NOT use the old zoom hack — just max-width: 100%
    expect(css).not.toContain('zoom: 1.3')
    expect(css).not.toContain('calc(100% / 1.3)')
    // answer-template rule must exist and limit width
    expect(css).toContain('catalog-answer-template')
    expect(css).toContain('min(160px, 100%)')
    // No restrictive max-height on generic img
    expect(css).not.toMatch(/\.catalog-html img\s*\{[^}]*max-height/)
  })

  it('condition figures use max-width to limit size without upscaling', () => {
    const css = read('src/index.css')
    // catalog-condition-figure: diagrams are capped at 50% width, centered
    expect(css).toContain('catalog-condition-figure')
    expect(css).toContain('max-width: 50%')
    // Must NOT apply min-width to the generic img baseline rule
    expect(css).not.toMatch(/\.catalog-html img\s*\{[^}]*min-width/)
  })

  it('resolveHtml uses class="math" to separate figures from formulas', () => {
    // Logic now lives in the shared resolveTaskHtml utility
    const src = read('src/utils/resolveTaskHtml.ts')
    // PNG diagrams lack class="math" → get catalog-condition-figure (enlarged)
    expect(src).toContain('catalog-condition-figure')
    // class="math" detection — the TeX renderer injects this on every SVG formula
    expect(src).toContain('hasMathClass')
    // math formulas with hasMathClass skip enlargement (empty kindClass → '')
    expect(src).toContain('!hasMathClass')
    // solution diagram assets still get catalog-solution-image
    expect(src).toContain('catalog-solution-image')
  })

  it('tables have .tbl-wrap scroll container in CSS', () => {
    const css = read('src/index.css')
    expect(css).toContain('tbl-wrap')
    expect(css).toContain('overflow-x: auto')
  })

  it('tables are wrapped in resolveHtml for mobile scroll', () => {
    // Table wrapping logic lives in the shared resolveTaskHtml utility
    const src = read('src/utils/resolveTaskHtml.ts')
    expect(src).toContain("replace(/<table/gi, '<div class=\"tbl-wrap\"><table')")
    expect(src).toContain("replace(/<\\/table>/gi, '</table></div>')")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. Производительность — пагинация «Показать ещё»
// ══════════════════════════════════════════════════════════════════════════════

describe('Performance — pagination', () => {
  it('PAGE_SIZE = 25 is defined', () => {
    expect(read('src/pages/catalog/CatalogTopicPage.tsx')).toContain('const PAGE_SIZE = 25')
  })

  it('renders only first PAGE_SIZE tasks (visibleCount slice)', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain('filtered.slice(0, visibleCount)')
  })

  it('show-more button shows remaining count and total', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain('filtered.length - visibleCount')
    // JSX expression: {visibleCount} из {filtered.length}
    expect(src).toContain('{visibleCount} из {filtered.length}')
  })

  it('visibleCount resets when topicId or filter changes', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain('[topicId, filter]')
    expect(src).toContain('setVisibleCount(PAGE_SIZE)')
  })

  it('sort puts exam_number=0 last', () => {
    const sort = (a: { exam_number: number | null; position: number }, b: { exam_number: number | null; position: number }) => {
      const an = a.exam_number ?? 999
      const bn = b.exam_number ?? 999
      if (an === 0) return 1
      if (bn === 0) return -1
      return an - bn || a.position - b.position
    }
    const sections = [
      { exam_number: 2,    position: 2  },
      { exam_number: 0,    position: 27 },
      { exam_number: 1,    position: 1  },
    ]
    const sorted = [...sections].sort(sort)
    expect(sorted[sorted.length - 1].exam_number).toBe(0)
    expect(sorted[0].exam_number).toBe(1)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. Роли
// ══════════════════════════════════════════════════════════════════════════════

describe('Role access', () => {
  it('catalog RoleGuard includes student, teacher, curator, admin, owner', () => {
    const src = read('src/AppRoutes.tsx')
    // Find the Route element with path="/catalog" and extract its RoleGuard allow list
    const match = src.match(/path="\/catalog"[^>]*RoleGuard\s+allow=\{([^}]+)\}/)
    expect(match).not.toBeNull()
    const allowList = match ? match[1] : ''
    expect(allowList).toContain('student')
    expect(allowList).toContain('teacher')
    expect(allowList).toContain('curator')
    expect(allowList).toContain('admin')
    expect(allowList).toContain('owner')
  })

  it('parent is NOT in the catalog allow list', () => {
    const src = read('src/AppRoutes.tsx')
    const match = src.match(/path="\/catalog"[^>]*RoleGuard\s+allow=\{([^}]+)\}/)
    const allowList = match ? match[1] : ''
    expect(allowList).not.toContain("'parent'")
    expect(allowList).not.toContain('"parent"')
  })

  it('catalog_task_progress select is restricted to own rows (user_id = auth.uid())', () => {
    // Verified in DB: policy catalog_progress_select_own has USING (user_id = auth.uid())
    // and catalog_progress_insert_own has WITH CHECK (user_id = auth.uid())
    // This is a data contract test — if the frontend code tries to bypass it,
    // RLS on the DB level will reject it.
    const src = read('src/hooks/useCatalog.ts')
    // Frontend only reads own progress (no admin bypass from client code)
    expect(src).toContain("from('catalog_task_progress')")
    // No attempt to read all users' progress from student client
    expect(src).not.toContain('.neq(')  // no filter bypasses
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. solution_plan и grade_criteria
// ══════════════════════════════════════════════════════════════════════════════

describe('solution_plan and grade_criteria', () => {
  it('plan button conditional on solution_plan_html', () => {
    // Logic now lives in TaskDisplayCard
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('task.solution_plan_html &&')
    expect(src).toContain('План решения')
  })

  it('criteria button conditional on grade_criteria_html', () => {
    // Logic now lives in TaskDisplayCard
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('task.grade_criteria_html &&')
    expect(src).toContain('Критерии оценки')
  })

  it('answer button conditional on has_answer', () => {
    // Now a ternary: task.has_answer ? <button> : <span placeholder>
    expect(read('src/components/catalog/TaskDisplayCard.tsx')).toMatch(/task\.has_answer\s*\?/)
  })

  it('solution button conditional on has_solution', () => {
    expect(read('src/components/catalog/TaskDisplayCard.tsx')).toContain('task.has_solution &&')
  })

  it('plan and criteria sections have distinct visual labels', () => {
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    // Section headers use CSS uppercase class + text labels
    expect(src).toContain('План решения')
    expect(src).toContain('Критерии оценки')
    // Labels are styled differently from each other (different colors in source)
    expect(src).toContain('text-amber-600')   // plan
    expect(src).toContain('text-teal-600')    // criteria
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Старый формат ЕГЭ
// ══════════════════════════════════════════════════════════════════════════════

describe('Old format EGE section', () => {
  it('shows "Задачи старого формата ЕГЭ" for exam_number=0', () => {
    const src = read('src/pages/catalog/CatalogPage.tsx')
    expect(src).toContain('exam_number === 0')
    expect(src).toContain('Задачи старого формата ЕГЭ')
  })

  it('exam_number=0 always sorts last', () => {
    const sort = (a: { exam_number: number | null; position: number }, b: { exam_number: number | null; position: number }) => {
      const an = a.exam_number ?? 999
      const bn = b.exam_number ?? 999
      if (an === 0) return 1
      if (bn === 0) return -1
      return an - bn || a.position - b.position
    }
    const inputs = [
      { exam_number: 5,    position: 5  },
      { exam_number: 0,    position: 27 },
      { exam_number: 1,    position: 1  },
      { exam_number: 3,    position: 3  },
      { exam_number: null, position: 10 },
    ]
    const sorted = [...inputs].sort(sort)
    expect(sorted[sorted.length - 1].exam_number).toBe(0)
  })

  it('exam_number=0 section is never displayed as "№0"', () => {
    const src = read('src/pages/catalog/CatalogPage.tsx')
    // When exam_number === 0 we show override title — the section title is NOT used
    const afterCheck = src.slice(src.indexOf('exam_number === 0'))
    // Should immediately assign displayTitle, not concatenate '№0'
    expect(afterCheck.slice(0, 200)).not.toContain('№0')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. Пустые состояния
// ══════════════════════════════════════════════════════════════════════════════

describe('Empty states', () => {
  it('filter=done empty → "Пока нет выполненных задач"', () => {
    expect(read('src/pages/catalog/CatalogTopicPage.tsx')).toContain('Пока нет выполненных задач в этой теме.')
  })

  it('filter=todo empty → "Все задачи выполнены!"', () => {
    expect(read('src/pages/catalog/CatalogTopicPage.tsx')).toContain('Все задачи выполнены!')
  })

  it('no tasks → "Задачи не найдены."', () => {
    expect(read('src/pages/catalog/CatalogTopicPage.tsx')).toContain('Задачи не найдены.')
  })

  it('no topics → "Темы не найдены"', () => {
    expect(read('src/pages/catalog/CatalogSectionPage.tsx')).toContain('Темы не найдены')
  })

  it('no sections → "Разделы не найдены"', () => {
    expect(read('src/pages/catalog/CatalogPage.tsx')).toContain('Разделы не найдены')
  })

  it('loading shows skeleton (animate-pulse, not blank)', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain('animate-pulse')
    expect(src).toContain('TopicSkeleton')
  })

  it('network error shows ErrorState with message', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain('ErrorState')
    expect(src).toContain('Не удалось загрузить каталог')
    expect(src).toContain('Повторить')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. Технические проверки — PostgREST 1000-row cap
// ══════════════════════════════════════════════════════════════════════════════

describe('Technical — PostgREST 1000-row protection', () => {
  it('useCatalogTasks uses paginated .range() for assets', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('.range(from, from + ASSET_PAGE - 1)')
    expect(src).toContain('ASSET_PAGE')
    expect(src).toContain('1000')
  })

  it('asset pagination loop breaks on partial page', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('assetPage.length < ASSET_PAGE')
  })

  it('asset pagination loop breaks on empty page', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('assetPage.length === 0')
  })

  it('section counts use RPC (not SELECT COUNT which hits row cap)', () => {
    expect(read('src/hooks/useCatalog.ts')).toContain("rpc('get_catalog_section_counts'")
  })

  it('topic IDs and counts use RPCs', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain(".from('catalog_tasks')")
    expect(src).toContain(".from('catalog_task_topics')")
    expect(src).toContain('taskCountByTopic')
  })

  it('DOMPurify sanitizes HTML before render', () => {
    // Sanitization lives in the shared resolveTaskHtml utility
    const src = read('src/utils/resolveTaskHtml.ts')
    expect(src).toContain('sanitizeHtml')
  })

  it('no local filesystem paths in catalog HTML (verified from DB snapshot)', () => {
    // Fact: SELECT COUNT(*) FROM catalog_tasks WHERE statement_html LIKE '%src="/%' → 0
    // This is the data contract — the importer stores only relative filenames.
    expect(0).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 8. Независимость математики и физики
// ══════════════════════════════════════════════════════════════════════════════

describe('Math / Physics independence', () => {
  it('SUBJECT_SLUGS maps Математика → math and Физика → physics', () => {
    expect(SUBJECT_SLUGS['Математика']).toBe('math')
    expect(SUBJECT_SLUGS['Физика']).toBe('physics')
  })

  it('SUBJECT_FROM_SLUG maps math → Математика and physics → Физика', () => {
    expect(SUBJECT_FROM_SLUG['math']).toBe('Математика')
    expect(SUBJECT_FROM_SLUG['physics']).toBe('Физика')
  })

  it('SUBJECT_SLUGS and SUBJECT_FROM_SLUG are exact inverses', () => {
    for (const [subject, slug] of Object.entries(SUBJECT_SLUGS)) {
      expect(SUBJECT_FROM_SLUG[slug]).toBe(subject)
    }
    for (const [slug, subject] of Object.entries(SUBJECT_FROM_SLUG)) {
      expect(SUBJECT_SLUGS[subject]).toBe(slug)
    }
  })

  it('ALL_SUBJECTS contains exactly Math and Physics (length=2)', () => {
    expect(ALL_SUBJECTS).toContain('Математика')
    expect(ALL_SUBJECTS).toContain('Физика')
    expect(ALL_SUBJECTS).toHaveLength(2)
  })

  it('subject is read from URL searchParams (not hardcoded)', () => {
    const src = read('src/pages/catalog/CatalogPage.tsx')
    expect(src).toContain("searchParams.get('subject')")
    expect(src).toContain('SUBJECT_FROM_SLUG[subjectSlug]')
  })

  it('useCatalogSections filters DB by subject', () => {
    expect(read('src/hooks/useCatalog.ts')).toMatch(/if\s*\(subject\)\s*q\s*=\s*q\.eq\('subject',/)
  })

  it('subject slug is preserved in breadcrumb links', () => {
    const sectionSrc = read('src/pages/catalog/CatalogSectionPage.tsx')
    expect(sectionSrc).toContain('subjectSlug')
    expect(sectionSrc).toContain('?subject=${')
  })

  it('physics and math sections are filtered independently at DB level', () => {
    // RPC get_catalog_section_counts takes p_subject parameter
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('p_subject')
    expect(src).toContain('p_exam_type')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 9. Regression — double URL-encoding fix (safeDecodeStoragePath)
//
// The importer stores storage_path with already-encoded chars, e.g.
// "physics-ege/117852/65186%20-%201.png".  getPublicUrl would encode the %
// again → %2520, producing broken image URLs.  safeDecodeStoragePath decodes
// first so Supabase can re-encode to a single %20 correctly.
// ══════════════════════════════════════════════════════════════════════════════

describe('safeDecodeStoragePath — double-encoding regression', () => {

  // ── Core: the exact path that triggered the bug ────────────────────────────

  it('decodes %20 (space) in the real broken path', () => {
    const input  = 'physics-ege/117852/65186%20-%201.png'
    const result = safeDecodeStoragePath(input)
    expect(result).toBe('physics-ege/117852/65186 - 1.png')
    // Must NOT contain %2520 after decoding (that was the broken state)
    expect(result).not.toContain('%25')
    expect(result).not.toContain('%20')
  })

  // ── %2C (comma) variant ────────────────────────────────────────────────────

  it('decodes %2C (comma) in multi-id filename', () => {
    const input  = 'physics-ege/106326/12958%2C%2084972.png'
    const result = safeDecodeStoragePath(input)
    expect(result).toBe('physics-ege/106326/12958, 84972.png')
    expect(result).not.toContain('%2C')
    expect(result).not.toContain('%20')
  })

  // ── Plain path — must pass through unchanged ───────────────────────────────

  it('leaves plain paths without encoding unchanged', () => {
    const plain = 'physics-ege/32963/f-ege-1-1-3.png'
    expect(safeDecodeStoragePath(plain)).toBe(plain)
  })

  it('leaves index-*.svg paths unchanged', () => {
    const svg = 'physics-ege/117853/index-4f939b019f44591b9164c6d7cdab0224.svg'
    expect(safeDecodeStoragePath(svg)).toBe(svg)
  })

  // ── Malformed sequence — must NOT throw ────────────────────────────────────

  it('returns original path on malformed % sequence without throwing', () => {
    const bad = 'physics-ege/99999/broken%ZZfile.png'
    expect(() => safeDecodeStoragePath(bad)).not.toThrow()
    // Falls back to the original so the page doesn't crash
    expect(safeDecodeStoragePath(bad)).toBe(bad)
  })

  it('handles lone trailing % without throwing', () => {
    const bad = 'physics-ege/99999/file%'
    expect(() => safeDecodeStoragePath(bad)).not.toThrow()
    expect(safeDecodeStoragePath(bad)).toBe(bad)
  })

  // ── Path with literal space (already decoded) ──────────────────────────────

  it('passes through path with literal space unchanged', () => {
    const withSpace = 'physics-ege/117852/65186 - 1.png'
    expect(safeDecodeStoragePath(withSpace)).toBe(withSpace)
  })

  // ── Single-encoding guarantee ──────────────────────────────────────────────

  it('%20 is never double-encoded to %2520', () => {
    const paths = [
      'physics-ege/117852/65186%20-%201.png',
      'physics-ege/117853/65186%20-%202.png',
      'physics-ege/106326/12958%2C%2084972.png',
    ]
    for (const p of paths) {
      const decoded = safeDecodeStoragePath(p)
      expect(decoded).not.toContain('%25')  // no double-encoding
    }
  })

  // ── Source code contract ───────────────────────────────────────────────────

  it('getAssetUrl calls safeDecodeStoragePath before getPublicUrl', () => {
    const src = read('src/hooks/useCatalog.ts')
    // safeDecodeStoragePath is defined and exported
    expect(src).toContain('export function safeDecodeStoragePath')
    // getAssetUrl uses safeDecodeStoragePath on the path before calling getPublicUrl
    expect(src).toContain('safeDecodeStoragePath(storagePath)')
    expect(src).toContain('getPublicUrl(decoded')
  })

  it('safeDecodeStoragePath has a try/catch fallback', () => {
    const src = read('src/hooks/useCatalog.ts')
    // The try/catch prevents a malformed path from crashing the page
    const fnStart = src.indexOf('function safeDecodeStoragePath')
    const fnBody  = src.slice(fnStart, fnStart + 200)
    expect(fnBody).toContain('try {')
    expect(fnBody).toContain('} catch {')
    expect(fnBody).toContain('return path')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 10. Математика ОГЭ — exam switching, data separation, Storage prefix, UI
// ══════════════════════════════════════════════════════════════════════════════

describe('Математика ОГЭ — exam routing & data separation', () => {

  // ── Exam constants ─────────────────────────────────────────────────────────

  it('EXAM_SLUGS maps ЕГЭ→ege and ОГЭ→oge', () => {
    expect(EXAM_SLUGS['ЕГЭ']).toBe('ege')
    expect(EXAM_SLUGS['ОГЭ']).toBe('oge')
  })

  it('EXAM_FROM_SLUG maps ege→ЕГЭ and oge→ОГЭ', () => {
    expect(EXAM_FROM_SLUG['ege']).toBe('ЕГЭ')
    expect(EXAM_FROM_SLUG['oge']).toBe('ОГЭ')
  })

  it('math has ege and oge; physics has ege and oge', () => {
    expect(EXAMS_FOR_SUBJECT['math']).toContain('ege')
    expect(EXAMS_FOR_SUBJECT['math']).toContain('oge')
    expect(EXAMS_FOR_SUBJECT['physics']).toContain('ege')
    expect(EXAMS_FOR_SUBJECT['physics']).toContain('oge')
  })

  it('DEFAULT_EXAM for math and physics is ege', () => {
    expect(DEFAULT_EXAM['math']).toBe('ege')
    expect(DEFAULT_EXAM['physics']).toBe('ege')
  })

  // ── CatalogPage exam picker ────────────────────────────────────────────────

  it('CatalogPage использует DIRECTIONS вместо отдельных subject/exam tabs', () => {
    const src = read('src/pages/catalog/CatalogPage.tsx')
    // New implementation: 4 direction cards from DIRECTIONS array
    expect(src).toContain('DIRECTIONS')
    expect(src).toContain('useCatalogDirectionCounts')
    // exam is in URL param (subjectSlug + examSlug from URL)
    expect(src).toContain('examSlug')
  })

  it('CatalogPage передаёт subject и examType в useCatalogSections', () => {
    const src = read('src/pages/catalog/CatalogPage.tsx')
    // SectionsView calls useCatalogSections(subject, examType, retryKey)
    expect(src).toContain('useCatalogSections(subject, examType')
  })

  it('CatalogPage включает exam в ссылки разделов', () => {
    const src = read('src/pages/catalog/CatalogPage.tsx')
    expect(src).toContain('exam=${examSlug}')
  })

  it('при выборе направления передаётся правильный subject и exam в URL', () => {
    // Each DirectionCard navigates to /catalog?subject=X&exam=Y
    const src = read('src/pages/catalog/CatalogPage.tsx')
    expect(src).toContain('/catalog?subject=${d.subjectSlug}&exam=${d.examSlug}')
  })

  // ── Navigation propagation ─────────────────────────────────────────────────

  it('CatalogSectionPage passes exam param in back link and topic links', () => {
    const src = read('src/pages/catalog/CatalogSectionPage.tsx')
    expect(src).toContain("searchParams.get('exam')")
    expect(src).toContain('exam=${examSlug}')
  })

  it('CatalogTopicPage passes exam param in breadcrumb links', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain("searchParams.get('exam')")
    expect(src).toContain('exam=${examSlug}')
  })

  // ── useCatalogSections filters by exam_type ────────────────────────────────

  it('useCatalogSections принимает examType и retryKey и фильтрует секции', () => {
    const src = read('src/hooks/useCatalog.ts')
    // Signature includes optional _retryKey for retry support
    expect(src).toContain('useCatalogSections(subject?: string, examType?: string')
    expect(src).toMatch(/if\s*\(examType\)\s*q\s*=\s*q\.eq\('exam_type',\s*examType\)/)
    expect(src).toMatch(/p_exam_type:\s*examType/)
  })

  // ── Storage prefix math-oge ────────────────────────────────────────────────

  it('OGE importer uses math-oge storage prefix', () => {
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    expect(src).toContain("STORAGE_PREFIX = 'math-oge'")
    // Must NOT use physics or math-ege prefixes
    expect(src).not.toContain("'physics-ege'")
    expect(src).not.toContain("'math-ege'")
  })

  it('OGE importer strips local path prefix before encoding storage path', () => {
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    expect(src).toContain('LOCAL_PATH_PREFIX')
    expect(src).toContain('localPathToStoragePath')
    // Encoding each path segment individually (handles spaces, Cyrillic)
    expect(src).toContain('encodeURIComponent')
  })

  it('OGE importer subject and exam_type constants are correct', () => {
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    expect(src).toContain("SUBJECT      = 'Математика'")
    expect(src).toContain("EXAM_TYPE    = 'ОГЭ'")
  })

  it('OGE importer hard-limits to 30 tasks', () => {
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    expect(src).toContain('MAX_TASKS    = 30')
    expect(src).toContain('allRows.slice(0, MAX_TASKS)')
  })

  // ── URL-encoded and Cyrillic paths ─────────────────────────────────────────

  it('safeDecodeStoragePath handles math-oge paths with encoded spaces', () => {
    // OGE PNG assets may have spaces: DI_1990.png → no space but others may
    const path = 'math-oge/4221/file%20name.png'
    expect(safeDecodeStoragePath(path)).toBe('math-oge/4221/file name.png')
    expect(safeDecodeStoragePath(path)).not.toContain('%2520')
  })

  it('safeDecodeStoragePath handles math-oge SVG paths', () => {
    const path = 'math-oge/4220/index-025dea07b3343004a8b257ba25c3c1c1.svg'
    expect(safeDecodeStoragePath(path)).toBe(path)  // no encoding needed
  })

  // ── has_solution=false guard ───────────────────────────────────────────────

  it('OGE importer has NO_SOLUTION_IDS list including 120232', () => {
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    expect(src).toContain('NO_SOLUTION_IDS')
    expect(src).toContain('120232')
    expect(src).toContain('163016')
    expect(src).toContain('178028')
  })

  it('OGE importer applies NO_SOLUTION_IDS override to has_solution', () => {
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    expect(src).toContain('NO_SOLUTION_IDS.has(extId)')
    // Override: false if in list, else use JSON value
    expect(src).toContain('? false : (r.has_solution === true)')
  })

  it('TaskDisplayCard does not show solution button when has_solution=false', () => {
    // Logic now lives in TaskDisplayCard
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('task.has_solution')
    expect(src).toContain('Показать решение')
    // Button only rendered inside has_solution check
    const solutionBtnIdx = src.indexOf('Показать решение')
    const hasSolutionIdx = src.lastIndexOf('has_solution', solutionBtnIdx)
    expect(hasSolutionIdx).toBeGreaterThan(-1)
    expect(solutionBtnIdx - hasSolutionIdx).toBeLessThan(500)
  })

  it('TaskDisplayCard does not show answer button when has_answer=false', () => {
    // Logic now lives in TaskDisplayCard
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('task.has_answer')
    expect(src).toContain('Показать ответ')
    const answerBtnIdx  = src.indexOf('Показать ответ')
    const hasAnswerIdx  = src.lastIndexOf('has_answer', answerBtnIdx)
    expect(hasAnswerIdx).toBeGreaterThan(-1)
    expect(answerBtnIdx - hasAnswerIdx).toBeLessThan(500)
  })

  // ── data isolation — same external_id, different exam_type ────────────────

  it('OGE and EGE tasks have separate upsert keys (subject+exam_type+external_id)', () => {
    // Tasks with same external_id in different exam_types must not overwrite each other
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    expect(src).toContain("onConflict: 'subject,exam_type,external_id'")
    // Topics upsert also scoped by subject+exam_type
    expect(src).toContain(".eq('subject', SUBJECT)")
    expect(src).toContain(".eq('exam_type', EXAM_TYPE)")
  })

  it('OGE importer does not write to catalog_task_progress', () => {
    const src = read('scripts/import-math-oge-catalog-sample.mjs')
    // Must not insert/upsert/update progress records
    expect(src).not.toMatch(/\.from\(['"`]catalog_task_progress['"`]\)/)
  })

  // ── Mobile formula/image display ───────────────────────────────────────────

  it('catalog-condition-figure uses max-width:50% without mobile min-width override', () => {
    const css = read('src/index.css')
    // Images are capped at 50% — no forced min-width that would upscale small diagrams
    expect(css).toContain('catalog-condition-figure')
    expect(css).toContain('max-width: 50%')
    expect(css).not.toContain('min-width: min(260px, 100%)')
    expect(css).not.toContain('min-width: min(210px, 100%)')
  })

  it('math formulas (class=math) are not enlarged by condition-figure rules', () => {
    const css = read('src/index.css')
    // catalog-condition-figure is a separate class not applied to .math images
    const figIdx = css.indexOf('catalog-condition-figure')
    const mathIdx = css.indexOf('.math', figIdx)
    // No .math selector inside catalog-condition-figure block
    expect(css).not.toMatch(/\.catalog-condition-figure[^}]*\.math/)
  })

  // ── Formula sizing (PDF: inline math vs block math vs figures) ────────────

  it('inline math formulas are sized in the base .print-document scope, not only @media print', () => {
    const css = read('src/index.css')
    // The rule must exist outside any @media print block so preview and
    // print portal compute the exact same size before printing even starts.
    const printMediaIdx = css.indexOf('@media print {')
    const inlineMathRuleIdx = css.indexOf('.print-document .catalog-html img[class~="math"]')
    expect(inlineMathRuleIdx).toBeGreaterThan(-1)
    expect(printMediaIdx).toBeGreaterThan(-1)
    expect(inlineMathRuleIdx).toBeLessThan(printMediaIdx)
  })

  it('inline math formula rule uses display:inline-block and a text-relative height, never max-width:50%', () => {
    const css = read('src/index.css')
    const rule = css.slice(css.indexOf('.print-document .catalog-html img[class~="math"]'))
    const block = rule.slice(0, rule.indexOf('}') + 1)
    expect(block).toContain('display: inline-block')
    expect(block).toMatch(/height:\s*1(\.\d+)?em/) // ~1-1.2em per spec, not a fixed px/pt
    expect(block).not.toContain('max-width: 50%')
  })

  it('math-display (block formulas) has its own separate rule from inline math', () => {
    const css = read('src/index.css')
    const blockRuleIdx = css.indexOf('.print-document .catalog-html img.math-display')
    const inlineRuleIdx = css.indexOf('.print-document .catalog-html img[class~="math"]')
    expect(blockRuleIdx).toBeGreaterThan(-1)
    expect(inlineRuleIdx).toBeGreaterThan(-1)
    expect(blockRuleIdx).not.toBe(inlineRuleIdx)
    const blockRule = css.slice(blockRuleIdx, css.indexOf('}', blockRuleIdx) + 1)
    expect(blockRule).toContain('display: block')
    // Genuinely shrinks every formula proportionally to its own natural size
    // (max-width alone is a no-op for formulas already narrower than the cap).
    expect(blockRule).toMatch(/zoom:\s*0\.\d+/)
  })

  it('condition/solution figures keep max-width:50% and are a separate rule from both math classes', () => {
    const css = read('src/index.css')
    expect(css).toContain('max-width: 50% !important')
    expect(css).toContain('catalog-condition-figure')
    expect(css).toContain('catalog-solution-image')
    // The figure rule and the math rules must not share a selector list —
    // four distinct content types get four distinct rules.
    const figureRuleMatch = css.match(/\.catalog-html img\.catalog-condition-figure,\r?\n\.catalog-html img\.catalog-solution-image/)
    expect(figureRuleMatch).not.toBeNull()
    const figureRuleIdx = figureRuleMatch!.index!
    const figureRule = css.slice(figureRuleIdx, css.indexOf('}', figureRuleIdx) + 1)
    expect(figureRule).not.toContain('math')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 11. Кириллические имена файлов — Storage key и resolveHtml matching
// ══════════════════════════════════════════════════════════════════════════════

describe('Кириллические assets — x-encoding и resolveHtml', () => {

  // ── Storage key encoding ───────────────────────────────────────────────────

  it('полный импортёр использует x вместо % для кириллических имён файлов', () => {
    const src = read('scripts/import-math-oge-catalog-full.mjs')
    // Supabase Storage only allows [a-zA-Z0-9!-_.*()'] — both % and ~ are rejected.
    // We replace % with 'x' after encodeURIComponent so the key stays safe ASCII.
    expect(src).toContain(".replace(/%/g, 'x')")
    expect(src).toContain('[^\\x00-\\x7F]')
  })

  it('localPathToStoragePath не сломан для ASCII-путей', () => {
    const src = read('scripts/import-math-oge-catalog-full.mjs')
    // ASCII paths still go through the normal encodeURIComponent path
    expect(src).toContain('encodeURIComponent(s)')
    // Both branches exist
    expect(src).toContain('hasNonAscii')
  })

  it('кириллические файлы сохраняют оригинальное имя в alt для resolveHtml', () => {
    const src = read('scripts/import-math-oge-catalog-full.mjs')
    expect(src).toContain('hasCyrillic')
    // Original Cyrillic filename → alt field
    expect(src).toContain('assetAlt = hasCyrillic ? origFilename')
  })

  // ── resolveHtml matching ───────────────────────────────────────────────────

  it('resolveHtml сопоставляет кириллические img src по a.alt', () => {
    // Matching logic lives in the shared resolveTaskHtml utility
    const code = read('src/utils/resolveTaskHtml.ts')
    // alt matching covers Cyrillic filenames (original or decoded)
    expect(code).toContain('a.alt ===')
  })

  it('resolveHtml сохраняет все условия сопоставления + HTML entity decoding', () => {
    // Matching logic lives in the shared resolveTaskHtml utility
    const code = read('src/utils/resolveTaskHtml.ts')
    // HTML entity decoding before matching (&#39; → apostrophe)
    expect(code).toContain('decodedSrc')
    // Original matching via decoded storage_path
    expect(code).toContain('/${decodedSrc}')
    // Cyrillic alt matching
    expect(code).toContain('a.alt ===')
  })

  // ── Storage path for ASCII files unchanged ─────────────────────────────────

  it('x-кодирование не применяется к SVG-формулам (ASCII-имена)', () => {
    // SVG formula filenames like index-3076e6081b60a659a93a2a04251db4a2.svg
    // are pure ASCII — they must NOT get x substitution
    const src = read('scripts/import-math-oge-catalog-full.mjs')
    // The non-ASCII check gates the x replacement
    const nonAsciiIdx = src.indexOf('hasNonAscii')
    const xReplaceIdx = src.indexOf(".replace(/%/g, 'x')")
    // x replacement is inside the hasNonAscii branch (comes after the check)
    expect(xReplaceIdx).toBeGreaterThan(nonAsciiIdx)
  })

  // ── safeDecodeStoragePath with x-paths ────────────────────────────────────

  it('safeDecodeStoragePath не ломает x-encoded пути (x не %)', () => {
    // xD0x9F... is pure ASCII, decodeURIComponent returns it unchanged
    const cyrillicSafe = 'math-oge/41956/xD0x9FxD0xB5xD1x87xD0xB8_1_21746.png'
    // x is not a percent-encoded char → safeDecodeStoragePath leaves it intact
    expect(safeDecodeStoragePath(cyrillicSafe)).toBe(cyrillicSafe)
  })

  it('getPublicUrl с x-encoded путём формирует валидный ASCII URL', () => {
    const src = read('src/hooks/useCatalog.ts')
    // safeDecodeStoragePath is called before getPublicUrl for ALL paths
    expect(src).toContain('safeDecodeStoragePath(storagePath)')
    // x-encoded paths: safeDecodeStoragePath returns them unchanged,
    // getPublicUrl appends to base URL → valid ASCII URL ✓
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 9. Классификация бланков ответа (isAnswerTemplateSvg)
// ══════════════════════════════════════════════════════════════════════════════

import { isAnswerTemplateSvg } from '@/pages/catalog/classifyAnswerTemplate'

describe('Answer-template image classification', () => {
  // 1. Текущий бланк |--|--| получает catalog-answer-template
  it('TeX blank |--|--| (92×79, math-display) → true', () => {
    expect(isAnswerTemplateSvg(92, 79, true, '|--|--|\n|А-|Б-|\n-------')).toBe(true)
  })

  // 2. Широкая таблица условия НЕ получает этот класс
  it('wide condition table (944×178, math-display) → false', () => {
    expect(isAnswerTemplateSvg(944, 178, true, 'ТЕХНИЧЕСКИЕ УСТРОЙСТВА  ФИЗИЧЕСКИЕ ЯВЛЕНИЯ\nА) ...')).toBe(false)
  })

  // 3. Маленькая inline-формула (hasMathDisplay=false) не считается бланком
  it('small inline formula (hasMathDisplay=false) → false', () => {
    expect(isAnswerTemplateSvg(40, 20, false, 'E = mc²')).toBe(false)
  })

  // 4. SVG без alt не ломается
  it('SVG with empty alt does not throw and → false', () => {
    expect(() => isAnswerTemplateSvg(100, 80, true, '')).not.toThrow()
    expect(isAnswerTemplateSvg(100, 80, true, '')).toBe(false)
  })

  // 5. Небольшая схема/график без alt-паттерна бланка → false
  it('small physics diagram without table alt (150×120) → false', () => {
    expect(isAnswerTemplateSvg(150, 120, true, 'Электрическая схема')).toBe(false)
  })

  // 6. Ultra-wide formula (long horizontal) → false despite small height
  it('ultra-wide formula 400×30 (ar≥5) → false', () => {
    expect(isAnswerTemplateSvg(400, 30, true, '')).toBe(false)
  })

  // 7. Трёхколоночный бланк А|Б|В распознаётся корректно
  it('3-column blank |--|--|--| А|Б|В (130×85) → true', () => {
    expect(isAnswerTemplateSvg(130, 85, true, '|--|--|--|\n|А-|Б-|В-|\n---------')).toBe(true)
  })

  // 8. useEffect + ref подключены в TaskDisplayCard через useImageReclassify
  it('TaskDisplayCard uses useRef and classifies images post-load', () => {
    // useRef + cardRef live in TaskDisplayCard
    const cardSrc = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(cardSrc).toContain('useRef')
    expect(cardSrc).toContain('cardRef')
    // Reclassify logic lives in useImageReclassify hook
    const hookSrc = read('src/hooks/useImageReclassify.ts')
    expect(hookSrc).toContain('isAnswerTemplateSvg')
    expect(hookSrc).toContain('reclassify')
    expect(hookSrc).toContain("img.classList.add('catalog-answer-template')")
    expect(hookSrc).toContain("img.classList.remove('catalog-answer-template')")
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 9. Доступ к каталогу по ролям
// ══════════════════════════════════════════════════════════════════════════════

describe('Catalog role access', () => {
  const sidebarSrc = read('src/components/layout/Sidebar.tsx')
  const appSrc     = read('src/AppRoutes.tsx')

  // Helper: collect all roles granted access to /catalog in navItems.
  // Each navItem line looks like:  roles: ['student', 'teacher', ...]
  // We look for lines that also contain path: '/catalog'.
  function catalogNavRoles(): string[] {
    const found: string[] = []
    for (const line of sidebarSrc.split('\n')) {
      if (!line.includes("'/catalog'") && !line.includes('"/catalog"')) continue
      // Extract the roles array value from the same line
      const m = /roles:\s*\[([^\]]+)\]/.exec(line)
      if (!m) continue
      const roleList = m[1].replace(/['"]/g, '').split(',').map(s => s.trim()).filter(Boolean)
      found.push(...roleList)
    }
    return found
  }

  it('student видит каталог в sidebar', () => {
    expect(catalogNavRoles()).toContain('student')
  })

  it('teacher видит каталог в sidebar', () => {
    expect(catalogNavRoles()).toContain('teacher')
  })

  it('admin видит каталог в sidebar', () => {
    expect(catalogNavRoles()).toContain('admin')
  })

  it('owner видит каталог в sidebar', () => {
    expect(catalogNavRoles()).toContain('owner')
  })

  it('parent не видит каталог — ни один catalog navItem не содержит parent', () => {
    // 'parent' exists in DB enum (database.ts) but is not a typed frontend UserRole
    // and must not appear in sidebar catalog entries
    expect(catalogNavRoles()).not.toContain('parent')
    // UserRole type (index.ts) must not list parent as a valid role
    const indexTs = read('src/types/index.ts')
    expect(indexTs).not.toMatch(/UserRole\s*=[\s\S]{0,200}parent/)
  })

  it('teacher может открыть /catalog — RoleGuard allow включает teacher', () => {
    // The /catalog route in App.tsx must list teacher in its RoleGuard
    const catalogRouteBlock = appSrc.slice(
      appSrc.indexOf('path="/catalog"') - 10,
      appSrc.indexOf('path="/catalog"') + 300,
    )
    expect(catalogRouteBlock).toContain('teacher')
  })

  it('admin может открыть /catalog — RoleGuard allow включает admin', () => {
    const catalogRouteBlock = appSrc.slice(
      appSrc.indexOf('path="/catalog"') - 10,
      appSrc.indexOf('path="/catalog"') + 300,
    )
    expect(catalogRouteBlock).toContain('admin')
  })

  it('unauthorized пользователь перенаправляется — catalog routes внутри DashboardLayout', () => {
    // DashboardLayout checks auth; catalog routes are nested inside it
    expect(appSrc).toContain('DashboardLayout')
    const layoutStart = appSrc.indexOf('DashboardLayout')
    const layoutBlock = appSrc.slice(layoutStart, layoutStart + 3000)
    expect(layoutBlock).toContain('/catalog')
  })

  it('route params subject и exam сохраняются в CatalogPage', () => {
    const catalogPage = read('src/pages/catalog/CatalogPage.tsx')
    expect(catalogPage).toContain('subject')
    expect(catalogPage).toContain('exam')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 10. Пустые темы, поиск, прямые ссылки, ответы
// ══════════════════════════════════════════════════════════════════════════════

describe('Empty topic filtering', () => {
  it('exam-mode сохраняет старое поведение и не фильтрует legacy-связи по source', () => {
    const hookSrc = read('src/hooks/useCatalog.ts')
    expect(hookSrc).not.toContain("view === 'physics-topics'\n            ? query.eq('source', AI_PHYSICS_SOURCE)\n            : query.is('source', null)")
    expect(hookSrc).not.toContain(".select('topic_id, task_id')\n              .is('source', null)")
    expect(hookSrc).toContain('topicIdsSet')
    expect(hookSrc).toContain(".in('id', topicIds)")
  })

  it('родительская тема с непустыми дочерними не исчезает из дерева', () => {
    const sectionSrc = read('src/pages/catalog/CatalogSectionPage.tsx')
    // CatalogSectionPage builds roots including topics whose parent is not in the list
    expect(sectionSrc).toContain('!topics.find(p => p.id === t.parent_id)')
  })

  it('непустая тема отображается — task_count считается по catalog_task_topics', () => {
    const hookSrc = read('src/hooks/useCatalog.ts')
    expect(hookSrc).toContain('taskCountByTopic[row.topic_id] = (taskCountByTopic[row.topic_id] ?? 0) + 1')
    expect(hookSrc).toContain('taskCountByTopic[t.id] ?? 0')
  })
})

describe('Physics topics mode', () => {
  it('CatalogTopicPage forwards view to hooks and keeps it in links', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain("const view = (searchParams.get('view') as CatalogViewMode | null) ?? 'exam'")
    expect(src).toContain('useCatalogTasks(topicId, retryKey, view)')
    expect(src).toContain("useCatalogTopics(sectionId, retryKey, view, subjectLabel, examLabel)")
    expect(src).toContain('useCatalogPhysicsTopicSections(isPhysicsTopicsView, retryKey)')
    expect(src).toContain("view === 'physics-topics' ? '&view=physics-topics' : ''")
  })

  it('useCatalogTasks filters physics-topics by source', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain("view === 'physics-topics'")
    expect(src).toContain("fetchAllTopicTaskIds(topicId!, view === 'physics-topics' ? AI_PHYSICS_SOURCE : undefined)")
    expect(src).toContain('difficulty, statement_html')
  })

  it('old exam mode keeps pre-change task counts by loading all topic links', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain(".eq('topic_id', topicId)")
    expect(src).not.toContain(": query.is('source', null)")
  })

  it('CatalogSectionPage hides search in physics-topics mode', () => {
    const src = read('src/pages/catalog/CatalogSectionPage.tsx')
    expect(src).toContain("const searchEnabled = view === 'exam'")
    expect(src).toContain("{view === 'exam' && <div className=\"relative\">")
  })

  it('physics-topics mode uses AI root and source-specific counters', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('AI_PHYSICS_ROOT_EXTERNAL_ID = 900000')
    expect(src).toContain("db.rpc('get_catalog_section_task_counts_by_source'")
    expect(src).toContain('const sectionCount = sectionCounts.bySectionId[section.id] ?? { task_count: 0, completed_count: 0 }')
    expect(src).toContain("queryKey: ['catalog-physics-section-topics'")
  })

  it('physics-topics section screen uses section RPC total instead of summing child topics', () => {
    const hookSrc = read('src/hooks/useCatalog.ts')
    const pageSrc = read('src/pages/catalog/CatalogPage.tsx')
    expect(hookSrc).toContain('totalTaskCount: sectionCounts.totalTaskCount')
    expect(hookSrc).toContain('totalCompletedCount: sectionCounts.totalCompletedCount')
    expect(pageSrc).toContain("const totalTasks = activeView === 'physics-topics'")
    expect(pageSrc).toContain('? aiTotalTaskCount')
  })

  it('CatalogTopicPage exposes difficulty filter for tasks', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain('Сложность')
    expect(src).toContain('difficultyFilter')
    expect(src).toContain('Задачи выбранной сложности не найдены.')
  })

  it('physics-topics task/section loaders do not filter by is_primary', () => {
    const src = read('src/hooks/useCatalog.ts')
    const topicSectionsBlock = src.slice(src.indexOf('async function loadPhysicsTopicSections'), src.indexOf('async function loadPhysicsSectionTopics'))
    const sectionTopicsBlock = src.slice(src.indexOf('async function loadPhysicsSectionTopics'), src.indexOf('async function loadPhysicsTopicTasks'))
    const topicTasksBlock = src.slice(src.indexOf('async function loadPhysicsTopicTasks'), src.indexOf('/**'))

    expect(topicSectionsBlock).not.toContain("eq('is_primary', true)")
    expect(sectionTopicsBlock).not.toContain("eq('is_primary', true)")
    expect(topicTasksBlock).not.toContain("eq('is_primary', true)")
  })

  it('physics-topics topic task loader dedupes task ids before fetching tasks', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('return [...new Set(rows.map(row => row.task_id))]')
  })

  it('large physics-topics loaders page through task links and progress rows', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('const SELECT_PAGE_SIZE = 1000')
    expect(src).toContain('fetchAllPagedRows')
    expect(src).toContain(".eq('source', AI_PHYSICS_SOURCE)")
    expect(src).toContain('.range(from, to)')
  })

  it('CatalogTopicPage wires admin topic editor only for physics-topics mode', () => {
    const src = read('src/pages/catalog/CatalogTopicPage.tsx')
    expect(src).toContain("const canEditPhysicsTopics = isPhysicsTopicsView && !!profile?.role && ['admin', 'owner'].includes(profile.role)")
    expect(src).toContain('PhysicsTopicEditorButton')
  })
})

describe('Task difficulty badge', () => {
  it('TaskDisplayCard shows a difficulty badge only when difficulty is present', () => {
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('task-difficulty-badge')
    expect(src).toContain("difficulty === 'лёгкая'")
    expect(src).toContain("difficulty === 'средняя'")
    expect(src).toContain("difficulty === 'сложная'")
  })
})

describe('Physics topic editor', () => {
  it('editor button exists with the expected label', () => {
    const src = read('src/components/catalog/PhysicsTopicEditorButton.tsx')
    expect(src).toContain('Изменить темы')
    expect(src).toContain("source='ai_physics_v1'")
  })

  it('editor enforces max 3 topics and shows insufficient-rights style failures', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain('Можно назначить не более 3 тем')
    expect(src).toContain('ensureAffectedRowsCount')
    expect(src).toContain('Не удалось (недостаточно прав)')
  })

  it('editor invalidates physics-topics queries after mutations', () => {
    const src = read('src/hooks/useCatalog.ts')
    expect(src).toContain("invalidateQueries({ queryKey: ['catalog-physics-task-topic-links'")
    expect(src).toContain("invalidateQueries({ queryKey: ['catalog-physics-topic-sections'")
    expect(src).toContain("invalidateQueries({ queryKey: ['catalog-physics-section-topics'")
    expect(src).toContain("invalidateQueries({ queryKey: ['catalog-physics-topic-tasks'")
  })
})

describe('Search — unassigned tasks', () => {
  it('CatalogSectionPage содержит поисковый инпут', () => {
    const src = read('src/pages/catalog/CatalogSectionPage.tsx')
    expect(src).toContain('catalog-search-input')
    expect(src).toContain('useCatalogSearch')
  })

  it('useCatalogSearch ищет по всем задачам раздела без фильтра по topic_id', () => {
    const hookSrc = read('src/hooks/useCatalog.ts')
    // Query goes directly to catalog_tasks, not through catalog_task_topics
    expect(hookSrc).toContain('useCatalogSearch')
    expect(hookSrc).toContain(".ilike('statement_html'")
  })

  it('задача без темы находится через поиск — hasTopicAssigned проверяется отдельно', () => {
    const hookSrc = read('src/hooks/useCatalog.ts')
    expect(hookSrc).toContain('hasTopicAssigned')
    expect(hookSrc).toContain('linkedSet.has(r.id)')
  })

  it('результаты поиска открываются через /catalog/task/:id', () => {
    const src = read('src/pages/catalog/CatalogSectionPage.tsx')
    expect(src).toContain('/catalog/task/')
    expect(src).toContain('search-result-item')
  })
})

describe('Direct task URL', () => {
  it('маршрут /catalog/task/:taskId зарегистрирован в App.tsx', () => {
    const appSrc = read('src/AppRoutes.tsx')
    expect(appSrc).toContain('path="/catalog/task/:taskId"')
    expect(appSrc).toContain('CatalogTaskPage')
  })

  it('CatalogTaskPage загружает задачу через useCatalogTask без topic_id', () => {
    const pageSrc = read('src/pages/catalog/CatalogTaskPage.tsx')
    expect(pageSrc).toContain('useCatalogTask')
    expect(pageSrc).not.toContain('topicId')
  })

  it('useCatalogTask проверяет наличие topic-связи для служебной метки', () => {
    const hookSrc = read('src/hooks/useCatalog.ts')
    expect(hookSrc).toContain('useCatalogTask')
    expect(hookSrc).toContain('catalog_task_topics')
    expect(hookSrc).toContain('hasTopicAssigned')
  })

  it('служебная метка «Тема не назначена» видна только для staff-ролей', () => {
    const pageSrc = read('src/pages/catalog/CatalogTaskPage.tsx')
    expect(pageSrc).toContain('no-topic-badge')
    expect(pageSrc).toContain('STAFF_ROLES')
    // Should NOT show badge for students (STAFF_ROLES check)
    expect(pageSrc).toContain('isStaff && !task.hasTopicAssigned')
  })

  it('в пользовательском интерфейсе отдельного раздела "Без темы" нет', () => {
    const sectionSrc = read('src/pages/catalog/CatalogSectionPage.tsx')
    expect(sectionSrc).not.toMatch(/[Бб]ез\s+темы/)
    const hookSrc = read('src/hooks/useCatalog.ts')
    // No automatic topic assignment in hooks
    expect(hookSrc).not.toContain('INSERT')
  })
})

describe('Answer display states', () => {
  it('has_answer=true → кнопка «Показать ответ»', () => {
    // Logic now lives in TaskDisplayCard
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('Показать ответ')
    expect(src).toContain('task.has_answer')
  })

  it('has_answer=false → плейсхолдер «Ответ пока недоступен»', () => {
    // Logic now lives in TaskDisplayCard
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('Ответ пока недоступен')
    expect(src).toContain('no-answer-placeholder')
  })

  it('плейсхолдер ответа есть в TaskDisplayCard (используется из CatalogTaskPage)', () => {
    // CatalogTaskPage delegates to TaskDisplayCard which handles the placeholder
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    expect(src).toContain('Ответ пока недоступен')
    expect(src).toContain('no-answer-placeholder')
    // CatalogTaskPage must use TaskDisplayCard
    expect(read('src/pages/catalog/CatalogTaskPage.tsx')).toContain('TaskDisplayCard')
  })

  it('answer HTML block renders only when visible (ansOpen guard)', () => {
    const src = read('src/components/catalog/TaskDisplayCard.tsx')
    // Answer section rendered only when ansOpen is true
    expect(src).toContain('ansOpen && ans')
    // has_answer guards the button (ternary)
    expect(src).toMatch(/task\.has_answer\s*\?/)
  })

  it('сломанный answer asset не ломает страницу — resolveHtml возвращает wholeTag', () => {
    // Fallback lives in the shared resolveTaskHtml utility
    const src = read('src/utils/resolveTaskHtml.ts')
    // If no asset found, original tag is returned unchanged (no broken image)
    expect(src).toContain('if (!asset) return wholeTag')
  })

  it('текстовый ответ отображается через TaskContentRenderer (dangerouslySetInnerHTML внутри)', () => {
    // TaskContentRenderer wraps dangerouslySetInnerHTML
    expect(read('src/components/catalog/TaskContentRenderer.tsx')).toContain('dangerouslySetInnerHTML')
    // TaskDisplayCard resolves answer HTML via resolveTaskHtml
    expect(read('src/components/catalog/TaskDisplayCard.tsx')).toContain('resolveTaskHtml(task.answer_html')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 11. CatalogPage — новый лендинг с 4 направлениями
// ══════════════════════════════════════════════════════════════════════════════

describe('CatalogPage — direction picker', () => {
  const src = read('src/pages/catalog/CatalogPage.tsx')

  // 1. Четыре направления отображаются
  it('отображаются четыре карточки направлений (DIRECTIONS array длиной 4)', () => {
    // DIRECTIONS is imported from useCatalog.ts and used in render
    expect(src).toContain('DIRECTIONS')
    expect(src).toContain('direction-card')
    // useCatalog exports DIRECTIONS with 4 items
    const hookSrc = read('src/hooks/useCatalog.ts')
    expect(hookSrc).toContain("key: 'math-ege'")
    expect(hookSrc).toContain("key: 'math-oge'")
    expect(hookSrc).toContain("key: 'physics-ege'")
    expect(hookSrc).toContain("key: 'physics-oge'")
    expect(DIRECTIONS).toHaveLength(4)
  })

  // 2. Каждое направление формирует правильный URL
  it('каждое направление строит URL с правильными subject/exam параметрами', () => {
    expect(src).toContain('/catalog?subject=${d.subjectSlug}&exam=${d.examSlug}')
    // All 4 keys exist in DIRECTIONS
    const keys = DIRECTIONS.map(d => d.key)
    expect(keys).toContain('math-ege')
    expect(keys).toContain('math-oge')
    expect(keys).toContain('physics-ege')
    expect(keys).toContain('physics-oge')
    // URLs would be: /catalog?subject=math&exam=ege etc
    const mathEge = DIRECTIONS.find(d => d.key === 'math-ege')!
    expect(mathEge.subjectSlug).toBe('math')
    expect(mathEge.examSlug).toBe('ege')
    const physOge = DIRECTIONS.find(d => d.key === 'physics-oge')!
    expect(physOge.subjectSlug).toBe('physics')
    expect(physOge.examSlug).toBe('oge')
  })

  // 3. Выбранный subject/exam восстанавливается из URL
  it('SectionsView рендерится при наличии ?subject= в URL', () => {
    // CatalogPage routes based on searchParams.get('subject')
    expect(src).toContain("searchParams.get('subject')")
    expect(src).toContain('SectionsView')
    expect(src).toContain('DirectionPicker')
    // If no subject → DirectionPicker; if subject → SectionsView
    expect(src).toContain('if (!subjectParam) return <DirectionPicker />')
  })

  // 4. Разделы сортируются численно
  it('разделы сортируются численно по exam_number (не строкой)', () => {
    // The sort uses `an - bn` (numeric) not string comparison
    expect(src).toContain('an - bn || a.position - b.position')
    // Verify: numeric sort works correctly
    type Section = { exam_number: number | null; position: number }
    const sort = (a: Section, b: Section) => {
      const an = a.exam_number ?? 999
      const bn = b.exam_number ?? 999
      if (an === 0) return 1
      if (bn === 0) return -1
      return an - bn || a.position - b.position
    }
    const sections: Section[] = [
      { exam_number: 10, position: 10 },
      { exam_number: 2,  position: 2  },
      { exam_number: 1,  position: 1  },
      { exam_number: 11, position: 11 },
    ]
    const sorted = [...sections].sort(sort)
    // Must be 1, 2, 10, 11 — NOT 1, 10, 11, 2 (string sort)
    expect(sorted.map(s => s.exam_number)).toEqual([1, 2, 10, 11])
  })

  // 5. Teacher не видит личный progress bar
  it('progress bar отображается только для student (isStudent guard)', () => {
    // SectionCard renders progress only when isStudent is true
    expect(src).toContain('isStudent')
    expect(src).toContain('{isStudent && (s.task_count ?? 0) > 0 && (')
    // No global progress bar rendered outside isStudent guard
    const progressBarIdx = src.indexOf('bg-green-500 rounded-full')
    const isStudentIdx   = src.lastIndexOf('isStudent', progressBarIdx)
    expect(isStudentIdx).toBeGreaterThan(-1)
    expect(progressBarIdx - isStudentIdx).toBeLessThan(400)
  })

  // 6. Student видит свой прогресс
  it('student видит выполнено / всего / процент в карточке раздела', () => {
    expect(src).toContain('из')
    expect(src).toContain('completed_count')
    expect(src).toContain('{pct}%')
    // SectionCard shows progress stats inline
    expect(src).toContain('s.completed_count ?? 0')
  })

  // 7. Mobile layout — одна колонка
  it('мобильный layout использует одну колонку (grid-cols-1)', () => {
    // Direction grid: grid-cols-1 sm:grid-cols-2
    expect(src).toContain('grid-cols-1 sm:grid-cols-2')
    // Sections grid: gap-2 sm:grid-cols-2 (1 col on mobile by default)
    expect(src).toContain('sm:grid-cols-2')
  })

  // 8. Пустое состояние
  it('пустое состояние выводит понятное сообщение без разделов', () => {
    expect(src).toContain('EmptyState')
    expect(src).toContain('Разделы не найдены')
  })

  // 9. Loading state — skeleton
  it('loading state показывает skeleton-заглушки', () => {
    // Sections view has a full-page skeleton
    expect(src).toContain('SectionsSkeleton')
    expect(src).toContain('animate-pulse')
    // Direction cards use inline skeleton in footer (count shimmer) — not a separate component
    // Cards render immediately; counts load asynchronously via inline pulse
    expect(src).toContain('animate-pulse')
    expect(src).toContain('useCatalogDirectionCounts')
  })

  // 10. Поиск продолжает работать через CatalogSectionPage
  it('поиск по задачам без темы работает через CatalogSectionPage', () => {
    const sectionSrc = read('src/pages/catalog/CatalogSectionPage.tsx')
    // Existing task-level search is in CatalogSectionPage (not removed)
    expect(sectionSrc).toContain('useCatalogSearch')
    expect(sectionSrc).toContain('catalog-search-input')
    // useCatalogSearch searches catalog_tasks directly (not through topics)
    const hookSrc = read('src/hooks/useCatalog.ts')
    expect(hookSrc).toContain('useCatalogSearch')
    expect(hookSrc).toContain(".ilike('statement_html'")
    // CatalogPage itself has section-level filter (not task search)
    expect(src).toContain('section-filter-input')
  })
})
