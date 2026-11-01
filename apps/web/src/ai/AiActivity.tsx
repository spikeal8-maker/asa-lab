import {
  AI_TOOL_ACTIVITY_LABELS,
  aiImageDimensions,
  type AiChatTool,
  type AiImageStoredSize,
} from '@asa-lab/contracts';

export function AiActivity({
  image = false,
  responding = false,
  tool,
  imageSize,
}: {
  image?: boolean;
  responding?: boolean;
  tool?: AiChatTool | undefined;
  imageSize?: AiImageStoredSize | undefined;
}): JSX.Element {
  const dimensions = image ? aiImageDimensions(imageSize ?? 1024) : null;
  return (
    <div className={`ai-activity${image ? ' ai-activity-image' : ''}`} role="status">
      {image ? (
        <div
          className="ai-activity-canvas"
          style={{ aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : '1' }}
          aria-hidden="true"
        >
          <span className="ai-activity-orb ai-activity-orb-one" />
          <span className="ai-activity-orb ai-activity-orb-two" />
          <span className="ai-activity-orb ai-activity-orb-three" />
          <svg
            className="ai-activity-image-icon"
            width="42"
            height="42"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <circle cx="8" cy="8" r="1.5" />
            <path d="m3 16 5-5 4 4 3-3 6 6" />
          </svg>
        </div>
      ) : null}
      <div className="ai-activity-caption">
        <span className="ai-activity-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          {image
            ? 'Создаю изображение…'
            : tool
              ? AI_TOOL_ACTIVITY_LABELS[tool]
              : responding
                ? 'Отвечаю…'
                : 'Обдумываю ответ…'}
        </span>
      </div>
    </div>
  );
}
