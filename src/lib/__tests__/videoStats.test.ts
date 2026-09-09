import { describe, expect, it } from 'vitest'
import {
  attentionHalvesAt, formatClock, heatmapSeries, missingLessons, neverWatched,
  toMinutes, watchedLessons, watchedShare,
  type VideoLesson,
} from '@/lib/videoStats'

/**
 * Пересчёт чисел Bunny для вкладки «Видео».
 *
 * Здесь сторожатся ровно те места, где легко соврать молча: единицы, дырки в
 * тепловой карте, недокументированный ключ `-1` и разница между «ноль
 * просмотров» и «ролика больше нет». Каждое из них найдено разведкой на живых
 * ответах Bunny, а не придумано.
 */

function lesson(over: Partial<VideoLesson> = {}): VideoLesson {
  return {
    videoId: 'v1', topicTitle: 'Тема', bunnyTitle: 'Bunny', courses: ['Курс'],
    placements: 2, onlyInTemplate: false, missingInBunny: false,
    views: 0, lengthSec: 600, totalWatchSec: 0, avgWatchSec: 0,
    ...over,
  }
}

describe('единицы и формат', () => {
  it('секунды переводятся в минуты округлением', () => {
    // 1969 с — реальная сумма просмотра урока «Векторы» на проде.
    expect(toMinutes(1969)).toBe(33)
    expect(toMinutes(29)).toBe(0)
    expect(toMinutes(0)).toBe(0)
  })

  it('отрицательные и нечисловые секунды дают ноль, а не NaN на экране', () => {
    expect(toMinutes(-5)).toBe(0)
    expect(toMinutes(Number.NaN)).toBe(0)
  })

  it('длительность показывается как часы:минуты ролика', () => {
    expect(formatClock(1159)).toBe('19:19')
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(0)).toBe('0:00')
  })
})

describe('доля досмотра', () => {
  it('считается от длины ролика', () => {
    // Реальные числа урока «Векторы»: 179 с из 1159 с — 15 %.
    expect(Math.round((watchedShare(179, 1159) ?? 0) * 100)).toBe(15)
  })

  it('без длины ролика возвращает null, а не ноль', () => {
    // Ноль здесь читался бы как «не смотрят вовсе» — это разные утверждения.
    expect(watchedShare(100, 0)).toBeNull()
    expect(watchedShare(100, Number.NaN)).toBeNull()
  })

  it('не превышает единицу даже при странных данных Bunny', () => {
    expect(watchedShare(2000, 1000)).toBe(1)
  })
})

describe('разбор уроков по состояниям', () => {
  const lessons = [
    lesson({ videoId: 'a', views: 11, totalWatchSec: 1969 }),
    lesson({ videoId: 'b', views: 1,  totalWatchSec: 1002 }),
    lesson({ videoId: 'c', views: 0 }),
    lesson({ videoId: 'd', views: 0, missingInBunny: true }),
  ]

  it('«не смотрел никто» не включает ролики, пропавшие из библиотеки', () => {
    // У пропавшего ноль просмотров тоже, но это другая беда: там пустой
    // плеер у ученика, а не отсутствие интереса.
    expect(neverWatched(lessons).map(l => l.videoId)).toEqual(['c'])
    expect(missingLessons(lessons).map(l => l.videoId)).toEqual(['d'])
  })

  it('сортировка по просмотрам и по минутам даёт РАЗНЫЙ порядок', () => {
    const byViews = watchedLessons(lessons, 'views').map(l => l.videoId)
    const byMinutes = watchedLessons(lessons, 'minutes').map(l => l.videoId)
    expect(byViews).toEqual(['a', 'b'])
    expect(byMinutes).toEqual(['a', 'b'])

    // Урок, который открывали реже, но досматривали дольше, обязан обгонять
    // по минутам — иначе переключатель показывает один и тот же топ дважды.
    const mixed = [
      lesson({ videoId: 'often', views: 10, totalWatchSec: 100 }),
      lesson({ videoId: 'long',  views: 2,  totalWatchSec: 5000 }),
    ]
    expect(watchedLessons(mixed, 'views').map(l => l.videoId)).toEqual(['often', 'long'])
    expect(watchedLessons(mixed, 'minutes').map(l => l.videoId)).toEqual(['long', 'often'])
  })

  it('пропавшие ролики не попадают в таблицу просмотренных', () => {
    const withViews = [lesson({ videoId: 'ghost', views: 5, missingInBunny: true })]
    expect(watchedLessons(withViews, 'views')).toEqual([])
  })
})

