import { lazy, type ComponentType } from 'react'

/**
 * Почему это нужно.
 *
 * После разбиения бандла постранично (PROJECT_STATE §25.3) страницы грузятся
 * отдельными файлами с хешем в имени: `MyTopicHomeworkPage-B4x7W2Ut.js`.
 * Вкладка, открытая ДО деплоя, держит в памяти старый код со старыми именами.
 * Выходит новый деплой — имена меняются, старых файлов на сервере больше нет.
 * Пользователь переходит на страницу, браузер просит файл со старым хешем,
 * получает 404 и роняет приложение с «Failed to fetch dynamically imported
 * module». До разбиения этого не было: весь код уже лежал в одном загруженном
 * куске, и переходы вообще ничего не догружали.
 *
 * Лечится перезагрузкой страницы: свежий index.html принесёт новые имена.
 * Делаем это сами и молча — пользователю незачем видеть стек ошибки из-за
 * того, что мы выкатили обновление, пока у него была открыта вкладка.
 *
 * Перезагружаем не больше одного раза на страницу (флаг в sessionStorage):
 * если файл не грузится по другой причине — сеть, блокировщик, сломанный
 * деплой, — бесконечный цикл перезагрузок был бы хуже честной ошибки.
 * После удачной загрузки флаг снимаем, чтобы следующий деплой снова мог
 * восстановиться сам.
 */
export function lazyPage<T extends ComponentType<any>>(
  name: string,
  load: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    const key = `chunk-reload:${name}`
    try {
      const mod = await load()
      safeSessionRemove(key)
      return mod
    } catch (error) {
      if (!isChunkLoadError(error) || safeSessionGet(key)) throw error
      safeSessionSet(key, '1')
      window.location.reload()
      // Страница уже перезагружается — отдаём промис, который никогда не
      // разрешится, чтобы React не успел показать вспышку ошибки.
      return new Promise<never>(() => {})
    }
  })
}

/**
 * Отличаем «файл чанка не доехал» от настоящей ошибки внутри модуля.
 * Перезагружать имеет смысл только первое: если модуль упал при вычислении,
 * перезагрузка ничего не починит, а сообщение об ошибке будет потеряно.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \S+ failed/i.test(message)
}

// sessionStorage может быть недоступен (приватный режим, жёсткие настройки) —
// тогда просто работаем без защиты от повторов, а не падаем на ровном месте.
function safeSessionGet(key: string): string | null {
  try { return window.sessionStorage.getItem(key) } catch { return null }
}
function safeSessionSet(key: string, value: string): void {
  try { window.sessionStorage.setItem(key, value) } catch { /* не критично */ }
}
function safeSessionRemove(key: string): void {
  try { window.sessionStorage.removeItem(key) } catch { /* не критично */ }
}
