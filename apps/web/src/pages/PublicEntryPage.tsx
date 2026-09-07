import { AsaLabWordmark } from '../brand/AsaLabBrand';
import homeDashboard from '../../../../e2e/artifacts/readme-2026-09-07/home-dashboard.png';
import electronicsSimulation from '../../../../e2e/artifacts/readme-2026-09-07/electronics-simulation.png';
import electronicsBlocks from '../../../../e2e/artifacts/readme-2026-09-07/electronics-blocks.png';
import electronicsCpp from '../../../../e2e/artifacts/readme-2026-09-07/electronics-cpp.png';
import threeDBus from '../../../../e2e/artifacts/readme-2026-09-07/three-d-bus.png';
import threeDHouse from '../../../../e2e/artifacts/readme-2026-09-07/three-d-house.png';
import assignmentProgress from '../../../../e2e/artifacts/classroom-management/assignment-progress.png';
import './PublicEntryPage.css';

export type PublicIntent = 'sign-in' | 'sign-up' | 'class-code';

const capabilities = [
  {
    title: 'Виртуальная электроника',
    copy: 'Собирайте схемы, подключайте компоненты и Arduino, запускайте моделирование, измеряйте параметры и находите ошибки.',
    href: '/features/electronics/',
    image: '/social/asa-lab-electronics.png',
    alt: 'Виртуальная электроника ASA Lab',
  },
  {
    title: '3D и CAD',
    copy: 'Создавайте модели из базовых форм, работайте с размерами и композицией и переходите к более профессиональным CAD-сценариям.',
    href: '/features/3d-modeling/',
    image: '/social/asa-lab-3d-modeling.png',
    alt: '3D-моделирование ASA Lab',
  },
  {
    title: 'Блочное программирование',
    copy: 'Собирайте алгоритмы из понятных действий, условий и циклов. В электронике визуальные блоки работают рядом с реальной схемой Arduino.',
    href: '/features/block-programming/',
    image: '/social/asa-lab-block-programming.png',
    alt: 'Блочное программирование ASA Lab',
  },
  {
    title: 'Рисование и визуальные проекты',
    copy: 'Работайте с формой, цветом, композицией, эскизами и собственными визуальными идеями в общей проектной логике ASA Lab.',
    href: '/features/drawing/',
    image: '/social/asa-lab-drawing.png',
    alt: 'Рисование и визуальные проекты ASA Lab',
  },
  {
    title: 'Шахматы',
    copy: 'Решайте задачи, играйте партии, анализируйте позиции и проверяйте варианты — не только ответ, но и ход рассуждения.',
    href: '/features/chess-and-checkers/',
    image: '/social/asa-lab-chess-checkers.png',
    alt: 'Шахматы и русские шашки ASA Lab',
  },
  {
    title: 'Русские шашки',
    copy: 'Разбирайте комбинации, рассчитывайте варианты и развивайте стратегическое мышление в отдельной игровой среде.',
    href: '/features/chess-and-checkers/',
    image: '/social/asa-lab-chess-checkers.png',
    alt: 'Русские шашки ASA Lab',
  },
] as const;

