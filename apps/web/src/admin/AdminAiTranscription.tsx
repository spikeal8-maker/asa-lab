import './ai-media-admin.css';

/** Administrative entry point for a future authenticated speech-to-text pipeline. */
export function AdminAiTranscription() {
  return (
    <section className="asa-ai-integration-panel" aria-label="Настройки транскрибации">
      <header className="asa-ai-integration-header">
        <div>
          <h2>Транскрибация</h2>
          <p>Преобразование речи в текст для микрофона в AI-чате.</p>
        </div>
        <span className="asa-ai-integration-state">Не настроена</span>
      </header>
      <div className="asa-ai-integration-grid">
        <div>
          <h3>Планируемое подключение</h3>
          <dl className="asa-ai-integration-facts">
            <div><dt>Провайдер</dt><dd>Polza AI</dd></div>
            <div><dt>Русский язык</dt><dd>GigaAM-v3</dd></div>
            <div><dt>Другие языки</dt><dd>Многоязычная модель — после сравнения качества</dd></div>
            <div><dt>Результат</dt><dd>Текст в поле ввода чата, без автоотправки</dd></div>
          </dl>
        </div>
        <div>
          <h3>Перед включением</h3>
          <ul className="asa-ai-integration-features">
            <li>Сохранить API-ключ на сервере в зашифрованном виде</li>
            <li>Ввести лимиты времени, размера файла, частоты и расходов</li>
            <li>Обеспечить проверку прав, удаление временного аудио и отмену записи</li>
            <li>Проверить качество русской речи и одновременно 30 запросов</li>
          </ul>
        </div>
      </div>
      <p className="asa-ai-integration-note" role="status">
        Раздел подготовлен. Загрузка аудио и расшифровка ещё не доступны:
        здесь не выполняются платные запросы и не сохраняются записи.
      </p>
    </section>
  );
}
