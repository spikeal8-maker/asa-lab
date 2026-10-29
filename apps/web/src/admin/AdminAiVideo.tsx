import './ai-media-admin.css';

export function AdminAiVideo() {
  return (
    <section className="asa-ai-integration-panel" aria-label="Настройки видео">
      <header className="asa-ai-integration-header">
        <div>
          <h2>Видео</h2>
          <p>Отдельный раздел будущей генерации и обработки видео.</p>
        </div>
        <span className="asa-ai-integration-state">Планируется</span>
      </header>
      <p className="asa-ai-integration-note" role="status">
        Генерация видео пока не подключена. Действующие настройки изображений не изменены.
      </p>
    </section>
  );
}
