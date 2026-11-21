import { useState } from 'react';
import type { PublicProject } from './api';
import { ThreeDHoverPreview } from '../three-d/ThreeDHoverPreview';

export function PublicationPreview({
  publication,
  detail = false,
}: {
  readonly publication: PublicProject;
  readonly detail?: boolean;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  const preview = publication.preview;
  const content =
    preview && !failed ? (
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
      </p>
    );
  return (
    <div
      className={`publication-preview${detail ? ' is-detail' : ''}`}
      data-module={publication.moduleKey}
    >
      {publication.moduleKey === 'three-d' && !detail ? (
        <ThreeDHoverPreview
          source={{
            kind: 'publication',
            id: publication.publicationId,
            revisionId: publication.revisionId,
            revisionNo: publication.revisionNo,
          }}
        >
          {content}
        </ThreeDHoverPreview>
      ) : (
        content
      )}
    </div>
  );
}
