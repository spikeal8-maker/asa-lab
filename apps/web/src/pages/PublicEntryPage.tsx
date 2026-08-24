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
        <div className="public-entry-header-actions" aria-label="Аккаунт">
          <button
            type="button"
            className="btn-secondary public-entry-sign-in"
            data-testid="entry-sign-in"
            onClick={() => onChoose('sign-in')}
          >
            Войти
          </button>
          <button
            type="button"
            className="btn-primary public-entry-register"
            data-testid="entry-header-sign-up"
            onClick={() => onChoose('sign-up')}
          >
            Зарегистрироваться
          </button>
        </div>
      </header>

      <main>
        <section className="public-entry-hero">
          <div className="public-entry-hero-visual" aria-hidden="true">
            <img src="/social/asa-lab-og.png" alt="" />
          </div>
          <div className="public-entry-hero-copy">
            <p className="entry-kicker">ASA Lab · цифровая лаборатория</p>
            <h1>Придумывайте. Создавайте. Проверяйте.</h1>
            <p className="public-entry-lead">
              3D-моделирование, виртуальная электроника, блочное программирование, рисование,
              шахматы и шашки — в одной среде, где идея становится собственным проектом.
            </p>
            <div className="public-entry-actions">
              <button
                type="button"
                className="btn-primary"
                data-testid="entry-sign-up"
                onClick={() => onChoose('sign-up')}
              >
                Начать проект
              </button>
              <a className="btn-secondary" href="/features/">
                Посмотреть возможности
              </a>
            </div>
            <p className="public-entry-action-note">
              Собственные проекты — основной сценарий. Классы и задания можно подключить для
              совместной или учебной работы.
            </p>
          </div>
        </section>

        <section
          className="public-entry-section"
          id="capabilities"
          aria-labelledby="capabilities-title"
        >
          <p className="entry-kicker">Инструменты</p>
          <h2 id="capabilities-title">Всё, что нужно, чтобы придумать, собрать и проверить</h2>
          <p className="public-entry-section-lead">
            ASA Lab объединяет практические направления, которые обычно разбросаны по разным
            сервисам. Результат остаётся в собственном проекте, который можно проверять, сохранять и
            улучшать.
          </p>
          <div className="public-entry-grid">
            <article>
              <span aria-hidden="true">⌘</span>
              <h3>Блочное программирование</h3>
              <p>Визуальные алгоритмы, последовательности, условия, циклы и переменные.</p>
              <a href="/features/block-programming/">Подробнее о программировании</a>
            </article>
            <article>
              <span aria-hidden="true">✦</span>
              <h3>Рисование и черчение</h3>
              <p>Эскизы, рисунки, схемы и конструкции из линий, форм и визуальных элементов.</p>
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
              <p>Партии, задачи, анализ позиций и проверка разных стратегий и вариантов решения.</p>
              <a href="/features/chess-and-checkers/">Подробнее об игровых модулях</a>
            </article>
            <article>
              <span aria-hidden="true">✓</span>
              <h3>Классы и задания</h3>
              <p>
                Дополнительный способ объединить участников и организовать совместную проектную
                работу.
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
            <p className="entry-kicker">Для совместной работы</p>
            <h2 id="teachers-title">Проекты можно объединять в классы и задания</h2>
            <p>
              Если ASA Lab используется на занятии, в кружке или в команде, проекты можно связать с
              классом и заданием. Преподаватель организует работу и видит её результат, но основой
              остаётся сам проект и процесс его создания.
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
          <p className="entry-kicker">Безопасность и контроль</p>
          <h2 id="safety-title">Проекты и данные под контролем</h2>
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
            <p className="entry-kicker">От идеи к работающему проекту</p>
            <h2 id="cta-title">Начните с собственного проекта</h2>
          </div>
          <div className="public-entry-actions">
            <button type="button" className="btn-primary" onClick={() => onChoose('sign-up')}>
              Начать проект
            </button>
            <button type="button" className="btn-secondary" onClick={() => onChoose('sign-in')}>
              Уже есть аккаунт
            </button>
          </div>
        </section>
      </main>

      <footer className="entry-legal public-entry-footer">
        <span>© ASA Lab · От идеи к работающему проекту.</span>
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
