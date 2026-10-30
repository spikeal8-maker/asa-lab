export function AiActivity({
  image = false,
  responding = false,
}: {
  image?: boolean;
  responding?: boolean;
}): JSX.Element {
  return (
    <div className={`ai-activity${image ? ' ai-activity-image' : ''}`} role="status">
      {image ? <div className="ai-activity-canvas" aria-hidden="true" /> : null}
      <div className="ai-activity-caption">
        <span className="ai-activity-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{image ? 'Создаю изображение…' : responding ? 'Отвечаю…' : 'Обдумываю ответ…'}</span>
      </div>
    </div>
  );
}
