import './ai-media-admin.css';

/** Discovery-only admin surface; the closed SQL provider catalog has no Polza credential slot yet. */
export function AdminPolzaConnection() {
  return (
    <section className="asa-ai-integration-panel" aria-label="Подключение Polza AI">
      <header className="asa-ai-integration-header">
        <div>
          <h2>Polza AI</h2>
          <p>Один API для текста, изображений и распознавания речи.</p>
        </div>
        <span className="asa-ai-integration-state">Не подключено</span>
      </header>
      <div className="asa-ai-integration-grid">
        <div>
          <h3>Подключение</h3>
          <dl className="asa-ai-integration-facts">
            <div><dt>API</dt><dd>polza.ai/api/v1</dd></div>
            <div><dt>Ключ</dt><dd>Нет защищённого подключения в ASA Lab</dd></div>
          </dl>
          <a
            href="https://polza.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="asa-ai-integration-link"
          >
            Получить API-ключ Polza AI
          </a>
        </div>
        <div>
          <h3>Планируемые направления</h3>
          <ul className="asa-ai-integration-features">
            <li>Текст — модели из каталога Polza AI</li>
            <li>Изображения — отдельная политика генерации и расходов</li>
            <li>Транскрибация — русская речь, модель GigaAM-v3</li>
          </ul>
        </div>
      </div>
      <p className="asa-ai-integration-note" role="status">
        Страница добавлена. Сохранение API-ключа и реальные запросы пока не реализованы:
        для них требуется отдельный защищённый серверный адаптер с шифрованием,
        правами администратора и лимитами расходов. Существующие подключения не изменены.
      </p>
    </section>
  );
}
