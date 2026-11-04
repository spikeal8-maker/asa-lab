import { useEffect, useRef, useState } from 'react';
import { SettingsGlyph } from '../components/portal-icons';
import { ProjectActionIcon } from './ProjectActionIcon';
import type { ProjectCardMenuItem } from './ProjectCard';

export function ProjectCardMenu({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly ProjectCardMenuItem[];
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => details.current?.removeAttribute('open');
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !details.current?.contains(e.target)) close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        details.current?.querySelector('summary')?.focus();
      }
    };
    const scroll = (e: Event) => {
      if (!(e.target instanceof Node) || !details.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  return (
    <details
      ref={details}
      className="project-card-tools"
      onToggle={(e) => {
        const node = e.currentTarget;
        setOpen(node.open);
        if (!node.open) return;
        const anchor = node.querySelector('summary')!.getBoundingClientRect();
        const menu = node.querySelector<HTMLDivElement>('.project-card-menu')!;
        const { width, height } = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(anchor.right - width, innerWidth - width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4 + height <= innerHeight - 8 ? anchor.bottom + 4 : anchor.top - height - 4, innerHeight - height - 8))}px`;
      }}
    >
      <summary aria-label={`Действия с проектом ${title}`}>
        <SettingsGlyph />
      </summary>
      <div className="project-card-menu" aria-label={`Меню проекта ${title}`}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled === true}
            onClick={() => {
              details.current?.removeAttribute('open');
              item.onSelect();
            }}
          >
            <ProjectActionIcon label={item.label} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
