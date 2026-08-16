import { loadEditorChunk } from '../modules/lazy-editor';

/**
 * Chess was the last subject module still imported eagerly, which put its whole
 * experience — board, analysis, puzzles, live play — into the bundle every
 * visitor downloads, including one who only ever opens a circuit.
 */
export async function loadChessEditor() {
  return loadEditorChunk({
    reloadMarker: 'asa-chess:lazy-reload',
    exhaustedMessage: 'Не удалось загрузить обновлённый модуль шахмат.',
    unavailableMessage: 'Не удалось безопасно перезапустить загрузку модуля шахмат.',
    load: async () => {
      const module = await import('./ChessModuleExperience');
      return { default: module.ChessModuleExperience };
    },
  });
}
