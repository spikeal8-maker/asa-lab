import { useState } from 'react';
import type { PublicProject } from './api';
export function PublicAuthorAvatar({
  publication,
  detail = false,
}: {
  readonly publication: PublicProject;
  readonly detail?: boolean;
}): JSX.Element {
  const url =
    publication.authorAvatarUrl ===
    `/api/public-projects/${encodeURIComponent(publication.publicationId)}/author-avatar`
      ? publication.authorAvatarUrl
      : null;
  const [failed, setFailed] = useState<string | null>(null);
  const initials =
    publication.authorLabel
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toLocaleUpperCase('ru') || '?';
  return (
    <span
      className={detail ? 'public-project-detail-avatar' : 'public-project-avatar'}
      aria-hidden="true"
    >
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          width={detail ? 40 : 24}
          height={detail ? 40 : 24}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
