import { useState } from 'react';
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
  blocks: 'Блоки',
};
type Analytics = NonNullable<AdminCatalogPage['analytics']>;
type Day = NonNullable<Analytics['daily']>[number];
/** Select existing calendar points; never manufacture missing dates or values. */
export function chartTickIndices(length: number): number[] {
  const count = Math.min(10, length);
  return Array.from({ length: count }, (_, index) =>
    count === 1 ? 0 : Math.round((index * (length - 1)) / (count - 1)),
  );
}
function DailyChart({
  series,
  metric,
  title,
}: {
  series: Day[];
  metric: 'registrations' | 'events';
  title: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!series.length)
    return (
      <section className="crm-analytics-chart">
        <h4>{title}</h4>
        <p>История по дням недоступна.</p>
      </section>
    );
  const maximum = Math.max(1, ...series.map((day) => day[metric]));
  const top = maximum < 4 ? maximum : Math.ceil(maximum / 4) * 4;
  const intervals = Math.min(4, top);
  const levels = Array.from({ length: intervals + 1 }, (_, i) => (i * top) / intervals);
  const x = (i: number) => (series.length === 1 ? 400 : 64 + (i * 656) / (series.length - 1));
  const y = (value: number) => 152 - (value * 128) / top;
  const day = selected === null ? null : series[selected];
  return (
    <section className="crm-analytics-chart" aria-label={`${title}, UTC`}>
      <h4>{title}</h4>
      <p className="crm-analytics-chart-value" aria-live="polite">
        {day
          ? `${day.date} UTC: ${day[metric]}`
          : 'Наведите курсор или выберите точку клавишей Tab. Точные значения — в таблице ниже.'}
      </p>
      <div
        className="crm-analytics-chart-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${title}: график с прокруткой`}
      >
        <svg role="group" aria-label={`${title} по дням UTC`} viewBox="0 0 760 215">
          {levels.map((value) => (
            <g key={value}>
              <line x1="64" x2="720" y1={y(value)} y2={y(value)} className="crm-analytics-grid" />
              <text x="54" y={y(value) + 4} textAnchor="end">
                {value}
              </text>
            </g>
          ))}
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={series.map((d, i) => `${x(i)},${y(d[metric])}`).join(' ')}
          />
          {series.map((d, i) => (
            <circle
              key={d.date}
              cx={x(i)}
              cy={y(d[metric])}
              r="4"
              tabIndex={0}
              role="img"
              aria-label={`${d.date} UTC: ${d[metric]}`}
              onFocus={() => setSelected(i)}
              onMouseEnter={() => setSelected(i)}
            >
              <title>{`${d.date} UTC: ${d[metric]}`}</title>
            </circle>
          ))}
          {chartTickIndices(series.length).map((i) => (
            <text
              key={i}
              x={x(i)}
              y="181"
              textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
            >
              {series[i]!.date.slice(5).split('-').reverse().join('.')}
            </text>
          ))}
          <text x="64" y="205">
            Даты UTC · {series[0]!.date} — {series.at(-1)!.date}
          </text>
        </svg>
      </div>
      {!series.some((d) => d[metric] > 0) ? (
        <p>За эти дни сохранённые значения равны нулю.</p>
      ) : null}
    </section>
  );
}
function Distribution({
  title,
  groups,
  literal = false,
}: {
  title: string;
  groups?: Record<string, number> | undefined;
  literal?: boolean;
}) {
  return (
    <details className="crm-analytics-distribution">
      <summary>{title}</summary>
      {groups && Object.keys(groups).length ? (
        <dl>
          {Object.entries(groups).map(([key, count]) => (
            <div key={key}>
              <dt>{literal ? key : (labels[key] ?? key)}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Наблюдения отсутствуют.</p>
      )}
    </details>
  );
}
export function CatalogAnalytics({ value: a }: { value: Analytics }) {
  const series = a.daily ?? [];
  const knownSources = Math.max(0, a.accounts + a.students - a.sourceUnknown);
  return (
    <section className="crm-directory-analytics" aria-label="Аналитика выбранных записей">
      <h3>Аналитика выбранных записей</h3>
      <p>
        Период событий и ИИ: {a.periodDays} дней. Аккаунты и ученические места считаются отдельно;
        это не число уникальных людей.
      </p>
      <dl className="crm-analytics-kpis">
        {(
          [
            ['Аккаунты', a.accounts],
            ['Ученические места', a.students],
            ['Сохранённые события', a.activityEvents ?? 'нет данных'],
            ['Обращения к ИИ', a.aiRequests ?? 'недоступно'],
            ['Источник визита известен', knownSources],
            ['Источник визита неизвестен', a.sourceUnknown],
          ] as [string, number | string][]
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <details className="crm-analytics-coverage">
        <summary>Покрытие и точные показатели ИИ</summary>
        <dl className="crm-analytics-facts">
          <div>
            <dt>Записи со связанным профилем</dt>
            <dd>{a.linkedRecords ?? 'недоступно в этой области'}</dd>
          </div>
          <div>
            <dt>Возраст неизвестен или недоступен</dt>
            <dd>{a.ageUnknown}</dd>
          </div>
          <div>
            <dt>Почта отсутствует</dt>
            <dd>{a.emailAbsent}</dd>
          </div>
          <div>
            <dt>Активность наблюдалась</dt>
            <dd>{a.activeObserved}</dd>
          </div>
          <div>
            <dt>Обращения с известными входными и выходными токенами</dt>
            <dd>{a.aiTokenCovered ?? 'недоступно'}</dd>
          </div>
          <div>
            <dt>Известные входные токены</dt>
            <dd>{a.aiInputTokens ?? 'неизвестно'}</dd>
          </div>
          <div>
            <dt>Известные выходные токены</dt>
            <dd>{a.aiOutputTokens ?? 'неизвестно'}</dd>
          </div>
          <div>
            <dt>Прежние обращения без журнала токенов</dt>
            <dd>{a.aiLegacyRequests ?? 'покрытие недоступно'}</dd>
          </div>
        </dl>
        {a.aiCoverage === 'students_only_accounts_unavailable' ? (
          <p>
            ИИ: только разрешённые ученические места. Личная активность ИИ аккаунтов в этой области
            недоступна.
          </p>
        ) : null}
        <p>
          Ноль означает отсутствие сохранённых событий, а не доказанное отсутствие использования.
          Профиль и первый известный источник визита приведены за доступную историю. Страна по IP и
          исторический источник регистрации не сохранялись.
        </p>
      </details>
      <h4>Создание записей и события по дням (UTC)</h4>
      <div className="crm-analytics-charts">
        <DailyChart
          key={`registrations:${series[0]?.date}:${series.at(-1)?.date}`}
          series={series}
          metric="registrations"
          title="Создано аккаунтов и ученических мест"
        />
        <DailyChart
          key={`events:${series[0]?.date}:${series.at(-1)?.date}`}
          series={series}
          metric="events"
          title="Сохранённые события"
        />
      </div>
      {series.length ? (
        <details>
          <summary>Точные значения по дням</summary>
          <div className="crm-analytics-table-scroll">
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
      <div className="crm-analytics-groups">
        <Distribution title="Возможности (могут сочетаться)" groups={a.roles} />
        <Distribution title="Возрастные группы" groups={a.ageGroups} />
        <Distribution title="Устройства последнего наблюдения" groups={a.devices} />
        <Distribution title="Способы зафиксированных входов за период" groups={a.loginMethods} />
        {a.registrationMethods ? (
          <Distribution
            title="Способы зафиксированных регистраций Account за период"
            groups={a.registrationMethods}
          />
        ) : (
          <details className="crm-analytics-distribution">
            <summary>Способы зафиксированных регистраций Account за период</summary>
            <p>Сведения недоступны в этой версии сервера.</p>
          </details>
        )}
        <Distribution title="События по рабочим средам за период" groups={a.tools} />
        <Distribution title="Источники первых известных визитов" groups={a.referrers} />
      </div>
      <details className="crm-analytics-coverage">
        <summary>Наблюдения источников и кампаний</summary>
        {a.acquisition ? (
          <>
            <p>
              Поддерживается сбор меток текущего документа после входа. Сохранено наблюдений:{' '}
              {a.acquisition.observations}; записей с наблюдениями: {a.acquisition.observedRecords};
              без доступных наблюдений: {a.acquisition.unknownRecords}.
            </p>
            <p>
              Хранение: {a.acquisition.retentionDays} дней. Сводка — за выбранный период. Старые и
              отсутствующие наблюдения остаются неизвестными. Собираются только разрешённые метки
              source, medium и campaign; полные адреса страниц не сохраняются.
            </p>
            <div className="crm-analytics-groups">
              <Distribution
                literal
                title="Заявленные источники (source)"
                groups={a.acquisition.sources}
              />
              <Distribution
                literal
                title="Заявленные каналы (medium)"
                groups={a.acquisition.mediums}
              />
              <Distribution
                title="Заявленные кампании (campaign)"
                groups={a.acquisition.campaigns}
                literal
              />
            </div>
          </>
        ) : (
          <p>Сведения о сборе кампаний недоступны в этой версии сервера.</p>
        )}
        <p>
          Источник первого визита и метки кампаний — заявления браузера, а не доказанный источник
          регистрации. Фактические способы входа показаны отдельно. Историческая атрибуция не
          восстанавливается; топ источников и рабочих сред ограничен 30 группами.
        </p>
      </details>
    </section>
  );
}
