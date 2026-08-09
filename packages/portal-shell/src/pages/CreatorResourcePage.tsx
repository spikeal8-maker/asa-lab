import type { CreatorPortalSection } from '../creator-portal/navigation';

type ResourceSection = Extract<
  CreatorPortalSection,
  'learning' | 'collections' | 'challenges' | 'help'
>;

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
  learning: {
    eyebrow: 'Маршрут обучения',
    title: 'Обучение',
    description:
      'Выберите среду, создайте небольшой проект и сохраните контрольную версию результата.',
    cards: [
      {
        title: 'Электроника',
        body: 'Соберите цепь, запустите моделирование и проверьте диагностику.',
        action: 'Открыть мои проекты',
        target: 'projects',
      },
      {
        title: 'ASA Chess',
        body: 'Разберите позицию, сохраните партию или перейдите к шахматным задачам.',
        action: 'Открыть мои проекты',
        target: 'projects',
      },
      {
        title: 'Как сохраняется работа',
        body: 'Черновики сохраняются в проекте, а контрольные версии остаются неизменяемыми.',
        action: 'На главную',
        target: 'home',
      },
    ],
  },
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
        body: 'Раздел появляется только для аккаунта педагога в организационном рабочем пространстве.',
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
    </main>
  );
}
