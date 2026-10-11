import { Chat, type Msg } from './Chat'
import { Reveal } from './motion'

/**
 * Шапка аргумента: номер в цветной плашке, «Аргумент первый», заголовок и
 * короткий диалог. Цвет номера — как в прототипе: 1 и 5 красные, 3 оранжевый.
 */
export function ArgHead({ n, tone, eb, title, chat }: {
  n: number
  tone?: 'or' | 'red'
  eb: string
  title: string
  chat: Msg[]
}) {
  return (
    <Reveal className="arg-head">
      <div className={tone ? `arg-n ${tone}` : 'arg-n'} aria-hidden="true">{n}</div>
      <div>
        <span className="eb">{eb}</span>
        <h2>{title}</h2>
        <Chat msgs={chat} className="arg-chat" />
      </div>
    </Reveal>
  )
}
