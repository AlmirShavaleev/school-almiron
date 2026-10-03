import { describe, expect, it, vi } from 'vitest'
import { AwayTracker, type AwayBatch } from '@/lib/awayTracker'

/**
 * §263. Уходы со страницы работы: пачки не чаще раза в 15 с и при возврате,
 * «свои» уходы (камера, файл, условие в новой вкладке) не считаются, сбой
 * сети не теряет накопленное.
 */
function setup(opts = {}) {
  const clock = { t: 1_000_000 }
  const sent: AwayBatch[] = []
  const send = vi.fn(async (b: AwayBatch) => { sent.push(b) })
  const tracker = new AwayTracker({ now: () => clock.t, send }, opts)
  const at = (sec: number) => { clock.t += sec * 1000 }
  return { clock, sent, send, tracker, at }
}
const flush = () => new Promise(r => setTimeout(r, 0))

describe('AwayTracker (§263)', () => {
  it('уход шлётся сразу (первая пачка), время вне страницы — при возврате', async () => {
    const { tracker, sent, at } = setup()
    tracker.leave()
    await flush()
    expect(sent).toEqual([{ leaves: 1, seconds: 0 }])
    at(70)
    tracker.back()
    await flush()
    expect(sent).toEqual([{ leaves: 1, seconds: 0 }, { leaves: 0, seconds: 70 }])
  })

  it('частые уходы копятся и уходят одной пачкой не чаще раза в 15 с', async () => {
    const { tracker, sent, at } = setup()
    tracker.leave(); await flush()           // пачка 1: уход
    at(2); tracker.back(); await flush()      // 2 с после пачки — возврат не шлёт (меньше 5 с)
    at(1); tracker.leave(); await flush()
    at(3); tracker.back(); await flush()      // 6 с после пачки — возврат шлёт
    expect(sent).toEqual([{ leaves: 1, seconds: 0 }, { leaves: 1, seconds: 5 }])
    at(1); tracker.leave(); at(1); tracker.back()
    at(1); tracker.leave(); at(1); tracker.back()
    await flush()
    expect(sent).toHaveLength(2)              // 4 с после второй пачки — копим
    at(12); tracker.tick(); await flush()     // 16 с — пачка по интервалу
    expect(sent[2]).toEqual({ leaves: 2, seconds: 2 })
  })

  it('повторный blur/hidden, пока ученик вне страницы, — не новый уход', async () => {
    const { tracker, sent, at } = setup()
    tracker.leave(); tracker.leave(); tracker.leave()
    at(30); tracker.back(); tracker.back()
    await flush()
    expect(sent.reduce((a, b) => a + b.leaves, 0)).toBe(1)
    expect(sent.reduce((a, b) => a + b.seconds, 0)).toBe(30)
  })

  it('«свой» уход (камера, выбор файла, условие в новой вкладке) — не в счёт, и только один', async () => {
    const { tracker, sent, at } = setup()
    tracker.excuseNextLeave()
    tracker.leave(); at(40); tracker.back()
    await flush()
    expect(sent).toEqual([])
    tracker.leave(); at(10); tracker.back()
    await flush()
    expect(sent.reduce((a, b) => a + b.leaves, 0)).toBe(1)
  })

  it('оправдание истекает через 3 минуты', async () => {
    const { tracker, sent, at } = setup()
    tracker.excuseNextLeave()
    at(200)
    tracker.leave(); await flush()
    expect(sent).toEqual([{ leaves: 1, seconds: 0 }])
  })

  it('стоп (сдал / окно кончилось / ушёл со страницы работы) досчитывает незакрытый уход и шлёт всё', async () => {
    const { tracker, sent, at } = setup()
    tracker.leave(); await flush()
    at(25)
    await tracker.stop()
    expect(sent).toEqual([{ leaves: 1, seconds: 0 }, { leaves: 0, seconds: 25 }])
    tracker.leave(); at(5); tracker.back(); await flush()
    expect(sent).toHaveLength(2) // после стопа не считает
  })

  it('сеть не ответила — пачка вернётся в копилку и уйдёт со следующей', async () => {
    const clock = { t: 0 }
    const sent: AwayBatch[] = []
    let fail = true
    const tracker = new AwayTracker({
      now: () => clock.t,
      send: async b => { if (fail) throw new Error('offline'); sent.push(b) },
    })
    tracker.leave(); await flush(); await flush()
    expect(tracker.pending).toEqual({ leaves: 1, seconds: 0 })
    fail = false
    clock.t += 20_000
    tracker.back(); await flush()
    expect(sent).toEqual([{ leaves: 1, seconds: 20 }])
    expect(tracker.pending).toEqual({ leaves: 0, seconds: 0 })
  })
})
