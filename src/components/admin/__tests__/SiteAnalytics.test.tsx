import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SiteAnalytics } from '@/components/admin/SiteAnalytics'
import type { SiteAnalyticsData } from '@/hooks/useVercelAnalytics'

const BASE: SiteAnalyticsData & { loading: boolean; error: string | null; reload: () => void } = {
  totals7:  { visitors: 0, pageviews: 0 },
  totals30: { visitors: 0, pageviews: 0 },
  days: [], sections: [], referrers: [], devices: [], countries: [],
  fetchedAt: '2026-08-15T00:23:50.000Z',
  fromCache: false, throttled: false, partial: false, daysReturned: 31,
  loading: false, error: null, reload: vi.fn(),
}

function renderSite(over: Partial<typeof BASE> = {}) {
  return render(<SiteAnalytics {...BASE} {...over} />)
}

describe('SiteAnalytics', () => {
  it('отказ показывается словами, а не нулями', () => {
    // Главное правило вводной: «Web Analytics не включён» и «ноль посещений» —
    // разные вещи, и нули читаются как «никто не заходил».
    renderSite({ error: 'Web Analytics не включён в проекте Vercel. Включается в панели Vercel, вкладка Analytics.' })

    expect(screen.getByTestId('site-analytics-error')).toBeInTheDocument()
    expect(screen.getByText(/Web Analytics не включён/)).toBeInTheDocument()
    expect(screen.queryByTestId('site-analytics')).not.toBeInTheDocument()
  })

  it('числа за 7 и 30 дней показаны отдельно', () => {
    renderSite({
      totals7:  { visitors: 1, pageviews: 9 },
      totals30: { visitors: 4, pageviews: 25 },
    })

    expect(screen.getByText('Посетителей за 7 дней')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
  })

  it('подписывает время получения данных', () => {
    renderSite()
    expect(screen.getByTestId('site-analytics-freshness')).toHaveTextContent(/Данные на/)
  })

  it('говорит, что данные из кэша, и какое окно истории вернул Vercel', () => {
    renderSite({ fromCache: true, daysReturned: 31 })
    const line = screen.getByTestId('site-analytics-freshness')
    expect(line).toHaveTextContent('из кэша')
    expect(line).toHaveTextContent('история за 31 дн.')
  })

  it('частый повтор «Обновить» объясняется, а не выглядит поломкой', () => {
    renderSite({ throttled: true })
    expect(screen.getByText(/не чаще раза в минуту/)).toBeInTheDocument()
  })

  it('неполный ответ помечается — иначе числа примут за полные', () => {
    renderSite({ partial: true })
    expect(screen.getByText(/числа ниже неполные/)).toBeInTheDocument()
  })

  it('разделы показываются свёрнутыми и подписаны почему', () => {
    renderSite({
      sections: [{ section: '/students', pageviews: 4 }, { section: '/dashboard', pageviews: 2 }],
    })

    expect(screen.getByText('/students')).toBeInTheDocument()
    expect(screen.getByText(/свёрнуты по первому сегменту/)).toBeInTheDocument()
  })

  it('пустой ярлык источника читается как «прямой заход», а не пустотой', () => {
    renderSite({ referrers: [{ label: 'прямой заход', visitors: 1, pageviews: 9 }] })
    expect(screen.getByText('прямой заход')).toBeInTheDocument()
  })

  it('период без просмотров говорит об этом словами', () => {
    renderSite({ days: [{ day: '2026-08-15T00:00:00.000Z', visitors: 0, pageviews: 0 }] })
    expect(screen.getByText(/просмотров не было/)).toBeInTheDocument()
  })

  it('пока грузится — ни чисел, ни ошибки', () => {
    renderSite({ loading: true })
    expect(screen.getByText(/Загружаем статистику сайта/)).toBeInTheDocument()
    expect(screen.queryByTestId('site-analytics')).not.toBeInTheDocument()
    expect(screen.queryByTestId('site-analytics-error')).not.toBeInTheDocument()
  })
})
