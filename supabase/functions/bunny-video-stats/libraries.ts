/**
 * Библиотеки Bunny Stream, которые знает статистика видео (§232).
 *
 * До §232 библиотека была одна — математика, 726880. Для физики владелец
 * завёл ОТДЕЛЬНУЮ библиотеку со своим ключом: ключ Bunny Stream выдаётся на
 * библиотеку, и ключом математики физику не прочитать. Поэтому каждая
 * библиотека здесь — пара «ключ + номер» из своих переменных окружения, и в
 * Bunny каждая ходит своим ключом.
 *
 * Модуль чистый (ни Deno, ни сети): окружение приходит функцией `env`, чтобы
 * выбор библиотек гонял vitest (`src/lib/__tests__/bunnyStatsCore.test.ts`).
 *
 * КЛЮЧ. `apiKey` живёт только в этой структуре и нужен только заголовку
 * запроса в Bunny. Наружу структура уходит через `publicLibrary`, который
 * ключ отбрасывает; сообщения об ошибках называют ПЕРЕМЕННУЮ, а не значение.
 */

import { BUNNY_DEFAULT_LIBRARY_ID } from '../_shared/bunnyVideoUrl.ts'

/** Библиотека «Физика ЕГЭ» (§232). Подставляется, если номер не задан явно. */
export const BUNNY_PHYSICS_LIBRARY_ID = '763334'

interface LibrarySpec {
  /** Подпись на экране — переключатель «Математика / Физика». */
  label: string
  /** Основная: в неё идут адреса без номера библиотеки (голый guid, поток CDN). */
  primary: boolean
  keyVar: string
  idVar: string
  defaultId: string
  /**
   * Дополнительная библиотека может быть не настроена — это не поломка, а
   * «ещё не подключили». Основная без ключа — поломка: статистики нет вовсе.
   */
  optional: boolean
  /** Как назвать библиотеку в сообщении «ключ не задан». */
  missingKeyNoun: string
}

const SPECS: LibrarySpec[] = [
  {
    label: 'Математика',
    primary: true,
    keyVar: 'BUNNY_STREAM_API_KEY',
    idVar: 'BUNNY_STREAM_LIBRARY_ID',
    defaultId: BUNNY_DEFAULT_LIBRARY_ID,
    optional: false,
    missingKeyNoun: 'основной библиотеки',
  },
  {
    label: 'Физика',
    primary: false,
    keyVar: 'BUNNY_PHYSICS_API_KEY',
    idVar: 'BUNNY_PHYSICS_LIBRARY_ID',
    defaultId: BUNNY_PHYSICS_LIBRARY_ID,
    optional: true,
    missingKeyNoun: 'библиотеки физики',
  },
]

/**
 * Состояние настройки библиотеки.
 *   `not_configured` — дополнительной библиотеке не дали ключ. Спокойная
 *                      пометка, не ошибка: функция работает как до §232.
 *   `config`         — настройка сломана (нет ключа основной, номер не числом).
 */
export interface LibraryConfigProblem {
  kind: 'not_configured' | 'config'
  message: string
}

export interface BunnyLibrary {
  id: string
  label: string
  primary: boolean
  keyVar: string
  idVar: string
  /** Только для заголовка `AccessKey`. Никогда не уходит в ответ или лог. */
  apiKey: string | null
  problem: LibraryConfigProblem | null
}

/** То, что о библиотеке можно показать: без ключа. */
export interface PublicLibrary {
  id: string
  label: string
  primary: boolean
}

export function publicLibrary(lib: BunnyLibrary): PublicLibrary {
  return { id: lib.id, label: lib.label, primary: lib.primary }
}

/**
 * Номер библиотеки уходит в путь запроса к Bunny — пускаем только цифры.
 * Иначе «726880/../..» из переменной окружения превратился бы в чужой путь.
 */
const LIBRARY_ID_RE = /^\d{1,12}$/

export function isLibraryId(value: unknown): value is string {
  return typeof value === 'string' && LIBRARY_ID_RE.test(value)
}

