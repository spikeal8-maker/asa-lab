import { useState } from 'react';

export function AiAttachmentPreview({ src, name }: { src: string; name: string }): JSX.Element {
  const [size, setSize] = useState('');
  return (
    <img
      src={src}
      alt={name}
      data-ai-tooltip={size ? `${name} · ${size}` : name}
      onLoad={(event) =>
        setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)
      }
    />
  );
}
