import { isRecoverableChunkError, loadEditorChunk } from '../modules/lazy-editor';

/** Kept as the checkers-facing name; the behaviour is shared across editors. */
export const isRecoverableCheckersChunkError = isRecoverableChunkError;

export async function loadCheckersEditor() {
  return loadEditorChunk({
    reloadMarker: 'asa-checkers:lazy-reload',
    exhaustedMessage: 'Не удалось загрузить обновлённый модуль шашек.',
    unavailableMessage: 'Не удалось безопасно перезапустить загрузку модуля шашек.',
    load: async () => {
      const module = await import('./CheckersModuleExperience');
      return { default: module.CheckersModuleExperience };
    },
  });
}
