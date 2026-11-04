import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AiChatIcon } from './AiChatIcon';

export interface AiCompactOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

interface Props {
  label: string;
  value: string;
  options: readonly AiCompactOption[];
  disabled?: boolean | undefined;
  className?: string;
  displayLabel?: string | undefined;
  onChange: (value: string) => void;
  onOpen?: () => void;
  onSelect?: () => void;
}

/** A compact, keyboard-operable selector whose popup is not clipped by the composer. */
export function AiCompactSelect({
  label,
  value,
  options,
  disabled,
  className = '',
  displayLabel,
  onChange,
  onOpen,
  onSelect,
}: Props): JSX.Element {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, right: 0, maxHeight: 320 });
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const above = rect.top;
      const below = viewportHeight - rect.bottom;
      const useAbove = above >= 180 || above >= below;
      const room = Math.max(100, (useAbove ? above : below) - 16);
      const maxHeight = Math.min(320, room);
      const popupHeight = Math.min(popup.current?.scrollHeight ?? maxHeight, maxHeight);
      const popupWidth = popup.current?.getBoundingClientRect().width ?? 160;
      setPosition({
        top: useAbove ? Math.max(8, rect.top - popupHeight - 8) : rect.bottom + 8,
        right: Math.max(
          8,
          Math.min(window.innerWidth - rect.right, window.innerWidth - popupWidth - 8),
        ),
        maxHeight,
      });
    };
    const dismiss = (event: PointerEvent): void => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    document.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      document.removeEventListener('pointerdown', dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const openMenu = (focusOption = false): void => {
    if (disabled) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    const index =
      selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);
    setActive(Math.max(0, index));
    setOpen(true);
    onOpen?.();
    if (focusOption && index >= 0)
      requestAnimationFrame(() =>
        popup.current?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)?.focus(),
      );
  };
  const select = (option: AiCompactOption): void => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    if (onSelect) onSelect();
    else trigger.current?.focus();
  };
  const step = (direction: number): void => {
    let next = active;
    for (let i = 0; i < options.length; i++) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActive(next);
        popup.current?.querySelector<HTMLElement>(`[data-option-index="${next}"]`)?.focus();
        return;
      }
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu(true);
      else step(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      const index =
        event.key === 'Home'
          ? options.findIndex((option) => !option.disabled)
          : [...options].map((option) => !option.disabled).lastIndexOf(true);
      if (index >= 0) {
        setActive(index);
        popup.current?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)?.focus();
      }
    }
  };
  const onBlur = (event: FocusEvent<HTMLElement>): void => {
    const next = event.relatedTarget;
    if (!next || (!trigger.current?.contains(next) && !popup.current?.contains(next)))
      setOpen(false);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`ai-compact-select ${className}`}
        aria-label={label}
        data-ai-tooltip={displayLabel ?? selected?.label ?? value}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={(event) => (open ? setOpen(false) : openMenu(event.detail === 0))}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <span className="ai-compact-select-name">{displayLabel ?? selected?.label ?? value}</span>
        <span className="ai-compact-select-chevron" aria-hidden="true">
          <AiChatIcon name="chevron-down" />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            className="ai-compact-popup"
            role="listbox"
            aria-label={label}
            data-chat-theme={
              document.querySelector('.asa-ai-layout')?.getAttribute('data-chat-theme') ?? 'light'
            }
            style={{ top: position.top, right: position.right, maxHeight: position.maxHeight }}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                data-option-index={index}
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                tabIndex={index === active ? 0 : -1}
                onClick={() => select(option)}
                onMouseEnter={() => {
                  if (!option.disabled) setActive(index);
                }}
              >
                <span>{option.label}</span>
                {option.value === value ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
