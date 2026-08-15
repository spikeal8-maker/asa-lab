import { loadEditorChunk } from '../modules/lazy-editor';

/**
 * The owner component catalog is nearly a megabyte and only the Electronics
 * workbench reads it. It used to be fetched before the application rendered at
 * all, which made every visitor — including one signing in to play chess — wait
 * for it. It is fetched here instead, alongside the editor chunk that needs it,
 * so the catalog is on the path of the people who actually open a circuit.
 */
export async function loadSchematicEditor() {
  return loadEditorChunk({
    reloadMarker: 'asa-electronics:lazy-reload',
    exhaustedMessage: 'Не удалось загрузить обновлённый редактор электроники.',
    unavailableMessage: 'Не удалось безопасно перезапустить загрузку редактора электроники.',
    load: async () => {
      const [{ SchematicEditor }, { loadProductionLibrary }] = await Promise.all([
        import('../pages/SchematicEditor'),
        import('./production-manifest-adapter'),
      ]);
      // The workbench renders from the catalog, so it must be in place before
      // the editor mounts — not fetched during the first paint of the canvas.
      await loadProductionLibrary();
      return { default: SchematicEditor };
    },
  });
}
