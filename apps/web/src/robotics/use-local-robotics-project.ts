import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { ElectronicsWorkbenchProjectHost } from '../electronics/use-electronics-workbench';
import type { SaveStatus } from '../electronics/workbench-model';
import { parseRoboticsProject, type RoboticsProject } from './robotics-project';
import { useRoboticsSource, type RoboticsProjectController } from './use-robotics-project';

export const ROBOTICS_LOCAL_PROJECT_KEY = 'asa-lab:robotics:local-project:v1';
const messageOf = (reason: unknown): string =>
  reason instanceof Error ? reason.message : 'Хранилище браузера недоступно.';

function readLocalProject(initial: RoboticsProject) {
  try {
    const raw = window.localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY);
    if (!raw) return { project: initial, saved: false, notice: null };
    const parsed = parseRoboticsProject(JSON.parse(raw));
    if (!parsed.ok)
      return { project: initial, saved: false, notice: `Сохранение не открыто: ${parsed.message}` };
    return { project: parsed.project, saved: true, notice: null };
  } catch (reason) {
    return {
      project: initial,
      saved: false,
      notice: `Не удалось прочитать локальное сохранение. ${messageOf(reason)}`,
    };
  }
}

/** The standalone M1 adapter. The account editor never mounts or reads it. */
export function useLocalRoboticsProject(
  initialProject: RoboticsProject,
  beforeHistoryChange?: () => void,
) {
  const [opening] = useState(() => readLocalProject(initialProject));
  const savedBytesRef = useRef<string | null>(
    opening.saved ? JSON.stringify(opening.project) : null,
  );
  const [hasSavedProject, setHasSavedProject] = useState(opening.saved);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(opening.saved ? 'saved' : 'dirty');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveFailedRef = useRef(false);
  const source = useRoboticsSource(opening.project, {
    beforeHistoryChange,
    onChange: (next) =>
      setSaveStatus(
        saveFailedRef.current
          ? 'error'
          : JSON.stringify(next) === savedBytesRef.current
            ? 'saved'
            : 'dirty',
      ),
  });
  const { getCurrentProject, publish, replaceDocument } = source;
  const { setNotice } = source.workbench;
  useEffect(() => {
    if (opening.notice) setNotice(opening.notice);
  }, [opening.notice, setNotice]);
  const hasUnsavedChanges = useCallback(
    () => JSON.stringify(getCurrentProject()) !== savedBytesRef.current,
    [getCurrentProject],
  );
  const saveNow = useCallback(async (): Promise<void> => {
    source.flushProgram();
    try {
      const bytes = JSON.stringify(getCurrentProject());
      window.localStorage.setItem(ROBOTICS_LOCAL_PROJECT_KEY, bytes);
      if (window.localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY) !== bytes)
        throw new Error('Браузер не подтвердил сохранение.');
      savedBytesRef.current = bytes;
      saveFailedRef.current = false;
      setHasSavedProject(true);
      setSaveError(null);
      setSaveStatus('saved');
      setNotice('Проект сохранён в этом браузере на этом устройстве.');
    } catch (reason) {
      const message = `Не удалось сохранить проект. ${messageOf(reason)}`;
      saveFailedRef.current = true;
      setSaveStatus('error');
      setSaveError(message);
      setNotice(message);
    }
  }, [getCurrentProject, setNotice, source.flushProgram]);
  const openSavedProject = useCallback((): boolean => {
    if (source.workbench.simulationRunning) {
      setNotice('Остановите моделирование перед открытием проекта.');
      return false;
    }
    try {
      const raw = window.localStorage.getItem(ROBOTICS_LOCAL_PROJECT_KEY);
      if (!raw) {
        setHasSavedProject(false);
        setNotice('В этом браузере пока нет сохранённого проекта.');
        return false;
      }
      const parsed = parseRoboticsProject(JSON.parse(raw));
      if (!parsed.ok) {
        setNotice(`Сохранение не открыто: ${parsed.message}`);
        return false;
      }
      replaceDocument(parsed.project);
      savedBytesRef.current = JSON.stringify(parsed.project);
      saveFailedRef.current = false;
      setHasSavedProject(true);
      setSaveStatus('saved');
      setSaveError(null);
      setNotice('Открыт проект, сохранённый на этом устройстве.');
      return true;
    } catch (reason) {
      setNotice(`Не удалось открыть сохранение. ${messageOf(reason)}`);
      return false;
    }
  }, [replaceDocument, setNotice, source.workbench.simulationRunning]);
  const setProjectTitle = useCallback(
    (update: SetStateAction<string>): void => {
      const current = getCurrentProject();
      publish({ ...current, title: typeof update === 'function' ? update(current.title) : update });
    },
    [getCurrentProject, publish],
  );
  const renameProject = useCallback(async (): Promise<void> => {
    const current = getCurrentProject();
    publish({ ...current, title: current.title.trim() || 'Мой робот' });
  }, [getCurrentProject, publish]);
  const host: ElectronicsWorkbenchProjectHost = {
    ...source.workbench,
    project: null,
    serverRevision: null,
    result: null,
    versions: [],
    status: 'ready',
    saveStatus,
    saveError,
    saveIssue: null,
    localCopySaved: saveStatus === 'saved',
    exportEmergencyCopy: () =>
      setNotice('Скачивание проекта недоступно. Используйте «Сохранить» на этом устройстве.'),
    saveBeforeLeave: saveNow,
    busy: false,
    projectTitle: source.robotProject.title,
    setProjectTitle,
    saveNow,
    checkpoint: saveNow,
    renameProject,
  };
  return {
    ...source,
    host,
    hasUnsavedChanges,
    hasSavedProject,
    openSavedProject,
  } satisfies RoboticsProjectController;
}