export function PublicEntryPage({
  onChoose,
}: {
  onChoose: (intent: PublicIntent) => void;
}): JSX.Element {
  return (
    <div className="public-home">
      <a className="public-home-skip" href="#public-home-main">
        Перейти к содержанию
      </a>

      <header className="public-home-header">
        <a className="public-home-brand" href="/" aria-label="ASA Lab — главная">
          <AsaLabWordmark />
        </a>

        <nav className="public-home-nav" aria-label="Основная навигация">
          <a href="#capabilities">Возможности</a>
          <a href="#projects">Проекты</a>
          <a href="#learning">Обучение</a>
          <a href="#teachers">Преподавателям</a>
          <a href="#about">О проекте</a>
        </nav>

        <div className="public-home-header-actions" aria-label="Аккаунт">
          <button type="button" className="public-home-button public-home-button-quiet" onClick={() => onChoose('sign-in')}>
            Войти
          </button>
          <button type="button" className="public-home-button public-home-button-primary" onClick={() => onChoose('sign-up')}>
            Создать аккаунт
          </button>
        </div>

        <details className="public-home-mobile-menu">
          <summary aria-label="Открыть меню">Меню</summary>
          <div>
            <a href="#capabilities">Возможности</a>
            <a href="#projects">Проекты</a>
            <a href="#learning">Обучение</a>
            <a href="#teachers">Преподавателям</a>
            <a href="#about">О проекте</a>
            <button type="button" onClick={() => onChoose('sign-in')}>Войти</button>
            <button type="button" className="is-primary" onClick={() => onChoose('sign-up')}>Создать аккаунт</button>
          </div>
        </details>
      </header>

      <main id="public-home-main">
        <section className="public-home-hero" aria-labelledby="public-home-title">
          <div className="public-home-hero-copy">
            <p className="public-home-kicker">Цифровая среда для проектов и обучения</p>
            <h1 id="public-home-title">Создавай. Исследуй. Учись через действие.</h1>
            <p className="public-home-hero-lead">
              ASA Lab объединяет 3D-моделирование, виртуальную электронику, программирование,
              творчество и интеллектуальные игры. Создавайте свои проекты, изучайте работы других,
              проходите обучение или работайте в классе — всё в одной среде.
            </p>
            <div className="public-home-actions">
              <button type="button" className="public-home-button public-home-button-primary" onClick={() => onChoose('sign-up')}>
                Создать аккаунт
              </button>
              <button type="button" className="public-home-button public-home-button-secondary" onClick={() => onChoose('sign-in')}>
                Войти
              </button>
            </div>
            <button type="button" className="public-home-class-code" onClick={() => onChoose('class-code')}>
              Мне дали код класса →
            </button>
            <div className="public-home-trust" aria-label="Ключевые возможности">
              <span>Работает в браузере</span>
              <span>Свои проекты</span>
              <span>Обучение</span>
              <span>Классы и задания</span>
            </div>
          </div>

          <div className="public-home-hero-stage" aria-label="Текущий интерфейс ASA Lab">
            <figure className="public-home-hero-main-shot">
              <img src={homeDashboard} alt="Главная ASA Lab с 3D-моделями и электронными проектами" />
            </figure>
            <figure className="public-home-hero-float public-home-hero-float-code">
              <img src={electronicsBlocks} alt="Arduino и программа из визуальных блоков в ASA Lab" />
            </figure>
            <figure className="public-home-hero-float public-home-hero-float-3d">
              <img src={threeDBus} alt="Модель автобуса в 3D-редакторе ASA Lab" />
            </figure>
          </div>
        </section>

        <section className="public-home-section public-home-capabilities" id="capabilities" aria-labelledby="capabilities-title">
          <div className="public-home-section-head">
            <p className="public-home-kicker">Что можно делать</p>
            <h2 id="capabilities-title">Несколько способов создавать и решать задачи — в одной среде</h2>
            <p>
              Выбирайте инструмент под задачу, сохраняйте результат как проект и возвращайтесь к нему,
              чтобы улучшать решение. ASA Lab связывает разные направления общей проектной логикой.
            </p>
          </div>

          <div className="public-home-capability-grid">
            {capabilities.map((capability) => (
              <article className="public-home-capability" key={capability.title}>
                <div className="public-home-capability-image">
                  <img src={capability.image} alt={capability.alt} loading="lazy" />
                </div>
                <div className="public-home-capability-copy">
                  <h3>{capability.title}</h3>
                  <p>{capability.copy}</p>
                  <a href={capability.href}>Подробнее →</a>
                </div>
              </article>
            ))}
          </div>

          <div className="public-home-ecosystem-line" aria-label="Общий образовательный контур">
            <strong>Единый контур:</strong>
            <span>Проекты</span>
            <span>Галерея</span>
            <span>Знания</span>
            <span>Курсы и задания</span>
            <span>Классы</span>
            <span>Обратная связь</span>
          </div>
        </section>

        <section className="public-home-section public-home-proof" aria-labelledby="proof-title">
          <div className="public-home-section-head public-home-section-head-wide">
            <p className="public-home-kicker">Реальный продукт</p>
            <h2 id="proof-title">Это не макет — это рабочая среда</h2>
            <p>
              Ниже — актуальные интерфейсы ASA Lab. Схема, код, блоки и 3D-модель находятся рядом с тем,
              что пользователь действительно создаёт и проверяет.
            </p>
          </div>

          <div className="public-home-proof-story">
            <div className="public-home-proof-copy">
              <span className="public-home-proof-index">01</span>
              <h3>Электроника и Arduino</h3>
              <p>
                Соберите схему, запустите моделирование, управляйте Arduino визуальными блоками или
                текстовым C++ и сразу наблюдайте результат на компонентах.
              </p>
              <a href="/features/electronics/">О виртуальной электронике →</a>
            </div>
            <div className="public-home-proof-media public-home-proof-media-electronics">
              <img className="is-main" src={electronicsCpp} alt="Arduino и текстовый C++ в редакторе электроники ASA Lab" loading="lazy" />
              <img className="is-secondary" src={electronicsBlocks} alt="Arduino и визуальные блоки в ASA Lab" loading="lazy" />
            </div>
          </div>

          <div className="public-home-proof-story is-reversed">
            <div className="public-home-proof-copy">
              <span className="public-home-proof-index">02</span>
              <h3>3D-моделирование</h3>
              <p>
                Собирайте объекты из форм, меняйте размеры и положение, создавайте составные модели и
                сохраняйте их как собственные проекты. 3D-направление развивается в сторону CAD-сценариев.
              </p>
              <a href="/features/3d-modeling/">О 3D и CAD →</a>
            </div>
            <div className="public-home-proof-media public-home-proof-media-3d">
              <img className="is-main" src={threeDBus} alt="Красный автобус в 3D-редакторе ASA Lab" loading="lazy" />
              <img className="is-secondary" src={threeDHouse} alt="Домик в 3D-редакторе ASA Lab" loading="lazy" />
            </div>
          </div>
        </section>

        <section className="public-home-section public-home-projects" id="projects" aria-labelledby="projects-title">
          <div className="public-home-projects-copy">
            <p className="public-home-kicker">Проекты и сообщество</p>
            <h2 id="projects-title">Смотри, что создают другие. Продолжай своей идеей.</h2>
            <p>
              В ASA Lab можно хранить свои работы и смотреть опубликованные проекты. Чужой проект — это
              не готовый ответ, а источник идеи, другой подход и повод попробовать собственное решение.
            </p>
            <div className="public-home-project-tags" aria-label="Типы проектов">
              <span>3D</span><span>Электроника</span><span>Arduino</span><span>Игры</span><span>Визуальные проекты</span>
            </div>
            <button type="button" className="public-home-button public-home-button-secondary" onClick={() => onChoose('sign-in')}>
              Открыть галерею проектов
            </button>
            <p className="public-home-small-note">Галерея и личные проекты открываются после входа.</p>
          </div>
          <div className="public-home-project-wall" aria-label="Примеры проектов ASA Lab">
            <figure><img src={threeDBus} alt="3D-проект автобуса" loading="lazy" /><figcaption>3D-модель</figcaption></figure>
            <figure><img src={electronicsSimulation} alt="Электронный проект со светодиодами" loading="lazy" /><figcaption>Электроника</figcaption></figure>
            <figure><img src={threeDHouse} alt="3D-проект домика" loading="lazy" /><figcaption>3D-модель</figcaption></figure>
            <figure><img src={electronicsBlocks} alt="Проект Arduino с визуальными блоками" loading="lazy" /><figcaption>Arduino + блоки</figcaption></figure>
          </div>
        </section>

        <section className="public-home-section public-home-learning" id="learning" aria-labelledby="learning-title">
          <div className="public-home-learning-visual">
            <img src={homeDashboard} alt="Главная ASA Lab с разделами проектов и обучения" loading="lazy" />
          </div>
          <div className="public-home-learning-copy">
            <p className="public-home-kicker">Обучение внутри платформы</p>
            <h2 id="learning-title">Не только создавай — учись и развивайся</h2>
            <p>
              Проекты связаны с материалами и учебными сценариями. Можно читать объяснение, получить
              задачу, выполнить её в реальном редакторе и вернуться к результату позже.
            </p>
            <div className="public-home-learning-list">
              <article><strong>Знания</strong><span>Объяснения, примеры и материалы.</span></article>
              <article><strong>Курсы и задания</strong><span>Последовательная практическая работа.</span></article>
              <article><strong>Моё обучение</strong><span>Личные активности и возвращение к работе.</span></article>
              <article><strong>Практика</strong><span>Редакторы, где знания сразу превращаются в действие.</span></article>
            </div>
          </div>
        </section>

        <section className="public-home-section public-home-use" aria-labelledby="use-title">
          <div className="public-home-section-head">
            <p className="public-home-kicker">Для разных сценариев</p>
            <h2 id="use-title">Используйте ASA Lab так, как удобно вам</h2>
          </div>
          <div className="public-home-use-grid">
            <article>
              <span>01</span><h3>Самостоятельно</h3><p>Создавайте свои проекты, изучайте материалы и возвращайтесь к работе в удобном темпе.</p>
            </article>
            <article>
              <span>02</span><h3>В классе</h3><p>Войдите по коду, получите задание и выполните его в той же среде, где создаётся проект.</p>
              <button type="button" onClick={() => onChoose('class-code')}>У меня есть код →</button>
            </article>
            <article>
              <span>03</span><h3>Преподавателю</h3><p>Организуйте классы и задания, смотрите работу и возвращайте обратную связь.</p>
              <a href="/for-teachers/">Подробнее →</a>
            </article>
            <article>
              <span>04</span><h3>Школе и организации</h3><p>Объединяйте пользователей и преподавателей, сохраняя роли, контроль и общую среду.</p>
              <a href="/for-schools/">Для организаций →</a>
            </article>
          </div>
        </section>

        <section className="public-home-section public-home-teachers" id="teachers" aria-labelledby="teachers-title">
          <div className="public-home-teachers-copy">
            <p className="public-home-kicker">Преподавателю</p>
            <h2 id="teachers-title">Видно не только ответ, но и путь к нему</h2>
            <p>
              Преподаватель создаёт класс, выдаёт задание, получает работу и возвращает обратную связь
              в том же учебном контексте, где пользователь выполнял проект.
            </p>
            <ol>
              <li><strong>1</strong><span>Создать класс</span></li>
              <li><strong>2</strong><span>Выдать задание</span></li>
              <li><strong>3</strong><span>Получить работу</span></li>
              <li><strong>4</strong><span>Проверить и ответить</span></li>
            </ol>
            <a className="public-home-text-link" href="/for-teachers/">Возможности для преподавателей →</a>
          </div>
          <div className="public-home-teachers-media">
            <img src={assignmentProgress} alt="Прогресс выполнения задания в классе ASA Lab" loading="lazy" />
          </div>
        </section>

        <section className="public-home-section public-home-safety" id="safety" aria-labelledby="safety-title">
          <div className="public-home-section-head">
            <p className="public-home-kicker">Среда под контролем</p>
            <h2 id="safety-title">Спокойная работа без лишнего шума</h2>
          </div>
          <div className="public-home-safety-grid">
            <article><h3>Работает в браузере</h3><p>Для начала не нужно собирать сложную локальную среду на каждом устройстве.</p></article>
            <article><h3>Без рекламы</h3><p>Интерфейс не конкурирует за внимание с рекламными вставками и механиками удержания.</p></article>
            <article><h3>Роли и классы</h3><p>Учебная работа связана с конкретными участниками и пространствами.</p></article>
            <article><h3>Контролируемое общение</h3><p>Без открытого детского чата с незнакомыми пользователями.</p></article>
          </div>
          <a className="public-home-text-link" href="/safety/">Подробнее о безопасности →</a>
        </section>

        <section className="public-home-section public-home-development" aria-labelledby="development-title">
          <div className="public-home-development-copy">
            <p className="public-home-kicker">Развитие ASA Lab</p>
            <h2 id="development-title">Одна цифровая мастерская — всё больше связанных сценариев</h2>
            <p>
              ASA Lab развивается вокруг одной идеи: пользователь должен пройти путь от замысла до
              собственного результата. Поэтому редакторы, обучение, проекты сообщества и инструменты
              преподавателя связываются между собой, а не живут отдельными сервисами.
            </p>
          </div>
          <div className="public-home-development-grid">
            <article><strong>3D и CAD</strong><span>Браузерное моделирование и переход к профессиональным CAD-сценариям, включая работу с КОМПАС-3D.</span></article>
            <article><strong>Программирование</strong><span>Визуальные блоки, Arduino и переход от алгоритма к текстовому коду.</span></article>
            <article><strong>Творчество</strong><span>Рисование, форма, цвет и визуальные проекты как полноценная часть общей среды.</span></article>
            <article><strong>Обучение</strong><span>Знания, курсы, задания и практика непосредственно в редакторах.</span></article>
            <article><strong>Сообщество</strong><span>Опубликованные работы, идеи других пользователей и собственная галерея проектов.</span></article>
            <article><strong>Электроника</strong><span>Компоненты, моделирование, измерения, Arduino и расширение инженерных сценариев.</span></article>
          </div>
        </section>

        <section className="public-home-section public-home-about" id="about" aria-labelledby="about-title">
          <div className="public-home-about-copy">
            <p className="public-home-kicker">О проекте</p>
            <h2 id="about-title">ASA Lab создаётся вокруг реальной практики</h2>
            <p>
              Платформа строится как цифровая мастерская: пользователь не только смотрит демонстрацию,
              а делает собственную попытку, видит результат, исправляет ошибки и объясняет решение.
            </p>
            <div className="public-home-about-links">
              <a href="/about/">Подробнее о проекте →</a>
              <a href="https://github.com/spikeal8-maker/asa-lab" target="_blank" rel="noreferrer">GitHub →</a>
              <a href="https://vk.ru/asalabru" target="_blank" rel="noreferrer">VK →</a>
            </div>
          </div>
          <article className="public-home-creator">
            <img src="https://avatars.githubusercontent.com/u/256861174?v=4" alt="Александр Аликин — создатель ASA Lab" loading="lazy" />
            <div>
              <span>Создатель ASA Lab</span>
              <h3>Александр Аликин</h3>
              <p>
                Преподаватель технических и цифровых дисциплин, инженер-практик и предприниматель.
                Развивает ASA Lab на основе проектных задач, образовательных сценариев и практической
                работы с пользователями и учащимися.
              </p>
            </div>
          </article>
        </section>

        <section className="public-home-final" aria-labelledby="final-title">
          <div>
            <p className="public-home-kicker">Начните с собственной идеи</p>
            <h2 id="final-title">Создавайте, проверяйте и развивайте результат в ASA Lab</h2>
          </div>
          <div className="public-home-actions">
            <button type="button" className="public-home-button public-home-button-primary" onClick={() => onChoose('sign-up')}>
              Создать аккаунт
            </button>
            <button type="button" className="public-home-button public-home-button-secondary" onClick={() => onChoose('sign-in')}>
              Войти
            </button>
          </div>
        </section>
      </main>

      <footer className="public-home-footer">
        <div className="public-home-footer-brand">
          <AsaLabWordmark />
          <p>Цифровая среда для проектов, обучения и творчества.</p>
        </div>
        <div className="public-home-footer-links">
          <div><strong>Платформа</strong><a href="#capabilities">Возможности</a><a href="#projects">Проекты</a><a href="#learning">Обучение</a></div>
          <div><strong>Работа вместе</strong><a href="/for-teachers/">Преподавателям</a><a href="/for-schools/">Организациям</a><a href="/safety/">Безопасность</a></div>
          <div><strong>ASA Lab</strong><a href="/about/">О проекте</a><a href="/faq/">FAQ</a><a href="https://vk.ru/asalabru" target="_blank" rel="noreferrer">ВКонтакте</a></div>
          <div><strong>Разработка</strong><a href="https://github.com/spikeal8-maker/asa-lab" target="_blank" rel="noreferrer">GitHub</a><a href="/llms.txt">Для AI-систем</a></div>
        </div>
        <div className="public-home-footer-bottom">
          <span>© ASA Lab · Александр Аликин</span>
          <span>Код: AGPL-3.0-only · бренд и отдельные материалы защищены.</span>
        </div>
      </footer>
    </div>
  );
}
