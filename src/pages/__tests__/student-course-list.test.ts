/**
 * Tests for the compact topic list view in StudentCoursePage.
 * Uses readFileSync to verify source-level patterns (no JSDOM needed).
 */

import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
import path from 'path'

const PAGE_SRC = readFileSync(
  path.resolve(__dirname, '../StudentCoursePage.tsx'),
  'utf-8'
)
const HOOK_SRC = readFileSync(
  path.resolve(__dirname, '../../hooks/useStudentCourseProgram.ts'),
  'utf-8'
)

// ─── 1. Numerical sort ────────────────────────────────────────────────────────

describe('Topic numerical sort', () => {
  it('hook sorts topics by order_index numerically, not lexically', () => {
    // Verify the hook uses numeric sort: a.order_index - b.order_index
    expect(HOOK_SRC).toMatch(/sort\(\s*\([^)]+\)\s*=>\s*a\.order_index\s*-\s*b\.order_index/)
  })

  it('numeric sort produces correct order for numbers > 9', () => {
    const topics = [
      { order_index: 10 }, { order_index: 2 }, { order_index: 1 }, { order_index: 11 },
    ].sort((a, b) => a.order_index - b.order_index)
    expect(topics.map(t => t.order_index)).toEqual([1, 2, 10, 11])
  })

  it('numeric sort does not produce lexical order 1,10,11,2', () => {
    const nums = [1, 10, 11, 2].sort((a, b) => a - b)
    expect(nums).toEqual([1, 2, 10, 11])
    expect(nums).not.toEqual([1, 10, 11, 2])
  })
})

// ─── 2. Default view: cards (§274; до §274 — list) ────────────────────────────

describe('Default view = cards (§274)', () => {
  it('getViewPref falls back to "cards" when localStorage is empty', () => {
    expect(PAGE_SRC).toContain("|| 'cards'")
  })

  it('view state is initialised with getViewPref', () => {
    expect(PAGE_SRC).toContain('useState<CourseView>(getViewPref)')
  })

})

// ─── 3. Status "На проверке" displayed ───────────────────────────────────────

describe('Status "На проверке"', () => {
  it('LIST_STATE has submitted state with "На проверке" label', () => {
    expect(PAGE_SRC).toContain("statusLabel: 'На проверке'")
  })

  it('submitted maps to "На проверке" statusLabel', () => {
    // Extract from source that submitted key contains На проверке
    const submittedBlock = PAGE_SRC.slice(
      PAGE_SRC.indexOf('submitted: {'),
      PAGE_SRC.indexOf('submitted: {') + 300
    )
    expect(submittedBlock).toContain('На проверке')
  })
})

// ─── 4. Пройденный урок показывает баллы ─────────────────────────────────────

// §182. Балл жил в строке дважды: отдельной колонкой справа и (после правки)
// сигналом «ДЗ: 18/20 б» под названием. Осталась одна цифра, а проверки по
// тексту исходника («содержит ли файл `topic.hw_score}/{topic.hw_max}`») — это
// ровно тот хрупкий тест, про который предупреждает CLAUDE.md: он падает от
// перестановки, а не от пропажи поведения. Балл за принятое ДЗ проверяется
// теперь поведенчески — StudentCoursePage.signals.test.tsx.

// ─── 5. Закрытый урок нельзя открыть ─────────────────────────────────────────

describe('Locked topic cannot be opened', () => {
  it('click handler is gated by !isLocked', () => {
    expect(PAGE_SRC).toContain('!isLocked && onOpen()')
  })

  it('aria-disabled is set for locked rows', () => {
    expect(PAGE_SRC).toContain('aria-disabled={isLocked || undefined}')
  })

  it('tabIndex is -1 for locked rows', () => {
    expect(PAGE_SRC).toContain('tabIndex={isLocked ? -1 : 0}')
  })

  it('Open button is not rendered when locked', () => {
    // The Open button is inside {!isLocked && ( ... )}
    expect(PAGE_SRC).toMatch(/\{!isLocked && \([\s\S]{0,400}Открыть/)
  })

  // Раньше здесь проверялась строка `availStr > todayStr` — своя копия правила
  // прямо в странице. С появлением тумблера (topics.is_open) правило переехало
  // в src/lib/topicAvailability.ts, зеркало SQL-функции topic_open_now, и
  // проверять теперь надо не текст условия, а то, что копии больше нет.
  // Поведение самого правила покрыто src/lib/__tests__/topicAvailability.test.ts.
  it('страница не считает открытость сама, а зовёт общее правило', () => {
    expect(PAGE_SRC).toContain('isTopicOpen')
    expect(PAGE_SRC).not.toContain('availStr > todayStr')
  })
})

// ─── 7. Teacher/admin не получают ложный student progress ────────────────────

describe('Teacher/admin: no student progress', () => {
  it('hook only loads for student role', () => {
    expect(HOOK_SRC).toContain("profile.role !== 'student'")
  })

  it('StudentCoursePage renders empty state when no course', () => {
    expect(PAGE_SRC).toContain('!course')
    expect(PAGE_SRC).toContain('не записаны ни в одну группу')
  })

})

// ─── 8. Mobile layout без горизонтального скролла ────────────────────────────

describe('Mobile layout', () => {
  it('max-width container on page prevents overflow', () => {
    // StudentCoursePage wraps content in max-w-5xl (§274.1: страница курса шире)
    expect(PAGE_SRC).toContain('max-w-5xl')
  })

})

// ─── 9. View toggle persists to localStorage ─────────────────────────────────

describe('View toggle localStorage persistence', () => {
  it('VIEW_PREF_KEY constant is defined', () => {
    expect(PAGE_SRC).toContain("VIEW_PREF_KEY = 'student-course-view'")
  })

  it('saveViewPref writes to localStorage', () => {
    expect(PAGE_SRC).toContain('localStorage.setItem(VIEW_PREF_KEY, v)')
  })

  it('getViewPref reads from localStorage', () => {
    expect(PAGE_SRC).toContain('localStorage.getItem(VIEW_PREF_KEY)')
  })

  it('handleViewChange calls both setView and saveViewPref', () => {
    expect(PAGE_SRC).toContain('setView(v)')
    expect(PAGE_SRC).toContain('saveViewPref(v)')
  })

  it('toggle buttons have data-testid attributes', () => {
    expect(PAGE_SRC).toContain('data-testid="view-toggle-list"')
    expect(PAGE_SRC).toContain('data-testid="view-toggle-cards"')
  })

  it('toggle buttons use aria-pressed', () => {
    expect(PAGE_SRC).toContain('aria-pressed={view === \'list\'}')
    expect(PAGE_SRC).toContain('aria-pressed={view === \'cards\'}')
  })
})

// ─── 10. Card view still works ────────────────────────────────────────────────

describe('Card view', () => {
  it('cards view still uses grid-cols layout', () => {
    expect(PAGE_SRC).toContain('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4')
  })

  it('view switch is conditional on view === "list" / "cards"', () => {
    expect(PAGE_SRC).toContain("view === 'list'")
    expect(PAGE_SRC).toContain("view === 'cards'")
  })
})

// ─── Type safety check ────────────────────────────────────────────────────────

describe('TypeScript types', () => {
  it('CourseView type covers both variants', () => {
    expect(PAGE_SRC).toContain("type CourseView = 'list' | 'cards'")
  })

  it('TopicProgress interface exists in hook', () => {
    expect(HOOK_SRC).toContain('export interface TopicProgress')
  })

  it('hook exports ModuleProgress with topics array', () => {
    expect(HOOK_SRC).toContain('topics: TopicProgress[]')
  })
})
