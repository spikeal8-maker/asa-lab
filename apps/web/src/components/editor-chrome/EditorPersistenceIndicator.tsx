import { useEffect, useRef, useState } from 'react';

export type EditorPersistenceStatus = 'saved' | 'dirty' | 'saving' | 'error';
export type EditorPersistenceIssue = 'conflict' | 'offline' | 'auth' | 'server' | 'local-only';

export interface EditorPersistencePresentation {
  readonly label: string;
  readonly detail: string;
}

export const EDITOR_PERSISTENCE_TIMING = {
  pendingDelayMs: 900,
  savedVisibilityMs: 1_400,
} as const;

export function editorPersistencePresentation(
  status: Exclude<EditorPersistenceStatus, 'dirty'>,
  issue: EditorPersistenceIssue | null,
  localCopySaved = false,
): EditorPersistencePresentation {
  if (status === 'saving') {
    return { label: 'Сохраняем…', detail: 'Изменения проекта отправляются на сервер.' };
  }
  if (status === 'saved') {
    return { label: 'Сохранено', detail: 'Изменения проекта сохранены.' };
  }
  if (issue === 'offline') {
    return {
      label: 'Нет связи',
      detail: localCopySaved
        ? 'Последние изменения сохранены в браузере. Повторим отправку после восстановления связи.'
        : 'Последние изменения только в открытом редакторе. Получите аварийную копию перед закрытием.',
    };
  }
  if (issue === 'auth') {
    return {
      label: 'Нужно войти',
      detail: localCopySaved
        ? 'Последние изменения сохранены в браузере. Войдите тем же пользователем для сохранения на сервере.'
        : 'Последние изменения только в открытом редакторе. Получите аварийную копию перед повторным входом.',
    };
  }
  if (issue === 'conflict') {
    return {
      label: 'Не удалось сохранить',
      detail: localCopySaved
        ? 'Последние изменения сохранены в браузере. Сервер содержит другую версию; автоматическая отправка остановлена.'
        : 'Сервер содержит другую версию. Последние изменения только в открытом редакторе; получите аварийную копию.',
    };
  }
  return {
    label: 'Не удалось сохранить',
    detail: localCopySaved
      ? 'Последние изменения сохранены в браузере. Серверное сохранение ещё не подтверждено.'
      : 'Последние изменения только в открытом редакторе. Получите аварийную копию перед закрытием.',
  };
}

export function EditorPersistenceIndicator({
  status,
  issue,
  className,
  localCopySaved = false,
}: {
  readonly status: EditorPersistenceStatus;
  readonly issue: EditorPersistenceIssue | null;
  readonly className: string;
  readonly localCopySaved?: boolean;
}): JSX.Element {
  const [visibleStatus, setVisibleStatus] = useState<'saved' | 'saving' | 'error' | null>(
    status === 'error' ? 'error' : null,
  );
  const visibleStatusRef = useRef(visibleStatus);

  useEffect(() => {
    let timer: number | null = null;
    const show = (next: 'saved' | 'saving' | 'error' | null): void => {
      visibleStatusRef.current = next;
      setVisibleStatus(next);
    };
    if (status === 'error') {
      show('error');
    } else if (status === 'dirty' || status === 'saving') {
      if (visibleStatusRef.current !== 'saving') {
        timer = window.setTimeout(() => show('saving'), EDITOR_PERSISTENCE_TIMING.pendingDelayMs);
      }
    } else if (visibleStatusRef.current === 'saving') {
      show('saved');
      timer = window.setTimeout(() => show(null), EDITOR_PERSISTENCE_TIMING.savedVisibilityMs);
    } else {
      show(null);
    }
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [status]);

  const presentation = visibleStatus
    ? editorPersistencePresentation(visibleStatus, issue, localCopySaved)
    : null;

  return (
    <span
      className={`${className}${visibleStatus ? ` ${visibleStatus}` : ' quiet'}`}
      data-persistence-status={visibleStatus ?? 'quiet'}
      title={presentation?.detail}
      role="status"
      aria-live="polite"
      aria-hidden={presentation ? undefined : true}
    >
      {visibleStatus === 'saved' ? (
        <span className="editor-persistence-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
      {presentation?.label ?? ''}
    </span>
  );
}
