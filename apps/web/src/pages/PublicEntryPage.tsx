import { AsaLabWordmark } from '../brand/AsaLabBrand';
import './PublicEntryPage.css';

const homeDashboard = '/landing/home-dashboard.png';
const electronicsSimulation = '/landing/electronics-simulation.png';
const electronicsBlocks = '/landing/electronics-blocks.png';
const electronicsCpp = '/landing/electronics-cpp.png';
const threeDBus = '/landing/three-d-bus.png';
const threeDHouse = '/landing/three-d-house.png';

export type PublicIntent = 'sign-in' | 'sign-up' | 'class-code';

type Capability = {
  readonly title: string;
  readonly copy: string;
  readonly image: string;
  readonly alt: string;
  readonly href?: string;
  readonly status?: string;
};

const capabilities: readonly Capability[] = [
  {
    title: '3D и CAD',
    copy: 'Создавайте 3D-модели, работайте с формами, размерами и геометрией. CAD-направление развивается в сторону более точного инженерного проектирования.',
    image: '/social/asa-lab-3d-modeling.png',
    alt: '3D-моделирование и CAD в ASA Lab',
    href: '/features/3d-modeling/',
    status: '3D доступно · CAD развивается',
  },
  {
    title: 'Электроника и Arduino',
    copy: 'Собирайте схемы, подключайте компоненты, запускайте моделирование, измеряйте параметры и управляйте Arduino блоками или текстовым кодом.',
    image: '/social/asa-lab-electronics.png',
    alt: 'Виртуальная электроника и Arduino в ASA Lab',
    href: '/features/electronics/',
    status: 'Доступно',
  },
  {
    title: 'Программирование и робототехника',
    copy: 'Собирайте алгоритмы из визуальных блоков, переходите к текстовому коду и связывайте программу с поведением схем, устройств и роботов.',
    image: '/social/asa-lab-block-programming.png',
    alt: 'Блочное программирование и робототехника в ASA Lab',
    href: '/features/block-programming/',
    status: 'Развивается',
  },
  {
    title: 'Творческие инструменты',
    copy: 'Работайте с формой, цветом, композицией, эскизами и визуальными проектами — на одном уровне с техническими инструментами.',
    image: '/social/asa-lab-drawing.png',
    alt: 'Рисование и визуальные проекты в ASA Lab',
    href: '/features/drawing/',
    status: 'Развивается',
  },
  {
    title: 'Шахматы и русские шашки',
    copy: 'Играйте, разбирайте позиции, проверяйте варианты и сохраняйте результаты в интерактивных игровых и аналитических средах.',
    image: '/social/asa-lab-chess-checkers.png',
    alt: 'Шахматы и русские шашки в ASA Lab',
    href: '/features/chess-and-checkers/',
    status: 'Доступно',
  },
  {
    title: 'ИИ и генеративные инструменты',
    copy: 'ИИ развивается как помощник и соавтор внутри проекта, а генеративные инструменты — как быстрый способ получить заготовку и продолжить работу.',
    image: '/social/asa-lab-og.png',
    alt: 'ASA Lab — цифровая мастерская с ИИ и генеративными инструментами',
    status: 'Развивается',
  },
];

