import type { SVGProps } from 'react';

/**
 * The navigation glyphs.
 *
 * They live together because a set of icons only works if it is one set: the
 * same box, the same stroke, the same corner radius, the same level of detail.
 * Icons borrowed one at a time from wherever they happened to exist read as a
 * pile of unrelated pictures, which is what a person notices before they notice
 * any single one of them.
 *
 * Each glyph says what its section is, not what its section resembles: a list
 * of lines could be a lesson, a task, a project or a menu, so nothing here is a
 * list of lines.
 */

type GlyphProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: GlyphProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M3.4 10.6 12 3.8l8.6 6.8" />
      <path d="M5.4 9.4v9.4a1 1 0 0 0 1 1h11.2a1 1 0 0 0 1-1V9.4" />
      <path d="M9.8 19.8v-5.2h4.4v5.2" />
    </Glyph>
  );
}

/** A class is people, not a building. */
export function ClassesGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="9" cy="8.2" r="3.1" />
      <path d="M3.3 19.4c0-3.1 2.6-5.2 5.7-5.2s5.7 2.1 5.7 5.2" />
      <path d="M16.2 5.5a3 3 0 0 1 0 5.6" />
      <path d="M17.4 14.6c2 .7 3.3 2.4 3.3 4.8" />
    </Glyph>
  );
}

/** Projects are cards on a shelf: the same shape the cards themselves have. */
export function ProjectsGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <rect x="3.4" y="4.2" width="7.4" height="6.2" rx="1.4" />
      <rect x="13.2" y="4.2" width="7.4" height="6.2" rx="1.4" />
      <rect x="3.4" y="13.4" width="7.4" height="6.2" rx="1.4" />
      <rect x="13.2" y="13.4" width="7.4" height="6.2" rx="1.4" />
    </Glyph>
  );
}

/** A collection holds projects, so it is a folder with something already in it. */
export function CollectionsGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M3.4 8.2V6.4a1.2 1.2 0 0 1 1.2-1.2h3.8l2 2.2h6a1.2 1.2 0 0 1 1.2 1.2v1" />
      <path d="M3.4 9.9h17.2l-1.5 8.1a1.2 1.2 0 0 1-1.2 1H6.1a1.2 1.2 0 0 1-1.2-1Z" />
    </Glyph>
  );
}

/** The gallery: a picture on a wall, which is what the page actually is. */
export function GalleryGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="1.6" />
      <path d="M3.4 15.4 8.2 11l3.5 3.2 3.1-2.6 5.8 4.8" />
      <circle cx="9" cy="8.8" r="1.3" />
    </Glyph>
  );
}

/** Lessons: the cap a person earns, not the paper they read. */
export function LearningGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M12 4.2 2.9 8.6 12 13l9.1-4.4Z" />
      <path d="M6.4 10.6v4.9c0 1.7 2.5 3.1 5.6 3.1s5.6-1.4 5.6-3.1v-4.9" />
      <path d="M21.1 8.6v5.1" />
    </Glyph>
  );
}

/** A task is something to hit, and something that gets ticked off. */
export function ChallengesGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="m12 12 5.6-5.6" />
      <path d="M17.6 3.9v2.5h2.5" />
    </Glyph>
  );
}

/** Help is a question someone answers, not a comment someone left. */
export function HelpGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2-2.5 3.6" />
      <path d="M12 17.1h.01" />
    </Glyph>
  );
}

/** Notifications ring; they are not messages someone wrote. */
export function BellGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M6.6 10.2a5.4 5.4 0 0 1 10.8 0c0 3.4.9 5 1.8 5.9H4.8c.9-.9 1.8-2.5 1.8-5.9Z" />
      <path d="M10.2 19a2 2 0 0 0 3.6 0" />
    </Glyph>
  );
}

/** A school is a place with a roof and a door, not a folder of files. */
export function SchoolGlyph(props: GlyphProps): JSX.Element {
  return (
    <Glyph {...props}>
      <path d="M12 3.4 3.6 7.2h16.8Z" />
      <path d="M5.2 7.2v12.4h13.6V7.2" />
      <path d="M10.2 19.6v-4.4h3.6v4.4" />
      <path d="M9 11h6" />
    </Glyph>
  );
}

/**
 * The gear is built from a ring and eight teeth rather than one traced outline:
 * at seventeen pixels a hand-written gear path collapses into a blob, and the
 * hole is punched with an even-odd fill so whatever is behind it shows through.
 */
const GEAR_TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

export function SettingsGlyph(props: GlyphProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {GEAR_TEETH.map((angle) => (
        <rect
          key={angle}
          x="10.75"
          y="1.9"
          width="2.5"
          height="5"
          rx="1"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <path
        fillRule="evenodd"
        d="M12 5.1a6.9 6.9 0 1 0 0 13.8 6.9 6.9 0 0 0 0-13.8Zm0 4.25a2.65 2.65 0 1 1 0 5.3 2.65 2.65 0 0 1 0-5.3Z"
      />
    </svg>
  );
}
