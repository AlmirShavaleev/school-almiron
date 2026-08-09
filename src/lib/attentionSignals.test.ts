import { describe, expect, it } from 'vitest'
import {
  MIN_PEERS_FOR_MEDIAN, SIGNAL_DISCLAIMER,
  levelJumpSignals, median, overlapSignals, signalText, speedSignals,
  type VariantRun, type WrongAnswer,
} from './attentionSignals'

function run(over: Partial<VariantRun> = {}): VariantRun {
  return {
    id: 'r1',
    variantId: 'v1',
    variantTitle: 'Пробник №1',
    studentId: 's1',
    groupId: 'g1',
    startedAt: '2026-08-01T10:00:00Z',
    finishedAt: '2026-08-01T11:00:00Z',
    ...over,
  }
}

/** Четыре чужих прохождения по 60 минут — медиана 60. */
function peersOfSixty(): VariantRun[] {
  return Array.from({ length: MIN_PEERS_FOR_MEDIAN }, (_, i) => run({
    id: `p${i}`,
    studentId: `peer${i}`,
    startedAt: '2026-08-01T10:00:00Z',
    finishedAt: '2026-08-01T11:00:00Z',
  }))
}

describe('median', () => {
  it('нечётное — середина, чётное — среднее двух средних', () => {
    expect(median([10, 30, 20])).toBe(20)
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(median([])).toBeNull()
  })

  it('выброс не тянет медиану, в отличие от среднего', () => {
    // Одно брошенное на ночь прохождение: среднее уехало бы за 200.
    expect(median([50, 55, 60, 65, 900])).toBe(60)
  })
})

describe('speedSignals — прошёл заметно быстрее остальных', () => {
  it('вдвое быстрее медианы — сигнал', () => {
    const mine = [run({ id: 'mine', finishedAt: '2026-08-01T10:20:00Z' })]
    const signals = speedSignals(mine, peersOfSixty())

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ kind: 'speed', minutes: 20, medianMinutes: 60, peers: 4 })
  })

  it('чуть быстрее — не сигнал', () => {
    const mine = [run({ id: 'mine', finishedAt: '2026-08-01T10:45:00Z' })]
    expect(speedSignals(mine, peersOfSixty())).toHaveLength(0)
  })

  it('на трёх чужих прохождениях медианы не строим', () => {
    const mine = [run({ id: 'mine', finishedAt: '2026-08-01T10:05:00Z' })]
    expect(speedSignals(mine, peersOfSixty().slice(0, 3))).toHaveLength(0)
  })

  it('незаконченное прохождение молчит, а не считается мгновенным', () => {
    const mine = [run({ id: 'mine', finishedAt: null })]
    expect(speedSignals(mine, peersOfSixty())).toHaveLength(0)
  })

  it('другой вариант в сравнение не идёт', () => {
    const mine = [run({ id: 'mine', variantId: 'v2', finishedAt: '2026-08-01T10:10:00Z' })]
    expect(speedSignals(mine, peersOfSixty())).toHaveLength(0)
  })
})