/**
 * Список библиотек из окружения. Основная — первой.
 *
 * Если номер дополнительной совпал с основной (опечатка в переменных), она
 * выбрасывается: иначе одни и те же ролики посчитались бы дважды.
 */
export function resolveLibraries(env: (name: string) => string | undefined): BunnyLibrary[] {
  const result: BunnyLibrary[] = []

  for (const spec of SPECS) {
    const rawId = (env(spec.idVar) ?? '').trim()
    const apiKey = (env(spec.keyVar) ?? '').trim() || null

    let id = rawId || spec.defaultId
    let problem: LibraryConfigProblem | null = null

    if (!isLibraryId(id)) {
      // Значение переменной не печатаем: мало ли что туда вставили по ошибке.
      problem = {
        kind: 'config',
        message: `Переменная ${spec.idVar} задана неверно: номер библиотеки Bunny — это число.`,
      }
      id = spec.defaultId
    } else if (!apiKey) {
      problem = spec.optional
        ? {
            kind: 'not_configured',
            message: `Ключ ${spec.missingKeyNoun} не задан (${spec.keyVar}). Статистика появится, когда его добавят в переменные проекта.`,
          }
        : {
            kind: 'config',
            message: `Не задана переменная окружения ${spec.keyVar}.`,
          }
    }

    if (result.some(r => r.id === id)) continue

    result.push({
      id,
      label: spec.label,
      primary: spec.primary,
      keyVar: spec.keyVar,
      idVar: spec.idVar,
      apiKey: problem ? null : apiKey,
      problem,
    })
  }

  return result
}

/**
 * Выбор библиотеки по запросу клиента (тепловая карта). Пусто — основная;
 * номер, которого нет среди настроенных, — `null` (отказ, а не молчаливая
 * подмена основной: карта чужой библиотеки из основной была бы чужой картой).
 */
export function pickLibrary(libraries: BunnyLibrary[], requested: unknown): BunnyLibrary | null {
  if (requested === undefined || requested === null || requested === '') {
    return libraries.find(l => l.primary) ?? libraries[0] ?? null
  }
  if (!isLibraryId(requested)) return null
  return libraries.find(l => l.id === requested) ?? null
}

/**
 * В какую библиотеку отнести ролик из материала темы.
 *
 * 1. Номер есть в адресе (`/embed/<lib>/<guid>`, `/play/<lib>/<guid>`) —
 *    берём его. Это решение владельца при импорте, и если ролик по этому
 *    номеру не найден, плеер у ученика пустой — это и надо показать, а не
 *    подменить библиотеку.
 * 2. Номера нет (голый guid, поток CDN — легаси-строки до §168) — ищем guid
 *    в загруженных снимках (`owner`): guid Bunny — UUID, совпасть между
 *    библиотеками он не может. Не нашёлся — основная библиотека, как
 *    велит §168 для таких адресов.
 */
export function libraryOfVideo(
  ref: { libraryId: string | null; guid: string },
  primaryId: string,
  owner: ReadonlyMap<string, string>,
): string {
  if (ref.libraryId) return ref.libraryId
  return owner.get(ref.guid) ?? primaryId
}

// ── Ключи кэша ───────────────────────────────────────────────────────────
//
// Таблица `bunny_video_stats_cache` держит проверку
//   cache_key = 'library' or cache_key like 'heatmap:%'
// (миграция 20260909075902), поэтому без миграции:
//   • снимки всех библиотек — в ОДНОЙ строке 'library', словарём по номеру
//     библиотеки, у каждой своя дата получения (`LibraryCachePayload`);
//   • тепловая карта — 'heatmap:<библиотека>:<guid>'.
// Старые строки ('library' прежнего вида и 'heatmap:<guid>' без номера) не
// читаются: снимок прежнего вида не несёт номера библиотеки, и отдать его за
// 726880 значило бы угадывать. Цена — один лишний заход в Bunny после
// деплоя; старые карты просто перестают использоваться.

export const LIBRARY_CACHE_KEY = 'library'

export function heatmapCacheKey(libraryId: string, guid: string): string {
  return `heatmap:${libraryId}:${guid}`
}
