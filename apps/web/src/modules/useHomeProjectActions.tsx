import { useEffect, useRef, useState } from 'react';
import { api, type Project } from '../api';
import { newClientId } from '../client-id';
import { ProjectProperties } from '../components/ProjectProperties';
import { ProjectHistoryDialog } from '../components/ProjectHistoryDialog';
import { CollectPicker } from '../components/CollectPicker';
import type { ProjectCardMenuItem } from './ProjectCard';

/** Home uses the same API commands and dialogs as the personal project list. */
export function useHomeProjectActions(onChanged: () => void) {
  const [properties, setProperties] = useState<Project | null>(null);
  const [section, setSection] = useState<'properties' | 'publication'>('properties');
  const [history, setHistory] = useState<Project | null>(null);
  const [collecting, setCollecting] = useState<Project | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const duplicateKeys = useRef(new Map<string, string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function mutate(project: Project, action: 'duplicate' | 'archived' | 'trashed') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(project.id);
    setError(null);
    try {
      const key = duplicateKeys.current.get(project.id) ?? newClientId();
      if (action === 'duplicate') duplicateKeys.current.set(project.id, key);
      const result =
        action === 'duplicate'
          ? await api.duplicateProject(project.id, `${project.title} — копия`, key)
          : await api.changeProjectStatus(project.id, action);
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.error.message || 'Не удалось выполнить действие.');
        return;
      }
      if (action === 'duplicate') duplicateKeys.current.delete(project.id);
      onChanged();
    } catch {
      if (mounted.current) setError('Не удалось выполнить действие. Проверьте соединение.');
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  function menuItems(project: Project): ProjectCardMenuItem[] {
    const learning = project.isLearningWork === true;
    const allowed = project.learningWork?.allowedActions;
    const disabled = busy !== null;
    return [
      ...(!learning || allowed?.editProperties
        ? [
            {
              label: 'Свойства',
              disabled,
              onSelect: () => {
                setSection('properties');
                setProperties(project);
              },
            },
          ]
        : []),
      ...(!learning
        ? [
            {
              label: 'Публикация',
              disabled,
              onSelect: () => {
                setSection('publication');
                setProperties(project);
              },
            },
          ]
        : []),
      ...(!learning || allowed?.duplicate
        ? [{ label: 'Дублировать', disabled, onSelect: () => void mutate(project, 'duplicate') }]
        : []),
      { label: 'Журнал версий', onSelect: () => setHistory(project) },
      ...(!learning
        ? [{ label: 'Добавить в коллекцию', onSelect: () => setCollecting(project) }]
        : []),
      ...(!learning || allowed?.changeGenericProjectStatus
        ? [
            { label: 'Архивировать', disabled, onSelect: () => void mutate(project, 'archived') },
            {
              label: 'В корзину',
              danger: true,
              disabled,
              onSelect: () => void mutate(project, 'trashed'),
            },
          ]
        : []),
    ];
  }
  const dialogs = (
    <>
      {error ? (
        <p role="alert" className="notice-error">
          {error}
        </p>
      ) : null}
      {properties ? (
        <ProjectProperties
          project={properties}
          initialSection={section}
          onClose={() => setProperties(null)}
          onSaved={() => {
            setProperties(null);
            onChanged();
          }}
        />
      ) : null}
      {history ? (
        <ProjectHistoryDialog
          projectId={history.id}
          title={history.title}
          onClose={() => setHistory(null)}
        />
      ) : null}
      {collecting ? (
        <CollectPicker
          projectId={collecting.id}
          title={collecting.title}
          onClose={() => setCollecting(null)}
        />
      ) : null}
    </>
  );
  return { menuItems, dialogs };
}
