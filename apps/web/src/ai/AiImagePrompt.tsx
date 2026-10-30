import { useState } from 'react';
import { AiChatIcon } from './AiChatIcon';

export function AiImagePrompt({
  prompt,
  label,
  onTranslate,
  translationDisabled = false,
}: {
  prompt: string;
  label: string;
  onTranslate?: ((prompt: string) => void) | undefined;
  translationDisabled?: boolean;
}): JSX.Element {
  const [notice, setNotice] = useState('');
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice('Промпт скопирован');
    } catch {
      setNotice('Не удалось скопировать промпт');
    }
  }
  return (
    <div className="ai-image-prompt-receipt">
      <div className="ai-image-prompt-heading">
        <strong>{label}</strong>
        <span className="ai-image-prompt-actions">
          <button
            type="button"
            aria-label="Скопировать промпт"
            data-ai-tooltip="Скопировать промпт"
            onClick={() => void copy()}
          >
            <AiChatIcon name="copy" size={16} />
          </button>
          {onTranslate ? (
            <button
              type="button"
              disabled={translationDisabled}
              onClick={() => onTranslate(prompt)}
              data-ai-tooltip="Перевести промпт на русский отдельным ответом в чате"
            >
              Перевести
            </button>
          ) : null}
        </span>
      </div>
      <p>{prompt}</p>
      {notice ? <span role="status">{notice}</span> : null}
    </div>
  );
}
