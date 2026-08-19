import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { AssignmentGoal, BriefText } from './BriefText';
import './assignment-view.css';

/**
 * Задание, как его читают.
 *
 * Один вид на весь продукт: у ученика на главной, у ученика поверх редактора, у
 * преподавателя в классе и рядом с проверяемой работой. Раньше каждое из этих
 * мест верстало задание само, и в одном из них оно расползалось по экрану, в
 * другом — не показывалось вовсе. Задание — это одна вещь, и выглядеть она
 * должна одинаково, где бы её ни открыли.
 *
 * Порядок ровно такой: зачем это делаем, что должно получиться, что делать.
 * Картинка кликается и раскрывается на весь экран — на телефоне разглядеть
 * образец в колонке невозможно.
 */

export interface AssignmentViewData {
  readonly title: string;
  readonly goal: string | null;
  readonly brief: string | null;
  readonly sampleImage: string | null;
}

/** Картинка во весь экран. Закрывается щелчком и Esc — как любое окно. */
function Lightbox({
  src,
  alt,
  onClose,
}: {
  readonly src: string;
  readonly alt: string;
  readonly onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="assignment-lightbox" role="dialog" aria-modal="true" aria-label={alt}>
      <button type="button" className="assignment-lightbox-close" onClick={onClose}>
        Закрыть
      </button>
      <img src={src} alt={alt} onClick={onClose} />
    </div>
  );
}

export function AssignmentView({
  assignment,
  compact = false,
  aside,
}: {
  readonly assignment: AssignmentViewData;
  /** В узкой колонке образец и текст идут друг под другом. */
  readonly compact?: boolean;
  /** Что показать рядом с заданием: работу ученика, отклик, кнопки. */
  readonly aside?: ReactNode;
}): JSX.Element {
  const [zoomed, setZoomed] = useState(false);

  return (
    <div className={`assignment-view${compact ? ' is-compact' : ''}`} data-testid="assignment-view">
      <div className="assignment-view-main">
        <AssignmentGoal goal={assignment.goal} />
        {assignment.brief ? (
          <BriefText text={assignment.brief} />
        ) : (
          <p className="account-hint">Преподаватель объяснит задание на уроке.</p>
        )}
      </div>

      {assignment.sampleImage || aside ? (
        <div className="assignment-view-aside">
          {assignment.sampleImage ? (
            <figure className="assignment-view-sample">
              {/* Образец нажимается: в колонке он маленький, а разглядеть надо
                  именно его — это половина задания. */}
              <button
                type="button"
                onClick={() => setZoomed(true)}
                aria-label={`Открыть образец: ${assignment.title}`}
              >
                <img src={assignment.sampleImage} alt={`Образец: ${assignment.title}`} />
              </button>
              <figcaption>Что должно получиться · нажмите, чтобы рассмотреть</figcaption>
            </figure>
          ) : null}
          {aside}
        </div>
      ) : null}

      {zoomed && assignment.sampleImage ? (
        <Lightbox
          src={assignment.sampleImage}
          alt={`Образец: ${assignment.title}`}
          onClose={() => setZoomed(false)}
        />
      ) : null}
    </div>
  );
}
