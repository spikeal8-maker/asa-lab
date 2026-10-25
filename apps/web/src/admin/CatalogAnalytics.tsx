import type { AdminCatalogPage } from './admin-api';
const labels: Record<string, string> = {
  unknown: 'Неизвестно',
  learner: 'Ученическое место',
  creator: 'Автор',
  educator: 'Преподаватель',
  registered_student: 'Учащийся',
  guardian: 'Представитель',
  platform_admin: 'Администратор платформы',
  owner: 'Владелец организации',
  school_admin: 'Администратор организации',
  member: 'Участник организации',
  desktop: 'Компьютер',
  mobile: 'Телефон',
  tablet: 'Планшет',
  password: 'Пароль',
  student_code: 'Код ученика',
  max: 'MAX',
  telegram: 'Telegram',
  email: 'Почта',
  class_code: 'Код ученика',
  organization: 'Вход организации',
  electronics: 'Электроника',
  'three-d': '3D',
  chess: 'Шахматы',
  checkers: 'Шашки',
};
export function CatalogAnalytics({
  value: a,
}: {
  value: NonNullable<AdminCatalogPage['analytics']>;
}) {
  const series = a.daily ?? [],
    max = Math.max(1, ...series.map((d) => d.events));
  return (
    <details className="crm-directory-analytics">
      <summary>Аналитика выбранных записей</summary>
      <p>
        Аккаунты: {a.accounts}; ученические места: {a.students}; записей со связанным профилем:{' '}
        {a.linkedRecords ?? 'недоступно в этой области'}. Это не число уникальных людей.
      </p>
      <p>
        Возраст неизвестен или недоступен: {a.ageUnknown}; почта отсутствует: {a.emailAbsent};
        источник визита неизвестен: {a.sourceUnknown}; активность наблюдалась: {a.activeObserved}.
      </p>
      {a.aiCoverage === 'students_only_accounts_unavailable' ? (
        <p>
          ИИ: только разрешённые ученические места. Личная активность ИИ аккаунтов в этой области
          недоступна.
        </p>
      ) : null}
      <p>
        Зарегистрированные обращения к ИИ за {a.periodDays} дней:{' '}
        {a.aiRequests ?? 'недоступно в этой области'}; с известными входными и выходными токенами:{' '}
        {a.aiTokenCovered ?? 'недоступно'}. Известные входные токены:{' '}
        {a.aiInputTokens ?? 'неизвестно'}; выходные: {a.aiOutputTokens ?? 'неизвестно'}.
      </p>
      <p>
        Прежние обращения без журнала токенов: {a.aiLegacyRequests ?? 'покрытие недоступно'}.
        Источник регистрации и страна по IP не сохранялись. Адрес сайта-источника — заявленное
        браузером первое наблюдение визита, а не доказанный источник регистрации. Нулевые показатели
        означают отсутствие сохранённых событий, а не доказанное отсутствие использования. События и
        запросы ИИ приведены за выбранный период; профиль и первый источник визита — за доступную
        историю. Топ источников и рабочих сред ограничен 30 группами.
      </p>
      {(
        [
          ['Возможности (могут сочетаться)', a.roles],
          ['Возрастные группы', a.ageGroups],
          ['Устройства последнего наблюдения', a.devices],
          ['Способы зафиксированных входов за период', a.loginMethods],
          ['События по рабочим средам за период', a.tools],
          ['Источники первых известных визитов', a.referrers],
        ] as [string, Record<string, number> | undefined][]
      ).map(([title, groups]) => (
        <section key={title}>
          <h3>{title}</h3>
          {groups && Object.keys(groups).length ? (
            <ul>
              {Object.entries(groups).map(([key, n]) => (
                <li key={key}>
                  {labels[key] ?? key}: {n}
                </li>
              ))}
            </ul>
          ) : (
            <p>Наблюдения отсутствуют.</p>
          )}
        </section>
      ))}
      <h3>Создание записей и сохранённые события по дням (UTC)</h3>
      {series.length >= 10 && series.some((d) => d.events > 0) ? (
        <svg
          role="img"
          aria-label="Сохранённые события по дням; точные значения в таблице ниже"
          viewBox="0 0 600 160"
          style={{ width: '100%', maxWidth: 600 }}
        >
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={series
              .map((d, i) => `${(i * 600) / (series.length - 1)},${130 - (d.events / max) * 120}`)
              .join(' ')}
          />
          <text x="0" y="153" fontSize="12">
            {series[0]?.date}
          </text>
          <text x="600" y="153" textAnchor="end" fontSize="12">
            {series.at(-1)?.date}
          </text>
        </svg>
      ) : (
        <p>
          {series.length
            ? 'График событий недоступен: менее 10 точек или нет сохранённых событий.'
            : 'История по дням недоступна.'}
        </p>
      )}
      {series.length ? (
        <details>
          <summary>Точные значения по дням</summary>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Дата UTC</th>
                  <th>Создано записей</th>
                  <th>Сохранено событий</th>
                </tr>
              </thead>
              <tbody>
                {series.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.registrations}</td>
                    <td>{d.events}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </details>
  );
}
