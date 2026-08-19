import { Fragment, type JSX } from 'react';
import './brief-text.css';

/**
 * A task description, rendered the way it was written.
 *
 * A brief is not one grey paragraph. It is a couple of headings, a numbered
 * order of work, and a few things that must be true of the result — and a child
 * reading a wall of prose finds none of them. So the text carries light markup
 * and this renders it: headings, numbered and bulleted lists, bold.
 *
 * Deliberately not a full markdown parser and deliberately not HTML. Teachers
 * type these, learners read them, and nothing typed into a task should ever be
 * able to put markup on someone else's page — so the only things that exist are
 * the four below, and everything else is text.
 */

type Block =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'para'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] };

const BOLD = /\*\*([^*]+)\*\*/g;

/** Bold inside a line. Anything unmatched stays the literal characters typed. */
function inline(text: string): JSX.Element {
  const parts: Array<string | JSX.Element> = [];
  let last = 0;
  for (const match of text.matchAll(BOLD)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<strong key={`${at}`}>{match[1]}</strong>);
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

export function parseBrief(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'para', text: paragraph.join(' ') });
      paragraph = [];
    }
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flushParagraph();
      continue;
    }
    const heading = /^#{1,3}\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: heading[1] as string });
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (ordered || bullet) {
      flushParagraph();
      const item = (ordered ? ordered[2] : bullet?.[1]) as string;
      const isOrdered = Boolean(ordered);
      const previous = blocks[blocks.length - 1];
      if (previous && previous.kind === 'list' && previous.ordered === isOrdered) {
        blocks[blocks.length - 1] = {
          kind: 'list',
          ordered: isOrdered,
          items: [...previous.items, item],
        };
      } else {
        blocks.push({ kind: 'list', ordered: isOrdered, items: [item] });
      }
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

export function BriefText({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}): JSX.Element {
  const blocks = parseBrief(text);
  return (
    <div className={className ? `brief-text ${className}` : 'brief-text'}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') return <h4 key={index}>{inline(block.text)}</h4>;
        if (block.kind === 'para') return <p key={index}>{inline(block.text)}</p>;
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>);
        return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
      })}
    </div>
  );
}

/**
 * The goal, set apart.
 *
 * Everything else on a task card is what to do. This is what it is for, and a
 * learner who reads only one line should read this one.
 */
export function AssignmentGoal({ goal }: { readonly goal: string | null }): JSX.Element | null {
  if (!goal) return null;
  return (
    <p className="assignment-goal">
      <span className="assignment-goal-label">Цель</span>
      <span>{goal}</span>
    </p>
  );
}
