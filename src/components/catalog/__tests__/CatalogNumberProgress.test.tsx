import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { CatalogNumberProgress } from '@/components/catalog/CatalogNumberProgress'
import { normalizeCatalogRules } from '@/lib/catalogRewards'

/**
 * §256. Номер раздела у ученика: метка зоны, вехи и таблица наград по
 * кнопке. Всё — из ответа базы (зона, засчитано, правила).
 */
const rules = normalizeCatalogRules({
  window_days: 60, low: 0.4, high: 0.7, daily_task: 10, weekly_goal: 40,
  zones: [
    { key: 'growth', per_task: 5, milestones: [{ at: 10, bonus: 30 }, { at: 20, bonus: 50 }, { at: 30, bonus: 80 }] },
    { key: 'progress', per_task: 3, milestones: [{ at: 10, bonus: 20 }, { at: 20, bonus: 30 }, { at: 30, bonus: 40 }] },
    { key: 'confident', per_task: 1, milestones: [{ at: 10, bonus: 5 }, { at: 20, bonus: 5 }, { at: 30, bonus: 5 }] },
  ],
})!

describe('CatalogNumberProgress', () => {
  it('«№6 — зона роста: +5 за задачу», «3 из 10 → бонус +30», вехи', () => {
    render(<CatalogNumberProgress number={{ subject: 'math', n: 6, title: null, zone: 'growth', share: 0.25, solved: 3 }} rules={rules} />)
    expect(screen.getByTestId('catalog-zone-chip')).toHaveTextContent('№6 — зона роста: +5 за задачу')
    const m = screen.getByTestId('catalog-milestones')
    expect(m).toHaveTextContent('3 из 10 → бонус +30')
    expect(within(m).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(m).toHaveTextContent('10 задач · +30')
    expect(m).toHaveTextContent('30 задач · +80')
  })

  it('«уверенно»: +1 и вехи по +5; пройденная веха отмечена', () => {
    render(<CatalogNumberProgress number={{ subject: 'math', n: 2, title: null, zone: 'confident', share: 0.9, solved: 12 }} rules={rules} />)
    expect(screen.getByTestId('catalog-zone-chip')).toHaveTextContent('№2 — уверенно: +1 за задачу')
    expect(screen.getByTestId('catalog-milestones')).toHaveTextContent('12 из 20 → бонус +5')
    expect(screen.getByTestId('catalog-milestones').querySelectorAll('[data-reached]')).toHaveLength(1)
  })

  it('таблица наград — по кнопке «Как начисляются баллы», из правил базы', () => {
    render(<CatalogNumberProgress number={{ subject: 'math', n: 6, title: null, zone: 'growth', share: null, solved: 0 }} rules={rules} />)
    expect(screen.queryByTestId('catalog-rewards-table')).toBeNull()
    const btn = screen.getByTestId('catalog-rewards-toggle')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    const t = screen.getByTestId('catalog-rewards-table')
    const rows = t.querySelectorAll('tbody tr')
    expect([...rows].map(r => r.textContent)).toEqual([
      'зона роставерно меньше 40 %+5+30 / +50 / +80',
      'в процессе40–70 %+3+20 / +30 / +40',
      'увереннобольше 70\u00a0%+1+5 / +5 / +5',
    ])
    expect(t).toHaveTextContent('Плюс: задача дня +10 баллов, цель недели +40.')
    expect(t).toHaveTextContent('«Отметить выполненной» — 0')
  })
})
