/**
 * Сигналы внимания по одному ученику.
 *
 * ЧТО ЭТО. Не обвинение и не вывод, а повод посмотреть глазами. Все три
 * признака объясняются и честно: быстро прошёл — знал тему; одинаковые ошибки —
 * учили вместе по одному конспекту; скачок уровня — наконец разобрался.
 * Поэтому наружу они уходят словами «стоит посмотреть», а не «списал», и
 * блок помечен «подозрение, не факт» (решение владельца 09.08).
 *
 * Ничего нового не логируется: считаем по тому, что уже пишут выдачи и ответы.
 *
 * ВАЖНО ПРО ПУСТОТУ. Сравнение идёт по тем работам, которые видны вызывающему:
 * RLS по тестам пускает преподавателя только к ЕГО выдачам
 * (`auth_is_assigner`), куратора к ответам не пускает вовсе. Пустой список
 * сигналов означает «в видимых данных совпадений нет», а не «совпадений нет».
 * Этот же урок записан в CLAUDE.md: пустой результат — повод проверить права.
 */

/** Сколько чужих прохождений нужно, чтобы медиана вообще что-то значила. */
export const MIN_PEERS_FOR_MEDIAN = 4
/** Доля от медианы, ниже которой скорость становится поводом посмотреть. */
export const FAST_RATIO = 0.5
/** Сколько одинаковых неверных ответов считаем совпадением набора. */
export const MIN_SHARED_WRONG = 3
/** Скачок среднего уровня работ, который стоит заметить (в пунктах). */
export const LEVEL_JUMP_POINTS = 40

