import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CubeIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="m12 2.8 8 4.5v9.4l-8 4.5-8-4.5V7.3z" />
      <path d="m4.3 7.4 7.7 4.4 7.7-4.4M12 11.8v9.1" />
    </IconBase>
  );
}

export function MoveIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M12 2v20M2 12h20" />
      <path d="m8 6 4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4" />
    </IconBase>
  );
}

export function ScaleIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      <path d="m4 4 6 6M20 4l-6 6M20 20l-6-6M4 20l6-6" />
    </IconBase>
  );
}

export function GridIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" />
    </IconBase>
  );
}

export function RulerIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M4 3v17h17" />
      <path d="M4 7h4M4 11h3M4 15h4M9 20v-4M13 20v-3M17 20v-4" />
    </IconBase>
  );
}

export function HomeIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="m3 11 9-8 9 8" />
      <path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" />
    </IconBase>
  );
}

export function GroupIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M4 4h7v7H4zM13 13h7v7h-7z" />
      <path d="M8 13v3a2 2 0 0 0 2 2h1M13 6h1a2 2 0 0 1 2 2v3" />
    </IconBase>
  );
}

export function UngroupIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M3 3h7v7H3zM14 14h7v7h-7z" />
      <path d="m9 15-3 3m0-3v3h3M15 9l3-3m-3 0h3v3" />
    </IconBase>
  );
}

export function AlignIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M12 3v18M4 6h8M7 11h5M2 16h10M12 8h8M12 13h5M12 18h10" />
    </IconBase>
  );
}

export function HoleIcon(props: IconProps): JSX.Element {
  return (
    <IconBase {...props}>
      <path d="M4 6 12 2l8 4v12l-8 4-8-4z" strokeDasharray="2.4 2.4" />
      <path d="m4 6 8 4 8-4M12 10v12" strokeDasharray="2.4 2.4" />
    </IconBase>
  );
}
