import { AsaLabWordmark } from '../brand/AsaLabBrand';

export type PublicIntent = 'sign-in' | 'sign-up' | 'class-code';

export function PublicEntryPage({
  onChoose,
}: {
  onChoose: (intent: PublicIntent) => void;
}): JSX.Element {
  return (
    <div className="public-entry">
      <header className="public-entry-header">
        <a className="public-entry-brand" href="/" aria-label="ASA Lab — главная">
          <AsaLabWordmark />
        </a>
        <nav aria-label="О платформе">
          <a href="#capabilities">Возможности</a>
          <a href="#teachers">Преподавателям</a>
          <a href="#safety">Безопасность</a>
        </nav>
        <button
          type="button"
          className="btn-secondary public-entry-sign-in"
          data-testid="entry-sign-in"
          onClick={() => onChoose('sign-in')}
        >
          Войти
        </button>
      </header>

      <main>
        <section className="public-entry-hero">
          <div className="public-entry-hero-copy">
            <p className="entry-kicker">Учиться не по инструкции, а через действие</p>
            <h1>ASA Lab — цифровая STEM-лаборатория для школы</h1>
            <p className="public-entry-lead">
              Одна безопасная среда, где ученики программируют блоками, рисуют, создают 3D-модели,
              собирают электронные схемы, играют и разбирают партии, а педагог видит проекты,
              попытки и реальный путь решения.
            </p>
            <div className="public-entry-actions">
              <button
                type="button"
                className="btn-primary"
                data-testid="entry-sign-up"
                onClick={() => onChoose('sign-up')}
              >
                Создать аккаунт
              </button>
              <button
                type="button"
                className="btn-secondary"
                data-testid="entry-class-code"
                onClick={() => onChoose('class-code')}
              >
                Войти по коду класса
              </button>
            </div>
            <p className="public-entry-action-note">
              Педагогу — пространство для классов и заданий. Ученику — собственные проекты и вход по
              коду класса.
            </p>
          </div>
          <aside className="public-entry-hero-board" aria-label="Возможности ASA Lab">
            <span className="entry-board-chip entry-board-chip-code">Блоки</span>
            <span className="entry-board-chip entry-board-chip-art">Рисование</span>
            <span className="entry-board-chip entry-board-chip-3d">3D</span>
            <span className="entry-board-chip entry-board-chip-circuit">Электроника</span>
            <span className="entry-board-chip entry-board-chip-game">Шахматы · шашки</span>
            <div className="entry-board-centre">
              <AsaLabWordmark compact />
              <strong>Идея → проект → разбор</strong>
              <span>Всё в одной учебной среде</span>
            </div>
          </aside>
        </section>

        <section
          className="public-entry-section"
          id="capabilities"
          aria-labelledby="capabilities-title"
        >
          <p className="entry-kicker">Предметные среды</p>
          <h2 id="capabilities-title">От первой идеи до работающего проекта</h2>
          <p className="public-entry-section-lead">
            ASA Lab объединяет практические направления, которые обычно разбросаны по разным
            сервисам. Результат остаётся в проекте и может стать частью занятия, задания или
            портфолио ученика.
          </p>
          <div className="public-entry-grid">
            <article>
              <span aria-hidden="true">⌘</span>
              <h3>Блочное программирование</h3>
              <p>
                Алгоритмы, условия, циклы и переменные в визуальной среде с понятным переходом к
                текстовому коду.
              </p>
              <a href="/features/block-programming/">Подробнее о программировании</a>
            </article>
            <article>
              <span aria-hidden="true">✦</span>
              <h3>Рисование и визуальные проекты</h3>
              <p>
                Иллюстрация, композиция, цвет и цифровое творчество — от наброска до законченной
                проектной работы.
              </p>
              <a href="/features/drawing/">Подробнее о рисовании</a>
            </article>
            <article>
              <span aria-hidden="true">◇</span>
              <h3>3D-моделирование</h3>
              <p>
                Базовые формы, точные размеры, преобразования и сохранение собственных трёхмерных
                моделей.
              </p>
              <a href="/features/3d-modeling/">Подробнее о 3D</a>
            </article>
            <article>
              <span aria-hidden="true">⎍</span>
              <h3>Виртуальная электроника</h3>
              <p>
                Компоненты, соединения, измерения и физически осмысленная симуляция с честной
                диагностикой ошибок.
              </p>
              <a href="/features/electronics/">Подробнее об электронике</a>
            </article>
            <article>
              <span aria-hidden="true">♟</span>
              <h3>Шахматы и русские шашки</h3>
              <p>
                Партии, задачи, разбор решений, обучение с ботами и безопасная игра внутри класса.
              </p>
              <a href="/features/chess-and-checkers/">Подробнее об игровых модулях</a>
            </article>
            <article>
              <span aria-hidden="true">✓</span>
              <h3>Классы и доказуемый прогресс</h3>
              <p>
                Выдача работы, история попыток и обратная связь, привязанная к конкретному проекту,
                решению или ходу.
              </p>
              <a href="/for-teachers/">Возможности для педагогов</a>
            </article>
          </div>
        </section>

        <section
          className="public-entry-section public-entry-teachers"
          id="teachers"
          aria-labelledby="teachers-title"
        >
          <div>
            <p className="entry-kicker">Для педагогов</p>
            <h2 id="teachers-title">Видеть не только оценку, а путь ученика</h2>
            <p>
              Создайте класс, подготовьте задание и предложите ученикам выполнить его в той же
              среде, где живут их проекты. ASA Lab сохраняет контекст работы, чтобы разбор был
              предметным, а прогресс — подтверждённым.
            </p>
            <a className="public-entry-text-link" href="/for-teachers/">
              Как ASA Lab помогает проводить занятия
            </a>
          </div>
          <ol>
            <li>
              <strong>1</strong>
              <span>Педагог создаёт класс или личное учебное пространство.</span>
            </li>
            <li>
              <strong>2</strong>
              <span>Ученик входит по коду и выполняет проектное задание.</span>
            </li>
            <li>
              <strong>3</strong>
              <span>Педагог видит попытки, результат и даёт точную обратную связь.</span>
            </li>
          </ol>
        </section>

        <section className="public-entry-section" id="safety" aria-labelledby="safety-title">
          <p className="entry-kicker">Безопасная образовательная среда</p>
          <h2 id="safety-title">Сделано для школы, а не адаптировано постфактум</h2>
          <div className="public-entry-safety-grid">
            <article>
              <h3>Без рекламы</h3>
              <p>Никаких рекламных вставок, лутбоксов и механик удержания внимания.</p>
            </article>
            <article>
              <h3>Контролируемое общение</h3>
              <p>Без открытого детского чата и контактов с незнакомыми людьми.</p>
            </article>
            <article>
              <h3>Роли и классы</h3>
              <p>Доступ к учебной работе определяется ролью и участием в конкретном классе.</p>
            </article>
            <article>
              <h3>История проектов</h3>
              <p>
                Результат и путь к нему сохраняются, чтобы обучение можно было обсуждать и улучшать.
              </p>
            </article>
          </div>
        </section>

        <section className="public-entry-cta" aria-labelledby="cta-title">
          <div>
            <p className="entry-kicker">ASA Lab уже открыт для первых пользователей</p>
            <h2 id="cta-title">Начните с собственного проекта или школьного класса</h2>
          </div>
          <div className="public-entry-actions">
            <button type="button" className="btn-primary" onClick={() => onChoose('sign-up')}>
              Создать аккаунт
            </button>
            <button type="button" className="btn-secondary" onClick={() => onChoose('sign-in')}>
              Уже есть аккаунт
            </button>
          </div>
        </section>
      </main>

      <footer className="entry-legal public-entry-footer">
        <span>© ASA Lab · Учиться через действие.</span>
        <a href="/features/">Все возможности</a>
        <a href="/for-teachers/">Преподавателям</a>
        <a href="/for-schools/">Для школ</a>
        <a href="/safety/">Безопасность</a>
        <a href="/about/">О проекте</a>
        <a href="/faq/">FAQ</a>
        <a href="https://github.com/spikeal8-maker/asa-lab" target="_blank" rel="noreferrer">
          Исходный код · AGPL-3.0
        </a>
        <span>Бренд и отдельные материалы защищены.</span>
      </footer>
    </div>
  );
}
