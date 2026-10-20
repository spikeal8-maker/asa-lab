import type { PublishedAuthorVersion } from '../api';
import {
  courseVersionChanges,
  courseVersionStructuralDiff,
  courseVersionValueText,
} from './course-version-diff';
import './course-version-comparison.css';

const actionNames = {
  added: 'Добавлено',
  removed: 'Удалено',
  moved: 'Перемещено',
  changed: 'Изменено',
  unavailable: 'Нельзя точно сравнить',
};

export function CourseVersionComparison({
  before,
  after,
}: {
  before: PublishedAuthorVersion;
  after: PublishedAuthorVersion;
}) {
  const changes = courseVersionChanges(before, after);
  const categories = courseVersionStructuralDiff(before, after);
  return (
    <section className="course-version-comparison" aria-label="Изменения между версиями">
      <h4>
        Версия {before.versionNumber} → версия {after.versionNumber}
      </h4>
      <p data-testid="version-structural-diff">
        {changes.length ? 'Изменено: ' + categories.join(', ') : 'Структурных изменений нет.'}
      </p>
      {changes.some((change) => change.kind === 'unavailable') ? (
        <p role="status">
          Сравнение неполное: часть исторических данных недоступна. Текущие условия заданий не
          подставляются.
        </p>
      ) : null}
      {changes.length ? (
        <ol className="course-version-comparison-list">
          {changes.map((change, index) => (
            <li
              key={index}
              data-testid="version-change"
              data-change-kind={change.kind}
              data-change-category={change.category}
            >
              <p className="course-version-comparison-path">{change.path}</p>
              <h5>
                {actionNames[change.kind]} · {change.field}
              </h5>
              <dl className="course-version-comparison-values">
                <div>
                  <dt>Было · версия {before.versionNumber}</dt>
                  <dd>{courseVersionValueText(change.before, change.field)}</dd>
                </div>
                <div>
                  <dt>Стало · версия {after.versionNumber}</dt>
                  <dd>{courseVersionValueText(change.after, change.field)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
