import { describe, expect, it } from 'vitest'
import {
  COMMENT_MIN_MAX_HEIGHT,
  commentBoxHeight,
  commentBoxMaxHeight,
} from '../reviewCommentBox'

/**
 * §208. Арифметика поля комментария: до каких пор оно растёт и когда внутри
 * появляется прокрутка.
 */

describe('потолок роста', () => {
  it('40 % высоты панели', () => {
    expect(commentBoxMaxHeight(800)).toBe(320)
  })

  it('на низком окне потолок не опускается ниже стартовой высоты', () => {
    // Телефон боком: 40 % от 360 — это меньше шести строк, и поле схлопнулось
    // бы сразу после открытия.
    expect(commentBoxMaxHeight(360)).toBe(COMMENT_MIN_MAX_HEIGHT)
  })

  it('высоты панели ещё нет — работаем по нижней границе, а не по NaN', () => {
    expect(commentBoxMaxHeight(0)).toBe(COMMENT_MIN_MAX_HEIGHT)
    expect(commentBoxMaxHeight(Number.NaN)).toBe(COMMENT_MIN_MAX_HEIGHT)
  })
})

describe('высота под содержимое', () => {
  it('короткий текст не ужимает поле ниже стартовых строк', () => {
    expect(commentBoxHeight(40, 140, 320)).toEqual({ height: 140, scroll: false })
  })

  it('текст длиннее — поле растёт, прокрутки нет', () => {
    expect(commentBoxHeight(220, 140, 320)).toEqual({ height: 220, scroll: false })
  })

  it('упёрлись в потолок — включается прокрутка', () => {
    expect(commentBoxHeight(900, 140, 320)).toEqual({ height: 320, scroll: true })
  })
})
