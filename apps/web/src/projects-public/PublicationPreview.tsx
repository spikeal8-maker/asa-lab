import { useState } from 'react';
import type { PublicProject } from './api';

export function PublicationPreview({
  publication,
  detail = false,
}: {
  readonly publication: PublicProject;
  readonly detail?: boolean;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  const preview = publication.preview;
  return (
    <div className={`publication-preview${detail ? ' is-detail' : ''}`}>
      {preview && !failed ? (
        <img
          data-testid={detail ? 'public-project-preview' : 'public-project-card-preview'}
          src={preview.url}
          width={preview.width}
          height={preview.height}
          alt={detail ? `Опубликованное изображение проекта «${publication.title}»` : ''}
          loading={detail ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <p className="publication-preview-missing" data-testid="public-project-preview-unavailable">
          {failed ? 'Изображение не загрузилось' : 'Предпросмотр недоступен'}
          {detail ? <span>Обновите страницу проекта, чтобы проверить публикацию.</span> : null}
        </p>
      )}
    </div>
  );
}
