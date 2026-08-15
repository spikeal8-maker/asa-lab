import { useEffect, useState } from 'react';
import { api, type ClassroomTeacherInvitationPreview } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import { ClassesIcon } from '../electronics/workbench-icons';

type InviteState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; invitation: ClassroomTeacherInvitationPreview };

export function TeacherInvitePage({
  token,
  authenticated,
  onSignIn,
  onRegister,
  onAccepted,
  onBack,
  onOpenProfile,
}: {
  token: string;
  authenticated: boolean;
  onSignIn?: () => void;
  onRegister?: () => void;
  onAccepted?: (classroom: { id: string; title: string }) => void;
  onBack: () => void;
  onOpenProfile?: () => void;
}): JSX.Element {
  const [state, setState] = useState<InviteState>({ kind: 'loading' });
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    void api.resolveClassroomTeacherInvitation(token).then((result) => {
      if (!active) return;
      if (result.ok) setState({ kind: 'ready', invitation: result.data.invitation });
      else {
        setState({
          kind: 'error',
          message: result.error.message || 'Не удалось открыть приглашение.',
        });
      }
    });
    return () => {
      active = false;
    };
  }, [token]);

  const content = (
    <section className="teacher-invite-card" aria-labelledby="teacher-invite-title">
      {!authenticated ? (
        <div className="teacher-invite-brand">
          <AsaLabWordmark />
        </div>
      ) : null}

      {state.kind === 'loading' ? (
        <div className="teacher-invite-status" role="status">
          Проверяем приглашение…
        </div>
      ) : null}

      {state.kind === 'error' ? (
        <div className="teacher-invite-status" role="alert">
          <span className="teacher-invite-icon expired">
            <ClassesIcon />
          </span>
          <h1 id="teacher-invite-title">Приглашение недоступно</h1>
          <p>{state.message}</p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            {authenticated ? 'Вернуться к классам' : 'На главную'}
          </button>
        </div>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <span className="teacher-invite-icon">
            <ClassesIcon />
          </span>
          <p className="portal-eyebrow">Приглашение преподавателя</p>
          <h1 id="teacher-invite-title">Вести класс вместе</h1>
          <p className="teacher-invite-lead">
            <strong>{state.invitation.ownerDisplayName}</strong> приглашает вас стать
            коллегой-преподавателем в классе.
          </p>
          <div className="teacher-invite-class">
            <span>Класс</span>
            <strong>{state.invitation.classroomTitle}</strong>
            <small>Вы сможете работать с учениками, безопасным режимом и проектами класса.</small>
          </div>

          {state.invitation.status !== 'pending' ? (
            <div className="teacher-invite-actions">
              <p className="notice-error" role="alert">
                {state.invitation.status === 'accepted'
                  ? 'Это приглашение уже принято.'
                  : 'Срок действия приглашения истёк или владелец его отозвал.'}
              </p>
              <button type="button" className="btn-secondary" onClick={onBack}>
                {authenticated ? 'Вернуться к классам' : 'На главную'}
              </button>
            </div>
          ) : authenticated ? (
            <div className="teacher-invite-actions">
              {acceptError ? (
                <p className="notice-error" role="alert">
                  {acceptError}
                </p>
              ) : null}
              <button
                type="button"
                className="portal-create-button"
                disabled={accepting}
                onClick={async () => {
                  setAccepting(true);
                  setAcceptError(null);
                  const result = await api.acceptClassroomTeacherInvitation(token);
                  setAccepting(false);
                  if (result.ok) {
                    onAccepted?.({
                      id: result.data.classroom.id,
                      title: result.data.classroom.title,
                    });
                    return;
                  }
                  setAcceptError(result.error.message || 'Не удалось принять приглашение.');
                }}
              >
                {accepting ? 'Добавляем в класс…' : 'Принять приглашение'}
              </button>
              <button type="button" className="btn-ghost" onClick={onBack}>
                Не сейчас
              </button>
              {acceptError && onOpenProfile ? (
                <button type="button" className="btn-secondary" onClick={onOpenProfile}>
                  Проверить роль в профиле
                </button>
              ) : null}
            </div>
          ) : (
            <div className="teacher-invite-actions">
              <p>Войдите как педагог или создайте аккаунт, чтобы принять приглашение.</p>
              <button type="button" className="portal-create-button" onClick={onSignIn}>
                Войти и продолжить
              </button>
              <button type="button" className="btn-secondary" onClick={onRegister}>
                Создать аккаунт
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );

  return authenticated ? (
    <main id="main-content" className="portal-content teacher-invite-portal" tabIndex={-1}>
      {content}
    </main>
  ) : (
    <main className="page-center teacher-invite-page">{content}</main>
  );
}
