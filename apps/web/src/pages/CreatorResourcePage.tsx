import type { CreatorPortalSection } from '../creator-portal/navigation';

type ResourceSection = Extract<CreatorPortalSection, 'collections' | 'challenges' | 'help'>;

interface ResourceCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly cards: ReadonlyArray<{
    readonly title: string;
    readonly body: string;
    readonly action: string;
    readonly target: 'projects' | 'home' | 'account';
  }>;
}

const COPY: Record<ResourceSection, ResourceCopy> = {
  collections: {
    eyebrow: 'Личная библиотека',
    title: 'Коллекции',
    description:
      'Раздел готов к навигации. Сохранённых коллекций пока нет — мы не показываем вымышленные материалы.',
    cards: [
      {
        title: 'Коллекции пока пусты',
        body: 'Ваши проекты уже доступны отдельно и не будут автоматически превращены в коллекции.',
        action: 'Перейти к проектам',
        target: 'projects',
      },
      {
        title: 'Что появится здесь',
        body: 'В следующих этапах здесь можно будет собирать собственные материалы в тематические подборки.',
        action: 'Вернуться на главную',
        target: 'home',
      },
    ],
  },
  challenges: {
    eyebrow: 'Практика',
    title: 'Испытания',
    description:
      'Назначенных испытаний сейчас нет. Для практики можно продолжить существующий проект или создать новый.',
    cards: [
      {
        title: 'Практика в электронике',
        body: 'Попробуйте собрать замкнутую цепь и добиться корректной диагностики.',
        action: 'Открыть проекты',
        target: 'projects',
      },
      {
        title: 'Практика в шахматах',
        body: 'Создайте шахматный проект и откройте встроенный тренажёр задач.',
        action: 'Открыть проекты',
        target: 'projects',
      },
    ],
  },
  help: {
    eyebrow: 'Поддержка',
    title: 'Помощь',
    description: 'Короткие ответы о проектах, сохранении данных и текущем рабочем пространстве.',
    cards: [
      {
        title: 'Где мои проекты?',
        body: 'Все личные проекты находятся в разделе «Мои проекты» и доступны после повторного входа.',
        action: 'Открыть проекты',
        target: 'projects',
      },
      {
        title: 'Как сменить пространство?',
        body: 'Откройте меню аккаунта справа вверху и выберите доступное рабочее пространство.',
        action: 'Настройки аккаунта',
        target: 'account',
      },
      {
        title: 'Когда доступны классы?',
        body: 'В «Классах» находятся ваши занятия и задания. Преподаватель здесь также управляет своими классами.',
        action: 'Настройки аккаунта',
        target: 'account',
      },
    ],
  },
};

export function CreatorResourcePage({
  section,
  onNavigate,
}: {
  section: ResourceSection;
  onNavigate: (target: 'projects' | 'home' | 'account') => void;
}): JSX.Element {
  const copy = COPY[section];
  return (
    <main className="portal-content creator-resource" id="main-content" tabIndex={-1}>
      <header className="creator-resource-heading">
        <p className="portal-eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>
      <div className="creator-resource-grid">
        {copy.cards.map((card) => (
          <article key={card.title} className="creator-resource-card">
            <h2>{card.title}</h2>
            <p>{card.body}</p>
            <button
              type="button"
              className="creator-text-action"
              onClick={() => onNavigate(card.target)}
            >
              {card.action}
            </button>
          </article>
        ))}
      </div>
      {section === 'help' ? (
        <section className="creator-resource-card">
          <h2>О проекте и сообщество</h2>
          <p>
            ASA Lab — среда для творчества и обучения. Здесь можно создавать 3D модели, собирать
            электронные схемы и делиться работами. Платформа развивается; новости и обратная связь —
            в нашем сообществе.
          </p>
          <div className="home-community-links">
            <a href="https://vk.ru/asalabru" target="_blank" rel="noopener noreferrer">
              ВКонтакте ↗
            </a>
            <a href="https://max.ru/id231408577954_3_bot" target="_blank" rel="noopener noreferrer">
              Бот ASA Lab в MAX ↗
            </a>
          </div>
        </section>
      ) : null}
    </main>
  );
}