const creatorCycle = [
  ['01', 'Выбрать инструмент', '3D, электроника, программирование, творчество или игровая среда.'],
  ['02', 'Сделать проект', 'Попробовать идею, проверить результат и сохранить работу.'],
  ['03', 'Показать другим', 'Опубликовать проект и получить реакцию сообщества.'],
  ['04', 'Сделать следующую версию', 'Вернуться к работе, изменить подход и развить идею дальше.'],
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
          <a href="#community">Сообщество</a>
          <a href="#capabilities">Инструменты</a>
          <a href="#projects">Проекты</a>
          <a href="#development">Развитие</a>
          <a href="#about">О проекте</a>
        </nav>

        <div className="public-home-header-actions" aria-label="Аккаунт">
          <button
            type="button"
            className="public-home-button public-home-button-quiet"
            onClick={() => onChoose('sign-in')}
          >
            Войти
          </button>
          <button
            type="button"
            className="public-home-button public-home-button-primary"
            onClick={() => onChoose('sign-up')}
          >
            Создать аккаунт
          </button>
        </div>

        <details className="public-home-mobile-menu">
          <summary aria-label="Открыть меню">Меню</summary>
          <div>
            <a href="#community">Сообщество</a>
            <a href="#capabilities">Инструменты</a>
            <a href="#projects">Проекты</a>
            <a href="#development">Развитие</a>
            <a href="#about">О проекте</a>
            <button type="button" onClick={() => onChoose('sign-in')}>
              Войти
            </button>
            <button type="button" className="is-primary" onClick={() => onChoose('sign-up')}>
              Создать аккаунт
            </button>
          </div>
        </details>
      </header>

      <main id="public-home-main">
        <section className="public-home-hero" aria-labelledby="public-home-title">
          <div className="public-home-hero-copy">
            <p className="public-home-kicker">Цифровая мастерская и сообщество</p>
            <h1 id="public-home-title">Идея есть? Сделай её.</h1>
            <p className="public-home-hero-lead">
              ASA Lab — браузерная среда, где можно моделировать, собирать схемы,
              программировать, создавать собственные цифровые проекты и смотреть, что делают другие.
              Инструменты, проекты, авторы и сообщество связаны в одной экосистеме.
            </p>
            <div className="public-home-actions">
              <button
                type="button"
                className="public-home-button public-home-button-primary"
                onClick={() => onChoose('sign-up')}
              >
                Начать создавать
              </button>
              <a className="public-home-button public-home-button-secondary" href="#community">
                Смотреть проекты
              </a>
            </div>
            <button
              type="button"
              className="public-home-class-code"
              onClick={() => onChoose('class-code')}
            >
              У меня есть код класса →
            </button>
            <div className="public-home-trust" aria-label="Ключевые свойства ASA Lab">
              <span>Работает в браузере</span>
              <span>Свои проекты</span>
              <span>Проекты сообщества</span>
              <span>Разные инструменты в одной среде</span>
            </div>
          </div>

          <div className="public-home-hero-stage" aria-label="Актуальные интерфейсы ASA Lab">
            <figure className="public-home-shot public-home-shot-main">
              <img
                src={homeDashboard}
                alt="Главная ASA Lab с 3D-моделями и электронными проектами"
              />
            </figure>
            <div className="public-home-shot-row">
              <figure className="public-home-shot">
                <img
                  src={electronicsBlocks}
                  alt="Arduino и программа из визуальных блоков в ASA Lab"
                />
              </figure>
              <figure className="public-home-shot">
                <img src={threeDBus} alt="Модель автобуса в 3D-редакторе ASA Lab" />
              </figure>
            </div>
          </div>
        </section>

        <section
          className="public-home-section public-home-community"
          id="community"
          aria-labelledby="community-title"
        >
          <div className="public-home-section-head public-home-section-head-wide">
            <p className="public-home-kicker">Проекты сообщества</p>
            <h2 id="community-title">Смотри, что делают другие. Показывай своё.</h2>
            <p>
              В ASA Lab уже есть галерея опубликованных работ: новые и популярные проекты,
              фильтрация по средам, реакции и выбор редакции. Социальный слой развивается дальше —
              вокруг авторов, проектов и их новых версий, а не вокруг бесконечного общего чата.
            </p>
          </div>

          <div className="public-home-community-layout">
            <div className="public-home-project-wall" aria-label="Примеры проектов ASA Lab">
              <figure>
                <img src={threeDBus} alt="3D-проект автобуса в ASA Lab" loading="lazy" />
                <figcaption>
                  <strong>3D-модель</strong>
                  <span>Проект в 3D-среде</span>
                </figcaption>
              </figure>
              <figure>
                <img
                  src={electronicsSimulation}
                  alt="Электронный проект со светодиодами в ASA Lab"
                  loading="lazy"
                />
                <figcaption>
                  <strong>Электроника</strong>
                  <span>Схема и симуляция</span>
                </figcaption>
              </figure>
              <figure>
                <img src={threeDHouse} alt="3D-проект домика в ASA Lab" loading="lazy" />
                <figcaption>
                  <strong>3D-модель</strong>
                  <span>Работа пользователя</span>
                </figcaption>
              </figure>
              <figure>
                <img
                  src={electronicsBlocks}
                  alt="Проект Arduino с визуальными блоками в ASA Lab"
                  loading="lazy"
                />
                <figcaption>
                  <strong>Arduino + блоки</strong>
                  <span>Программа рядом со схемой</span>
                </figcaption>
              </figure>
            </div>

            <aside className="public-home-community-panel">
              <span className="public-home-status is-live">Уже есть</span>
              <h3>Галерея опубликованных работ</h3>
              <ul>
                <li>Новые и популярные проекты</li>
                <li>Реакции «Нравится» и «Ого»</li>
                <li>Фильтрация по средам</li>
                <li>Выбор редакции</li>
              </ul>
              <span className="public-home-status">Развивается</span>
              <p>
                Профили авторов, подписки, обсуждения, скачивание, связь с оригиналом и возможность
                создавать собственную версию проекта.
              </p>
              <button
                type="button"
                className="public-home-button public-home-button-secondary"
                onClick={() => onChoose('sign-in')}
              >
                Войти и открыть галерею
              </button>
            </aside>
          </div>
        </section>

        <section
          className="public-home-section public-home-capabilities"
          id="capabilities"
          aria-labelledby="capabilities-title"
        >
          <div className="public-home-section-head">
            <p className="public-home-kicker">Инструменты</p>
            <h2 id="capabilities-title">Выбери среду и сделай что-то своё</h2>
            <p>
              ASA Lab не сводится к одному редактору. Разные инструменты объединяются общей системой
              проектов, чтобы результат можно было сохранить, показать и продолжить развивать.
            </p>
          </div>

          <div className="public-home-capability-grid">
            {capabilities.map((capability) => (
              <article className="public-home-capability" key={capability.title}>
                <div className="public-home-capability-image">
                  <img src={capability.image} alt={capability.alt} loading="lazy" />
                </div>
                <div className="public-home-capability-copy">
                  {capability.status ? <span className="public-home-card-status">{capability.status}</span> : null}
                  <h3>{capability.title}</h3>
                  <p>{capability.copy}</p>
                  {capability.href ? <a href={capability.href}>Подробнее →</a> : null}
                </div>
              </article>
            ))}
          </div>

          <div className="public-home-ecosystem-line" aria-label="Экосистема ASA Lab">
            <strong>Одна экосистема:</strong>
            <span>Инструменты</span>
            <span>Проекты</span>
            <span>Авторы</span>
            <span>Галерея</span>
            <span>Реакции</span>
            <span>ИИ</span>
            <span>Совместная работа</span>
          </div>
        </section>

        <section
          className="public-home-section public-home-project-core"
          id="projects"
          aria-labelledby="projects-title"
        >
          <div className="public-home-section-head public-home-section-head-wide">
            <p className="public-home-kicker">Проект — центр ASA Lab</p>
            <h2 id="projects-title">Создавай. Пробуй. Делись. Улучшай.</h2>
            <p>
              Проект — это не одноразовая сессия. Это сохраняемый результат, к которому можно
              вернуться, сделать новую версию, опубликовать его и использовать как точку старта для
              следующей идеи.
            </p>
          </div>
          <div className="public-home-cycle-grid">
            {creatorCycle.map(([number, title, copy]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="public-home-section public-home-proof" aria-labelledby="proof-title">
          <div className="public-home-section-head public-home-section-head-wide">
            <p className="public-home-kicker">Реальный продукт</p>
            <h2 id="proof-title">Не рекламный макет — рабочие редакторы</h2>
            <p>
              Показываем интерфейсы без декоративного обрезания и наложений: так видно, чем человек
              действительно пользуется внутри ASA Lab.
            </p>
          </div>

          <div className="public-home-proof-grid">
            <article className="public-home-proof-card">
              <div className="public-home-proof-copy">
                <span className="public-home-proof-index">01</span>
                <h3>Электроника и Arduino</h3>
                <p>
                  Схема, компоненты, симуляция, визуальные блоки и текстовый C++ находятся рядом с
                  реальным результатом проекта.
                </p>
                <a href="/features/electronics/">О виртуальной электронике →</a>
              </div>
              <div className="public-home-proof-images">
                <img
                  src={electronicsCpp}
                  alt="Arduino и текстовый C++ в редакторе электроники ASA Lab"
                  loading="lazy"
                />
                <img
                  src={electronicsBlocks}
                  alt="Arduino и визуальные блоки в ASA Lab"
                  loading="lazy"
                />
              </div>
            </article>

            <article className="public-home-proof-card">
              <div className="public-home-proof-copy">
                <span className="public-home-proof-index">02</span>
                <h3>3D-моделирование</h3>
                <p>
                  Формы, размеры, композиция и составные объекты — с сохранением работы как
                  собственного проекта. CAD-сценарии развиваются поверх этой основы.
                </p>
                <a href="/features/3d-modeling/">О 3D и CAD →</a>
              </div>
              <div className="public-home-proof-images">
                <img src={threeDBus} alt="Автобус в 3D-редакторе ASA Lab" loading="lazy" />
                <img src={threeDHouse} alt="Домик в 3D-редакторе ASA Lab" loading="lazy" />
              </div>
            </article>
          </div>
        </section>

        <section
          className="public-home-section public-home-development"
          id="development"
          aria-labelledby="development-title"
        >
          <div className="public-home-development-copy">
            <p className="public-home-kicker">Куда развивается ASA Lab</p>
            <h2 id="development-title">Больше способов создавать — то же проектное ядро</h2>
            <p>
              Новые инструменты не должны превращать ASA Lab в случайный каталог редакторов. Они
              подключаются к общей системе проектов, авторов и сообщества.
            </p>
          </div>
          <div className="public-home-development-grid">
            <article>
              <span className="public-home-status">Развивается</span>
              <strong>CAD-среда</strong>
              <p>
                Более точное инженерное моделирование с привычной логикой профессиональных CAD-систем.
                КОМПАС-3D остаётся ориентиром для отдельных российских сценариев, а не определением бренда.
              </p>
            </article>
            <article>
              <span className="public-home-status">Интегрируется</span>
              <strong>Scratch</strong>
              <p>
                Оригинальная среда Scratch рассматривается как отдельный визуальный сценарий внутри
                экосистемы ASA Lab.
              </p>
            </article>
            <article>
              <span className="public-home-status">Развивается</span>
              <strong>Визуальная робототехника</strong>
              <p>Движение, условия, циклы, датчики и поведение роботов через блочные программы.</p>
            </article>
            <article>
              <span className="public-home-status">Развивается</span>
              <strong>ИИ-помощник</strong>
              <p>
                ИИ как соавтор внутри проекта: помогает перейти от замысла к результату и от первой
                версии к следующей.
              </p>
            </article>
            <article>
              <span className="public-home-status">Развивается</span>
              <strong>Генеративные инструменты</strong>
              <p>Быстрые заготовки и результаты, которые можно продолжить редактировать в проекте.</p>
            </article>
            <article>
              <span className="public-home-status">Развивается</span>
              <strong>Социальный слой</strong>
              <p>
                Профили, подписки, обсуждения, скачивание, свои версии и видимая связь производной
                работы с оригиналом.
              </p>
            </article>
          </div>
        </section>

        <section className="public-home-section public-home-use" aria-labelledby="use-title">
          <div className="public-home-section-head">
            <p className="public-home-kicker">Как использовать</p>
            <h2 id="use-title">Для себя, вместе с другими или в группе</h2>
            <p>
              Базовый сценарий — просто прийти и сделать проект. Классы, задания и преподавательские
              функции остаются дополнительным способом организовать совместную работу.
            </p>
          </div>
          <div className="public-home-use-grid">
            <article>
              <span>01</span>
              <h3>Для себя</h3>
              <p>Хобби, личная идея, эксперимент, прототип или просто желание попробовать новый инструмент.</p>
            </article>
            <article>
              <span>02</span>
              <h3>С сообществом</h3>
              <p>Смотрите опубликованные работы, реагируйте, находите идеи и показывайте собственные проекты.</p>
            </article>
            <article>
              <span>03</span>
              <h3>В группе или классе</h3>
              <p>При необходимости подключайте код класса, задания и общую организацию работы.</p>
              <button type="button" onClick={() => onChoose('class-code')}>
                У меня есть код →
              </button>
            </article>
            <article>
              <span>04</span>
              <h3>Преподавателю или организации</h3>
              <p>Классы, роли, задания и обратная связь доступны как отдельный рабочий контур.</p>
              <div className="public-home-inline-links">
                <a href="/for-teachers/">Преподавателям →</a>
                <a href="/for-schools/">Организациям →</a>
              </div>
            </article>
          </div>
        </section>

        <section
          className="public-home-section public-home-about"
          id="about"
          aria-labelledby="about-title"
        >
          <div className="public-home-about-copy">
            <p className="public-home-kicker">О проекте</p>
            <h2 id="about-title">ASA Lab строится как самостоятельная цифровая экосистема</h2>
            <p>
              Ценность ASA Lab не в количестве редакторов сама по себе. Платформа связывает
              инструменты, проекты, авторов, публикации и развитие идей, чтобы человеку не приходилось
              собирать весь процесс из несвязанных сервисов.
            </p>
            <p>
              Проект может закрывать часть сценариев, для которых раньше использовались разные или
              недоступные сервисы, но ASA Lab не позиционируется как копия Tinkercad, Scratch или
              КОМПАС-3D.
            </p>
            <div className="public-home-about-links">
              <a href="/about/">Подробнее о проекте →</a>
              <a href="https://github.com/spikeal8-maker/asa-lab" target="_blank" rel="noreferrer">
                Исходный код · AGPL-3.0 →
              </a>
              <a href="https://vk.ru/asalabru" target="_blank" rel="noreferrer">
                Сообщество ВКонтакте →
              </a>
            </div>
          </div>
          <article className="public-home-creator">
            <img
              src="/landing/creator-avatar.jpg"
              alt="Александр Аликин — создатель ASA Lab"
              loading="lazy"
            />
            <div>
              <span>Создатель ASA Lab</span>
              <h3>Александр Аликин</h3>
              <p>
                Преподаватель технических и цифровых дисциплин, инженер-практик и предприниматель.
                Развивает ASA Lab как среду, где человек может попробовать идею, сделать собственный
                результат и продолжить его развивать.
              </p>
            </div>
          </article>
        </section>

        <section className="public-home-final" aria-labelledby="final-title">
          <div>
            <p className="public-home-kicker">Начни с интереса или идеи</p>
            <h2 id="final-title">Сделай своё. Покажи другим. Вернись с новой версией.</h2>
          </div>
          <div className="public-home-actions">
            <button
              type="button"
              className="public-home-button public-home-button-primary"
              onClick={() => onChoose('sign-up')}
            >
              Создать аккаунт
            </button>
            <a className="public-home-button public-home-button-secondary" href="#community">
              Смотреть проекты
            </a>
          </div>
        </section>
      </main>

      <footer className="public-home-footer">
        <div className="public-home-footer-brand">
          <AsaLabWordmark />
          <p>Цифровая мастерская и сообщество для создания и развития проектов.</p>
        </div>
        <div className="public-home-footer-links">
          <div>
            <strong>Платформа</strong>
            <a href="#capabilities">Инструменты</a>
            <a href="#projects">Проекты</a>
            <a href="#community">Сообщество</a>
            <a href="#development">Развитие</a>
          </div>
          <div>
            <strong>Совместная работа</strong>
            <a href="/for-teachers/">Преподавателям</a>
            <a href="/for-schools/">Организациям</a>
            <a href="/safety/">Безопасность</a>
          </div>
          <div>
            <strong>ASA Lab</strong>
            <a href="/about/">О проекте</a>
            <a href="/faq/">FAQ</a>
            <a href="https://vk.ru/asalabru" target="_blank" rel="noreferrer">
              ВКонтакте
            </a>
          </div>
          <div>
            <strong>Разработка</strong>
            <a href="https://github.com/spikeal8-maker/asa-lab" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="/llms.txt">Для AI-систем</a>
          </div>
        </div>
        <div className="public-home-footer-bottom">
          <span>© ASA Lab · Александр Аликин</span>
          <span>Код: AGPL-3.0-only · бренд и отдельные материалы защищены.</span>
        </div>
      </footer>
    </div>
  );
}