describe('overlapSignals — одинаковые неверные ответы', () => {
  const mine = [run({ id: 'mine', studentId: 's1' })]
  const peer = run({ id: 'peer', studentId: 's2' })

  const wrong = (runId: string, pairs: Array<[string, string]>): WrongAnswer[] =>
    pairs.map(([itemId, answer]) => ({ runId, itemId, answer }))

  it('три совпавших неверных ответа — сигнал с именем соседа', () => {
    const signals = overlapSignals({
      mine,
      peers: [peer],
      myWrong: wrong('mine', [['i1', '12'], ['i2', 'нет'], ['i3', '3,5'], ['i4', '7']]),
      peerWrong: wrong('peer', [['i1', '12'], ['i2', 'НЕТ'], ['i3', ' 3,5 ']]),
      peerNames: { s2: 'Борис' },
    })

    expect(signals).toHaveLength(1)
    // Регистр и пробелы не должны прятать совпадение.
    expect(signals[0]).toMatchObject({ kind: 'overlap', sharedWrong: 3, myWrong: 4, peerName: 'Борис' })
  })

  it('те же задания, но разные ответы — не сигнал', () => {
    const signals = overlapSignals({
      mine,
      peers: [peer],
      myWrong: wrong('mine', [['i1', '12'], ['i2', 'нет'], ['i3', '3,5']]),
      peerWrong: wrong('peer', [['i1', '9'], ['i2', 'да'], ['i3', '4']]),
    })
    expect(signals).toHaveLength(0)
  })

  it('два совпадения — ещё не набор', () => {
    const signals = overlapSignals({
      mine,
      peers: [peer],
      myWrong: wrong('mine', [['i1', '12'], ['i2', 'нет']]),
      peerWrong: wrong('peer', [['i1', '12'], ['i2', 'нет']]),
    })
    expect(signals).toHaveLength(0)
  })

  it('ученик другой группы в сравнение не идёт', () => {
    const stranger = run({ id: 'peer', studentId: 's3', groupId: 'g2' })
    const signals = overlapSignals({
      mine,
      peers: [stranger],
      myWrong: wrong('mine', [['i1', '12'], ['i2', 'нет'], ['i3', '3,5']]),
      peerWrong: wrong('peer', [['i1', '12'], ['i2', 'нет'], ['i3', '3,5']]),
    })
    expect(signals).toHaveLength(0)
  })

  it('без имени соседа сигнал всё равно показывается', () => {
    const signals = overlapSignals({
      mine,
      peers: [peer],
      myWrong: wrong('mine', [['i1', '12'], ['i2', 'нет'], ['i3', '3,5']]),
      peerWrong: wrong('peer', [['i1', '12'], ['i2', 'нет'], ['i3', '3,5']]),
    })
    expect(signals[0].peerName).toBeNull()
    expect(signalText(signals[0])).toContain('другим учеником группы')
  })
})

describe('levelJumpSignals — резкие скачки уровня', () => {
  it('скачок на 40 пунктов и больше замечается, меньший — нет', () => {
    const jumps = levelJumpSignals([
      { topic: 'Т1', percent: 40, at: '2026-08-01T10:00:00Z' },
      { topic: 'Т2', percent: 60, at: '2026-08-02T10:00:00Z' },
      { topic: 'Т3', percent: 100, at: '2026-08-03T10:00:00Z' },
    ])

    expect(jumps).toHaveLength(1)
    expect(jumps[0]).toMatchObject({ fromPercent: 60, toPercent: 100, topic: 'Т3' })
  })

  it('падение уровня — тоже скачок', () => {
    const jumps = levelJumpSignals([
      { topic: 'Т1', percent: 100, at: '2026-08-01T10:00:00Z' },
      { topic: 'Т2', percent: 40, at: '2026-08-02T10:00:00Z' },
    ])
    expect(jumps[0]).toMatchObject({ fromPercent: 100, toPercent: 40 })
  })

  it('порядок берётся по времени вердикта, а не по порядку в массиве', () => {
    const jumps = levelJumpSignals([
      { topic: 'поздняя', percent: 100, at: '2026-08-05T10:00:00Z' },
      { topic: 'ранняя', percent: 20, at: '2026-08-01T10:00:00Z' },
    ])
    expect(jumps[0]).toMatchObject({ fromPercent: 20, toPercent: 100, topic: 'поздняя' })
  })
})

describe('формулировки — наблюдение, а не обвинение', () => {
  it('в текстах сигналов нет обвинительных слов', () => {
    const texts = [
      signalText({ kind: 'speed', variantTitle: 'В1', minutes: 10, medianMinutes: 60, peers: 5 }),
      signalText({ kind: 'overlap', variantTitle: 'В1', peerName: 'Борис', sharedWrong: 3, myWrong: 5 }),
      signalText({ kind: 'jump', fromPercent: 30, toPercent: 95, topic: 'Оптика' }),
      SIGNAL_DISCLAIMER,
    ].join(' ').toLowerCase()

    expect(texts).toContain('стоит посмотреть')
    for (const word of ['списал', 'списыв', 'обман', 'жульни', 'нечестн', 'мошенн']) {
      expect(texts).not.toContain(word)
    }
  })

  it('оговорка прямо говорит, что это не факт', () => {
    expect(SIGNAL_DISCLAIMER.toLowerCase()).toContain('не факт')
  })
})
