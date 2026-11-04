import { useState } from 'react';
import { useCopyFeedback } from './use-copy-feedback';
import { AiChatIcon } from './AiChatIcon';

export function AiCopyButton({
  text,
  label = 'Копировать',
  size = 17,
  showLabel = false,
}: {
  text: string;
  label?: string;
  size?: number;
  showLabel?: boolean;
}): JSX.Element {
  const { copied, confirmCopy, resetCopy } = useCopyFeedback(text);
  const [error, setError] = useState(false);
  async function copy(): Promise<void> {
    setError(false);
    try {
      await navigator.clipboard.writeText(text);
      confirmCopy();
    } catch {
      resetCopy();
      setError(true);
    }
  }
  return (
    <button
      type="button"
      className="ai-copy-button"
      data-copied={copied || undefined}
      aria-label={copied ? 'Скопировано' : label}
      data-ai-tooltip={error ? 'Не удалось скопировать' : copied ? 'Скопировано' : label}
      onClick={() => void copy()}
    >
      <AiChatIcon name={copied ? 'check' : 'copy'} size={copied ? Math.max(22, size + 3) : size} />
      {showLabel ? <span>{copied ? 'Скопировано' : label}</span> : null}
      <span className="sr-only" role="status">
        {error ? 'Не удалось скопировать' : copied ? 'Скопировано' : ''}
      </span>
    </button>
  );
}
