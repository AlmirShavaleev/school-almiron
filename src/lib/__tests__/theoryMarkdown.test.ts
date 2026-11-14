import { describe, expect, it } from 'vitest'
import {
  THEORY_MD_MARKER, boxLabel, isTheoryMarkdown, parseTheory, stripSectionNumber,
} from '@/lib/theoryMarkdown'

const SRC = `${THEORY_MD_MARKER}
---
title: Производная
zadanie: "Задание ЕГЭ № 12"
---

## Т1. Что такое производная

Производная показывает, **растёт** функция или убывает.

::: rule
$$c' = 0 \\qquad x' = 1$$
:::

![Касательная к графику](fig:theory/abc.svg)

![Наклон касательной](fig:theory/def.svg)

Текст после рисунков.

## Т2. Степень

::: example
**Пример.** $(x^3)' = 3x^2$.
:::

::: trap
**Сначала производная, потом подстановка.** Иначе получится ноль.
:::

::: check
Найдите производную $x^7$. || $7x^6$
:::
`

describe('theoryMarkdown', () => {
  it('узнаёт теорию по метке и не путает с обычным текстом', () => {
    expect(isTheoryMarkdown(SRC)).toBe(true)
    expect(isTheoryMarkdown('  \n' + SRC)).toBe(true)
    expect(isTheoryMarkdown('Просто текст материала')).toBe(false)
    expect(isTheoryMarkdown(null)).toBe(false)
  })

  it('делит на разделы и снимает номер «Т1.» и шапку YAML', () => {
    const s = parseTheory(SRC)
    expect(s.map(x => x.title)).toEqual(['Что такое производная', 'Степень'])
    expect(JSON.stringify(s)).not.toContain('zadanie')
    expect(stripSectionNumber('Т12. Ловушки')).toBe('Ловушки')
  })

  it('рамка, рисунки подряд одним рядом, текст вокруг', () => {
    const [t1] = parseTheory(SRC)
    expect(t1.blocks.map(b => b.type)).toEqual(['md', 'box', 'figures', 'md'])
    const figs = t1.blocks[2]
    expect(figs).toEqual({
      type: 'figures',
      items: [
        { caption: 'Касательная к графику', path: 'fig:theory/abc.svg' },
        { caption: 'Наклон касательной', path: 'fig:theory/def.svg' },
      ],
    })
    expect(t1.blocks[1]).toMatchObject({ type: 'box', box: 'rule' })
  })

  it('пример, ловушка и «Проверь себя» с ответом после ||', () => {
    const [, t2] = parseTheory(SRC)
    expect(t2.blocks).toEqual([
      { type: 'box', box: 'example', md: '**Пример.** $(x^3)\' = 3x^2$.' },
      { type: 'box', box: 'trap', md: '**Сначала производная, потом подстановка.** Иначе получится ноль.' },
      { type: 'check', question: 'Найдите производную $x^7$.', answer: '$7x^6$' },
    ])
  })

  it('незакрытая рамка закрывается следующим разделом, неизвестная — как правило', () => {
    const s = parseTheory('## А\n\n::: note\nВажно\n\n## Б\n\nТекст')
    expect(s[0].blocks).toEqual([{ type: 'box', box: 'rule', md: 'Важно' }])
    expect(s[1]).toEqual({ title: 'Б', blocks: [{ type: 'md', md: 'Текст' }] })
  })

  it('подпись над рамкой не дублирует ту, что уже в тексте', () => {
    expect(boxLabel('example', '**Пример.** …')).toBeNull()
    expect(boxLabel('example', 'Найдём …')).toBe('Пример')
    expect(boxLabel('trap', '**Знак у косинуса.** …')).toBe('Ловушка ЕГЭ')
    expect(boxLabel('rule', 'что угодно')).toBeNull()
  })
})
