import { describe, expect, it } from 'vitest'
// @ts-expect-error — чистый модуль загрузчика на JS
import { figuresOf, splitTasks, taskText } from '../../../scripts/autocheck-text.mjs'

/** §278: условие и решение текстом из дз.md. */
const MD = `---
тема: 2.16
---
<!-- служебное -->
### Задача 2.16-Д-01
- тип: расчётная
- рисунок: рисунки/2.16-Д-01.svg
- рисунок-условие: рисунки/2.16-Д-01-условие.svg

**Условие.** Ящик массой $M$ стоит на плоскости (см. рисунок).

**Ответ:** $F = Mg\\sin\\beta$

**Дано:** $M$; $\\beta$
**Найти:** $F$

**Решение.**
1. **Закон.** $\\vec 0 = M\\vec g + \\vec N$.

### Задача 2.16-Д-02
- рисунок: рисунки/2.16-Д-02.svg
- рисунок-условие: нет

**Условие.** Санки скользят с ускорением 3 м/с².

**Ответ:** 50 м

**Решение.**
1. $$L = 50\\ \\text{м}$$
`

describe('autocheck-text (§278)', () => {
  it('задачи по коду, без служебных комментариев', () => {
    const t = splitTasks(MD)
    expect([...t.keys()]).toEqual(['2.16-Д-01', '2.16-Д-02'])
  })
  it('условие + рисунок условия; решение: Дано/Найти, рисунок решения, шаги, ответ', () => {
    const r = taskText(splitTasks(MD).get('2.16-Д-01'), (rel: string) => `autocheck/${rel.includes('условие') ? 'c' : 's'}.svg`)
    expect(r.statement_md).toBe('Ящик массой $M$ стоит на плоскости (см. рисунок).\n\n![](fig:autocheck/c.svg)')
    expect(r.solution_md).toBe('**Дано:** $M$; $\\beta$\n**Найти:** $F$\n\n![](fig:autocheck/s.svg)\n\n**Решение.**\n1. **Закон.** $\\vec 0 = M\\vec g + \\vec N$.\n\n**Ответ:** $F = Mg\\sin\\beta$')
  })
  it('«рисунок-условие: нет» — условие без рисунка; нет «Дано» — решение с «Решения»', () => {
    const r = taskText(splitTasks(MD).get('2.16-Д-02'), () => 'autocheck/s.svg')
    expect(r.statement_md).toBe('Санки скользят с ускорением 3 м/с².')
    expect(r.solution_md.startsWith('![](fig:autocheck/s.svg)\n\n**Решение.**')).toBe(true)
    expect(r.solution_md.endsWith('**Ответ:** 50 м')).toBe(true)
  })
  it('рисунки для загрузки — без «нет» и без повторов', () => {
    expect(figuresOf(MD, ['2.16-Д-01', '2.16-Д-02']).sort()).toEqual(['рисунки/2.16-Д-01-условие.svg', 'рисунки/2.16-Д-01.svg', 'рисунки/2.16-Д-02.svg'])
  })
  it('нет «Условия» или «Ответа» — null (останется картинка)', () => {
    expect(taskText('**Условие.** без ответа', () => null)).toBeNull()
  })
})
