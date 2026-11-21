import { useEffect, useRef } from 'react';

/** Display an already fetched private raster; never fetch a user-controlled URL. */
export function AiImageViewer({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ai-private-image-viewer"
      aria-label="Просмотр изображения"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button type="button" aria-label="Закрыть просмотр" onClick={onClose}>
        ×
      </button>
      <img src={src} alt={name} />
    </dialog>
  );
}
