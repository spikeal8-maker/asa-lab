import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></IconBase>; }
export function DuplicateIcon(props: IconProps): JSX.Element { return <IconBase {...props}><rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></IconBase>; }
export function DeleteIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M4 7h16"/><path d="m9 7 .7-2h4.6l.7 2"/><path d="m6.5 7 .8 13h9.4l.8-13"/><path d="M10 11v5M14 11v5"/></IconBase>; }
export function UndoIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M9 7 4 12l5 5"/><path d="M20 18a8 8 0 0 0-8-8H4"/></IconBase>; }
export function RedoIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m15 7 5 5-5 5"/><path d="M4 18a8 8 0 0 1 8-8h8"/></IconBase>; }
export function CommentIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/></IconBase>; }
export function InspectIcon(props: IconProps): JSX.Element { return <IconBase {...props}><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M12 7V5M12 19v-2M7 12H5M19 12h-2"/></IconBase>; }
export function FitIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/><path d="m3 8 5-5M21 8l-5-5M3 16l5 5M21 16l-5 5"/></IconBase>; }
export function ZoomInIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M10.5 7.5v6M7.5 10.5h6"/></IconBase>; }
export function ZoomOutIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M7.5 10.5h6"/></IconBase>; }
export function PlayIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m8 5 11 7-11 7z"/></IconBase>; }
export function StopIcon(props: IconProps): JSX.Element { return <IconBase {...props}><rect x="6" y="6" width="12" height="12" rx="1"/></IconBase>; }
export function SaveIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></IconBase>; }
export function ShareIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></IconBase>; }
export function CodeIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 5l-2 14"/></IconBase>; }
export function CircuitIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M4 6h5M15 6h5M9 3v6M15 3v6M4 18h16"/><path d="M7 18v-4h10v4"/></IconBase>; }
export function SchematicIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M3 12h4M17 12h4"/><path d="M7 8v8l3-4 2 4 2-8 3 4"/></IconBase>; }
export function ListIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="18" r=".8" fill="currentColor" stroke="none"/></IconBase>; }
export function SearchIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></IconBase>; }
export function ChevronIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m8 10 4 4 4-4"/></IconBase>; }
export function CollapseIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m14 6-6 6 6 6"/></IconBase>; }
export function ExpandIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m10 6 6 6-6 6"/></IconBase>; }
export function RotateIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></IconBase>; }
export function WireIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M7 17h4c2 0 2-4 4-4h2V9"/></IconBase>; }
export function FolderIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M3 6h7l2 2h9v11H3z"/></IconBase>; }
export function ClassesIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6M14 15c3.5-.5 6 1.2 7 5"/></IconBase>; }
export function UserIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-5 3.5-7 8-7s7.2 2 8 7"/></IconBase>; }
export function CloseIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m6 6 12 12M18 6 6 18"/></IconBase>; }
export function MoreIcon(props: IconProps): JSX.Element { return <IconBase {...props}><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></IconBase>; }
export function CheckIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="m5 12 4 4L19 6"/></IconBase>; }
export function MinusIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M5 12h14"/></IconBase>; }
export function PlusIcon(props: IconProps): JSX.Element { return <IconBase {...props}><path d="M12 5v14M5 12h14"/></IconBase>; }
