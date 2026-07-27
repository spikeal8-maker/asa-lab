import type { ModuleSummary } from '../api';

export function ModuleGlyph({ module, size = 36 }: { module: ModuleSummary; size?: number }): JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
  } as const;

  if (module.iconKey === 'circuit') {
    return (
      <svg {...common}>
        <circle cx="10" cy="24" r="5" fill="currentColor" />
        <circle cx="38" cy="12" r="5" fill="currentColor" />
        <circle cx="38" cy="36" r="5" fill="currentColor" />
        <path d="M15 24H25V12H33M25 24V36H33" stroke="currentColor" strokeWidth="3" />
      </svg>
    );
  }
  if (module.iconKey === 'blocks') {
    return (
      <svg {...common}>
        <rect x="5" y="7" width="18" height="14" rx="4" fill="currentColor" />
        <rect x="25" y="7" width="18" height="14" rx="4" fill="currentColor" opacity=".72" />
        <rect x="13" y="27" width="22" height="14" rx="4" fill="currentColor" opacity=".9" />
      </svg>
    );
  }
  if (module.iconKey === 'board') {
    return (
      <svg {...common}>
        <rect x="5" y="5" width="38" height="38" rx="4" stroke="currentColor" strokeWidth="3" />
        <path d="M5 14.5H43M5 24H43M5 33.5H43M14.5 5V43M24 5V43M33.5 5V43" stroke="currentColor" strokeWidth="2" opacity=".55" />
        <circle cx="14.5" cy="14.5" r="5" fill="currentColor" />
        <circle cx="33.5" cy="33.5" r="5" fill="currentColor" opacity=".7" />
      </svg>
    );
  }
  if (module.iconKey === 'three-d') {
    return (
      <svg {...common}>
        <path d="M24 4 42 14v20L24 44 6 34V14L24 4Z" stroke="currentColor" strokeWidth="3" />
        <path d="m7 14 17 10 17-10M24 24v19" stroke="currentColor" strokeWidth="3" />
      </svg>
    );
  }
  if (module.iconKey === 'robot') {
    return (
      <svg {...common}>
        <path d="M24 5v7M18 5h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <rect x="7" y="13" width="34" height="27" rx="7" stroke="currentColor" strokeWidth="3" />
        <circle cx="17" cy="25" r="4" fill="currentColor" />
        <circle cx="31" cy="25" r="4" fill="currentColor" />
        <path d="M17 34h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M8 38 17 9l22 22-29 9Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="m17 9 4 14 18 8" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

export function moduleAccent(moduleKey: string): string {
  const accents: Record<string, string> = {
    electronics: '#0f9ec7',
    blocks: '#7b5cd6',
    checkers: '#cc7a24',
    'three-d': '#e25b74',
    robotics: '#2f9d70',
    drawing: '#e04d9b',
  };
  return accents[moduleKey] ?? '#526579';
}