export interface VariantRun {
  /** Строка выдачи ученику (`test_variant_student_assignments.id`). */
  id: string
  variantId: string
  variantTitle: string
  studentId: string
  groupId: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** Неверный ответ: что за задание и что именно написано. */
export interface WrongAnswer {
  runId: string
  itemId: string
  answer: string | null
}

export interface SpeedSignal {
  kind: 'speed'
  variantTitle: string
  minutes: number
  medianMinutes: number
  peers: number
}

export interface OverlapSignal {
  kind: 'overlap'
  variantTitle: string
  /** Имя показываем, только если оно доступно вызывающему. */
  peerName: string | null
  sharedWrong: number
  myWrong: number
}

export interface LevelJumpSignal {
  kind: 'jump'
  fromPercent: number
  toPercent: number
  topic: string
}

export type AttentionSignal = SpeedSignal | OverlapSignal | LevelJumpSignal

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/** Минуты между началом и сдачей; null — если момента нет или он битый. */
export function runMinutes(run: VariantRun): number | null {
  if (!run.startedAt || !run.finishedAt) return null
  const from = new Date(run.startedAt).getTime()
  const to = new Date(run.finishedAt).getTime()
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null
  return Math.round((to - from) / 60_000)
}

/**
 * Признак 1: прошёл заметно быстрее остальных по ТОМУ ЖЕ варианту.
 *
 * Медиана, а не среднее: одно брошенное на ночь прохождение сдвинуло бы среднее
 * так, что быстрым выглядел бы каждый. И минимум четыре чужих прохождения —
 * на двух-трёх «медиана» это просто чьё-то время.
 */
export function speedSignals(mine: VariantRun[], peers: VariantRun[]): SpeedSignal[] {
  const out: SpeedSignal[] = []

  for (const run of mine) {
    const minutes = runMinutes(run)
    if (minutes == null) continue

    const peerMinutes = peers
      .filter(p => p.variantId === run.variantId && p.studentId !== run.studentId)
      .map(runMinutes)
      .filter((v): v is number => v != null)

    if (peerMinutes.length < MIN_PEERS_FOR_MEDIAN) continue
    const med = median(peerMinutes)
    if (med == null || med <= 0) continue
    if (minutes > med * FAST_RATIO) continue

    out.push({
      kind: 'speed',
      variantTitle: run.variantTitle,
      minutes,
      medianMinutes: med,
      peers: peerMinutes.length,
    })
  }

  return out
}

/**
 * Признак 2: набор неверных ответов совпал с другим учеником той же группы в
 * том же варианте.
 *
 * Совпадением считаем не «оба ошиблись в задании», а «оба написали ОДНО И ТО ЖЕ
 * неверное». Ошибиться в одном задании — норма (оно просто трудное), совпасть
 * текстом трёх неверных ответов — уже редкость.
 */
export function overlapSignals({
  mine, peers, myWrong, peerWrong, peerNames = {},
}: {
  mine: VariantRun[]
  peers: VariantRun[]
  myWrong: WrongAnswer[]
  peerWrong: WrongAnswer[]
  peerNames?: Record<string, string>
}): OverlapSignal[] {
  const out: OverlapSignal[] = []

  for (const run of mine) {
    const my = myWrong.filter(w => w.runId === run.id && w.answer)
    if (my.length === 0) continue
    const myByItem = new Map(my.map(w => [w.itemId, normalize(w.answer)]))

    // Только та же группа и тот же вариант: разные группы решают в разное
    // время и в разных условиях, сравнивать их смысла нет.
    const sameRoom = peers.filter(p =>
      p.variantId === run.variantId
      && p.studentId !== run.studentId
      && p.groupId != null
      && p.groupId === run.groupId)

    for (const peer of sameRoom) {
      let shared = 0
      for (const w of peerWrong) {
        if (w.runId !== peer.id) continue
        const mineAnswer = myByItem.get(w.itemId)
        if (mineAnswer && mineAnswer === normalize(w.answer)) shared += 1
      }
      if (shared < MIN_SHARED_WRONG) continue

      out.push({
        kind: 'overlap',
        variantTitle: run.variantTitle,
        peerName: peerNames[peer.studentId] ?? null,
        sharedWrong: shared,
        myWrong: my.length,
      })
    }
  }

  return out
}

function normalize(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Признак 3: резкий скачок уровня между соседними проверенными работами.
 *
 * Считается по тем же оценкам, что и средний балл в карточке; порядок —
 * хронологический, от старых к новым.
 */
export function levelJumpSignals(
  scored: Array<{ topic: string; percent: number; at: string }>,
): LevelJumpSignal[] {
  const ordered = [...scored].sort((a, b) => a.at.localeCompare(b.at))
  const out: LevelJumpSignal[] = []

  for (let i = 1; i < ordered.length; i += 1) {
    const delta = ordered[i].percent - ordered[i - 1].percent
    if (Math.abs(delta) < LEVEL_JUMP_POINTS) continue
    out.push({
      kind: 'jump',
      fromPercent: ordered[i - 1].percent,
      toPercent: ordered[i].percent,
      topic: ordered[i].topic,
    })
  }

  return out
}

/** Человеческая формулировка сигнала. Без обвинений — только наблюдение. */
export function signalText(signal: AttentionSignal): string {
  if (signal.kind === 'speed') {
    return `«${signal.variantTitle}»: пройден за ${signal.minutes} мин при медиане ${signal.medianMinutes} мин `
      + `(${signal.peers} других прохождений). Стоит посмотреть, как решались задания.`
  }
  if (signal.kind === 'overlap') {
    const who = signal.peerName ? `с учеником ${signal.peerName}` : 'с другим учеником группы'
    return `«${signal.variantTitle}»: ${signal.sharedWrong} одинаковых неверных ответов ${who} `
      + `(всего неверных у ученика — ${signal.myWrong}). Стоит посмотреть работы рядом.`
  }
  return `Скачок уровня: ${signal.fromPercent}% → ${signal.toPercent}% («${signal.topic}»). `
    + 'Стоит посмотреть, что изменилось.'
}

export const SIGNAL_DISCLAIMER =
  'Это подозрение, а не факт. У каждого сигнала есть обычные объяснения: '
  + 'тема была знакома, готовились вместе, наконец разобрался. Повод посмотреть работу, а не вывод.'
