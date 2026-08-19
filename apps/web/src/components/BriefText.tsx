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
 * the ones below, and everything else is text.
 *
 * Картинки и ссылки — часть задания, а не украшение: «соедини две детали»
 * показывают, а не описывают. Картинка берётся только из самого продукта
 * (загруженная к этому заданию или его образец), ссылка — только http(s) и
 * открывается отдельной вкладкой. Всё остальное остаётся набранным текстом.
 */

type Block =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'para'; readonly text: string }
  | { readonly kind: 'image'; readonly src: string; readonly caption: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: readonly string[] };

/** Полужирный и ссылка. Порядок в разборе — тот же, что в строке. */
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;

/**
 * Адрес, которому можно доверить страницу ребёнка.
 *
 * Картинка — только своя: загруженная к заданию или образец, лежащий в самом
 * продукте. Чужой адрес в теге картинки — это ещё и счётчик посещений на
 * школьном экране, поэтому его тут нет вовсе.
 */
export function safeImageSrc(src: string): string | null {
  if (src.startsWith('/api/assignments/') || src.startsWith('/assets/')) return src;
  // Картинка, которую учитель только что выбрал и ещё не сохранил: она живёт в
  // самой странице и никуда не ходит. Только растровые форматы — svg умеет
  // выполнять скрипты и в чужом тексте ему делать нечего.
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src) ? src : null;
}

/** Ссылка — только http(s) и только отдельной вкладкой. */
export function safeLinkHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

/** Bold and links inside a line. Anything unmatched stays the characters typed. */
function inline(text: string): JSX.Element {
  const parts: Array<string | JSX.Element> = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    if (match[1] !== undefined) {
      parts.push(<strong key={`b${at}`}>{match[1]}</strong>);
    } else {
      const href = safeLinkHref(match[3] as string);
      parts.push(
        href ? (
          <a key={`a${at}`} href={href} target="_blank" rel="noreferrer noopener">
            {match[2]}
          </a>
        ) : (
          // Не ссылка — значит просто текст: скрывать набранное нельзя.
          (match[0] as string)
        ),
      );
    }
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
    const picture = IMAGE_LINE.exec(line);
    if (picture) {
      const src = safeImageSrc(picture[2] as string);
      if (src) {
        flushParagraph();
        blocks.push({ kind: 'image', src, caption: picture[1] as string });
        continue;
      }
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
        if (block.kind === 'image') {
          return (
            <figure key={index} className="brief-figure">
              <img src={block.src} alt={block.caption} loading="lazy" />
              {block.caption ? <figcaption>{block.caption}</figcaption> : null}
            </figure>
          );
        }
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
