import { Reveal } from './motion'
import { SCENES } from './icons'

/**
 * Аргумент 1 — «lofi-режим» (прототип v3, `#cozy`): слева вертикальная
 * картинка рабочего стола, справа карточка с текстом и рукописной строкой
 * (Marck Script, оранжевая, наклон −2°, волнистое подчёркивание). Цветных
 * плашек тут нет — блок намеренно тихий. Диалога тоже нет, только номер.
 */
export function ArgCozy() {
  return (
    <section id="cozy">
      <div className="wrap">
        <Reveal className="cozy-g">
          <figure className="cozy-ph">
            <img
              src={SCENES.desk.src}
              alt="Рабочий стол у окна на закате: книги, тетрадь с планом на день, ноутбук"
              width={SCENES.desk.w}
              height={SCENES.desk.h}
              loading="lazy"
              decoding="async"
            />
          </figure>
          <div className="card cozy-txt">
            <div className="cozy-arg">
              <div className="arg-n or" aria-hidden="true">1</div>
              <span className="eb">Аргумент первый</span>
            </div>
            <div className="hero-name">lofi-режим · учёба в своём темпе</div>
            <h2>Учёба, к которой хочется возвращаться</h2>
            <p className="lead">Никаких дедлайнов и гонки. Включаешь любимый плейлист, наливаешь чай и просто заходишь позаниматься — а тут уже ждёт спокойный план на день, понятные задания и прогресс, который видно.</p>
            <p className="lead">Сделал шаг — закрыл ноутбук. Завтра продолжишь с того же места.</p>
            <div className="hand">
              спокойный план на день,<br />понятные задания<br />и прогресс, который видно
              <svg viewBox="0 0 260 18" aria-hidden="true">
                <path d="M4 12 C 60 4, 120 16, 180 8 S 240 6, 256 10" />
              </svg>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
