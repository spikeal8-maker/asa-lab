import {
  AI_TOOL_ACTIVITY_LABELS,
  aiImageDimensions,
  type AiChatTool,
  type AiToolActivity,
  type AiImageStoredSize,
} from '@asa-lab/contracts';
import { AiChatIcon, type AiChatIconName } from './AiChatIcon';

const TOOL_ICONS: Record<AiChatTool, AiChatIconName> = {
  web_search: 'search',
  image_search: 'image',
  weather: 'sun',
  read_page: 'file',
  generate_image: 'sparkles',
  create_working_file: 'file',
  read_working_file: 'file',
  edit_working_file: 'edit',
};
const TOOL_NAMES: Record<AiChatTool, string> = {
  web_search: 'Поиск в интернете',
  image_search: 'Поиск изображений',
  weather: 'Проверка погоды',
  read_page: 'Чтение страниц',
  generate_image: 'Подготовка изображения',
  create_working_file: 'Создание файла',
  read_working_file: 'Чтение рабочего файла',
  edit_working_file: 'Изменение файла',
};

/** A bounded, ephemeral trace for this response only; never invent a completed call. */
export function updateToolActivities(
  current: readonly AiToolActivity[],
  event: AiToolActivity,
): readonly AiToolActivity[] {
  if (event.state === 'running') {
    if (current.some((item) => item.tool === event.tool && item.state === 'running'))
      return current;
    return [...current, event].slice(-16);
  }
  let index = current.length - 1;
  while (
    index >= 0 &&
    !(current[index]?.tool === event.tool && current[index]?.state === 'running')
  )
    index -= 1;
  return index < 0 ? current : current.map((item, i) => (i === index ? event : item));
}

export function AiActivity({
  image = false,
  responding = false,
  activities = [],
  imageSize,
}: {
  image?: boolean;
  responding?: boolean;
  activities?: readonly AiToolActivity[];
  imageSize?: AiImageStoredSize | undefined;
}): JSX.Element {
  const running = activities.some((item) => item.state === 'running');
  const dimensions = image ? aiImageDimensions(imageSize ?? 1024) : null;
  return (
    <div
      className={`ai-activity${image ? ' ai-activity-image' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
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
      {activities.length ? (
        <ol className="ai-activity-steps" aria-label="Действия ИИ">
          {activities.map((activity, index) => (
            <li
              key={index}
              className="ai-activity-step"
              data-tool={activity.tool}
              data-state={activity.state}
            >
              <span className="ai-activity-step-icon" aria-hidden="true">
                <AiChatIcon name={TOOL_ICONS[activity.tool]} size={16} />
              </span>
              <span className="ai-activity-step-label">
                {activity.state === 'running'
                  ? activity.tool === 'web_search'
                    ? 'Ищу в интернете…'
                    : AI_TOOL_ACTIVITY_LABELS[activity.tool]
                  : TOOL_NAMES[activity.tool]}
              </span>
              {activity.state === 'running' ? (
                <span className="ai-tool-spinner" aria-hidden="true" />
              ) : (
                <span className="ai-tool-complete" aria-label="Вызов завершён">
                  <AiChatIcon name="check" size={14} />
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {!running || image ? (
        <div className="ai-activity-caption">
          <span className="ai-activity-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            {image ? 'Создаю изображение…' : responding ? 'Отвечаю…' : 'Обдумываю ответ…'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
