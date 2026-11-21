import { useId, useState } from 'react';

/** Keep unusually long names readable without pushing the project off screen. */
export function PublicProjectTitle({ title }: { readonly title: string }): JSX.Element {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const long = title.length > 80;
  return (
    <div className="public-project-title-group">
      <h1
        id={id}
        data-testid="public-project-title"
        className={long && !expanded ? 'is-collapsed' : undefined}
      >
        {title}
      </h1>
      {long ? (
        <button
          type="button"
          className="public-project-title-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Свернуть название' : 'Название целиком'}
        </button>
      ) : null}
    </div>
  );
}
