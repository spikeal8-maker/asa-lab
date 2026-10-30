import { AiCopyButton } from './AiCopyButton';

export function AiImagePrompt({ prompt, label }: { prompt: string; label: string }): JSX.Element {
  return (
    <div className="ai-image-prompt-receipt">
      <div className="ai-image-prompt-heading">
        <strong>{label}</strong>
        <span className="ai-image-prompt-actions">
          <AiCopyButton text={prompt} label="Скопировать промпт" size={16} />
        </span>
      </div>
      <p>{prompt}</p>
    </div>
  );
}