describe('тепловая карта', () => {
  it('пропущенные отрезки заполняются нулём, а не выпадают из ряда', () => {
    // Разведка: у ролика 1159 с пришло 205 ключей на диапазон 0…231.
    // Без заполнения график соединил бы соседей поверх провала.
    const points = heatmapSeries({ '0': 100, '2': 50 }, 300)
    expect(points.map(p => p.index)).toEqual([0, 1, 2])
    expect(points.map(p => p.value)).toEqual([100, 0, 50])
  })

  it('недокументированный ключ -1 выбрасывается', () => {
    // На проде он не ноль (14 у урока «Векторы»), но положить его на шкалу
    // времени некуда: Bunny не объясняет, что это за отрезок.
    const points = heatmapSeries({ '-1': 14, '0': 100, '1': 60 }, 100)
    expect(points).toHaveLength(2)
    expect(points.every(p => p.index >= 0)).toBe(true)
  })

  it('время отрезка считается делением длины на число отрезков', () => {
    // 1159 с при последнем ключе 231 → 232 отрезка по ≈5 с.
    const map: Record<string, number> = {}
    for (let i = 0; i <= 231; i++) map[String(i)] = 10
    const points = heatmapSeries(map, 1159)
    expect(points).toHaveLength(232)
    expect(points[1].atSec).toBeCloseTo(4.996, 2)
    expect(points[231].atSec).toBeCloseTo(1154, 0)
  })

  it('без длины ролика ряд строится, но время остаётся нулевым', () => {
    const points = heatmapSeries({ '0': 100, '1': 50 }, 0)
    expect(points.map(p => p.atSec)).toEqual([0, 0])
  })

  it('пустая или отсутствующая карта даёт пустой ряд', () => {
    expect(heatmapSeries(null, 100)).toEqual([])
    expect(heatmapSeries({}, 100)).toEqual([])
    expect(heatmapSeries({ '-1': 5 }, 100)).toEqual([])
  })
})

describe('где внимание падает вдвое', () => {
  it('отсчёт идёт от пика, а не от первой точки', () => {
    // Карта с разгоном: первая точка ниже второй. Отсчёт от первой дал бы
    // случайный ответ — порог должен считаться от максимума.
    const points = heatmapSeries({ '0': 40, '1': 100, '2': 60, '3': 30 }, 400)
    const halves = attentionHalvesAt(points)
    expect(halves?.index).toBe(3)
  })

  it('находит первый отрезок ниже половины пика', () => {
    // Реальная форма урока «Векторы»: 100, 78, 42 — падение уже на третьем.
    const points = heatmapSeries({ '0': 100, '1': 78, '2': 42 }, 300)
    expect(attentionHalvesAt(points)?.index).toBe(2)
    expect(attentionHalvesAt(points)?.atSec).toBeCloseTo(200, 0)
  })

  it('возвращает null, если внимание вдвое так и не упало', () => {
    // Честнее не показать отметку, чем выдумать её на последней секунде.
    const points = heatmapSeries({ '0': 100, '1': 90, '2': 80 }, 300)
    expect(attentionHalvesAt(points)).toBeNull()
  })

  it('пустой ряд и нулевая карта не ломают расчёт', () => {
    expect(attentionHalvesAt([])).toBeNull()
    expect(attentionHalvesAt(heatmapSeries({ '0': 0, '1': 0 }, 100))).toBeNull()
  })
})
