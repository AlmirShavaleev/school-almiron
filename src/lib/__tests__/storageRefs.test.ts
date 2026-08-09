import { describe, expect, it, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
const remove = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    storage: { from: () => ({ remove: (...args: unknown[]) => remove(...args) }) },
  },
}))

import { removeIfOrphan } from '@/lib/storageRefs'

const PATH = 'topic-1/1786140236248_konspekt.pdf'

describe('removeIfOrphan (§101)', () => {
  beforeEach(() => {
    rpc.mockReset()
    remove.mockReset().mockResolvedValue({ error: null })
  })

  it('на объект ещё ссылаются — файл остаётся', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    expect(await removeIfOrphan('topic-materials', PATH)).toBe('kept')
    expect(remove).not.toHaveBeenCalled()
  })

  it('ссылок нет — объект удаляется', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    expect(await removeIfOrphan('topic-materials', PATH)).toBe('removed')
    expect(remove).toHaveBeenCalledWith([PATH])
  })

  /**
   * Главное свойство: сомнение трактуется в пользу файла. Лишний объект в
   * хранилище дешевле, чем файл, выбитый у шаблона и всех его копий.
   */
  it('счёт ссылок не удался — файл НЕ удаляется', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'нет прав' } })
    expect(await removeIfOrphan('topic-materials', PATH)).toBe('failed')
    expect(remove).not.toHaveBeenCalled()
  })

  it('ответ неожиданной формы тоже считается «ссылка есть»', async () => {
    rpc.mockResolvedValue({ data: undefined, error: null })
    expect(await removeIfOrphan('topic-materials', PATH)).toBe('kept')
    expect(remove).not.toHaveBeenCalled()
  })

  it('сеть упала — не бросает наверх', async () => {
    rpc.mockRejectedValue(new Error('сеть'))
    await expect(removeIfOrphan('topic-materials', PATH)).resolves.toBe('failed')
  })

  it('пустой путь — делать нечего', async () => {
    expect(await removeIfOrphan('topic-materials', null)).toBe('kept')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('спрашивает про тот бакет, из которого удаляет', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    await removeIfOrphan('topic-homework', PATH)
    expect(rpc).toHaveBeenCalledWith('storage_path_refs', { p_bucket: 'topic-homework', p_path: PATH })
  })

  it('ошибка удаления объекта видна вызывающему, но не исключением', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    remove.mockResolvedValue({ error: { message: 'объект не найден' } })
    expect(await removeIfOrphan('topic-materials', PATH)).toBe('failed')
  })
})
