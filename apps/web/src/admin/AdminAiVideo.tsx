import './ai-media-admin.css';
import { AdminPolzaCatalog } from './AdminPolzaCatalog';

export function AdminAiVideo({
  connected,
  onAccessDenied,
}: {
  connected: boolean;
  onAccessDenied: () => void;
}) {
  return (
    <section className="asa-ai-integration-panel" aria-label="Настройки видео">
      <header className="asa-ai-integration-header">
        <div>
          <h2>Видео</h2>
          <p>Каталог моделей видеогенерации Polza AI.</p>
        </div>
      </header>
      <p className="asa-ai-integration-note" role="status">
        Запуск генерации видео из ASA Lab пока недоступен.
      </p>
      <AdminPolzaCatalog kind="video" connected={connected} onAccessDenied={onAccessDenied} />
    </section>
  );
}
