import type { AnchorHTMLAttributes, MouseEvent } from 'react';

type PortalLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & {
  href: string;
  onNavigate?: () => void;
};

/**
 * A browser-native link with optional client-side navigation for an ordinary
 * left click. Modified clicks and the middle mouse button keep their native
 * behaviour, so every Portal destination can be opened in another tab.
 */
export function PortalLink({ href, onNavigate, ...props }: PortalLinkProps): JSX.Element {
  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    if (
      !onNavigate ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onNavigate();
  }

  return <a {...props} href={href} onClick={follow} />;
}
