import { Component, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './ai-text-complete.css';

function flattenText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return flattenText(node.props.children);
  return '';
}

function safeLink(href?: string): { href: string; external: boolean } | null {
  if (!href) return null;
  try {
    const url = new URL(href, window.location.origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return { href, external: url.origin !== window.location.origin };
  } catch {
    return null;
  }
}

interface ContentProps {
  readonly content: string;
}

// A malformed formula normally becomes KaTeX's escaped source fallback. An
// unexpected plugin error must also stay within this message, including while
// a partial formula arrives from the stream. New content may render again.
class ContentBoundary extends Component<ContentProps & { children: ReactNode }> {
  override state = { failed: false, previous: this.props.content };

  static getDerivedStateFromProps(
    props: ContentProps,
    state: { previous: string },
  ): { failed: boolean; previous: string } | null {
    return props.content !== state.previous ? { failed: false, previous: props.content } : null;
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <div className="asa-ai-content-fallback">
        <p role="status">Не удалось оформить ответ. Показан исходный текст.</p>
        <div>{this.props.content}</div>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function AiMessageContent({ content }: ContentProps): JSX.Element {
  return (
    <div className="asa-ai-rich-text">
      <ContentBoundary content={content}>
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            [
              rehypeKatex,
              {
                trust: false,
                maxExpand: 1000,
                maxSize: 8,
                strict: 'ignore',
                output: 'htmlAndMathml',
              },
            ],
          ]}
          components={{
            a: ({ href, children }) => {
              const safe = safeLink(href);
              return safe ? (
                <a
                  href={safe.href}
                  target={safe.external ? '_blank' : undefined}
                  rel={safe.external ? 'noreferrer noopener' : undefined}
                >
                  {children}
                </a>
              ) : (
                <span>{children}</span>
              );
            },
            pre: ({ children }) => {
              const code = flattenText(children).replace(/\n$/, '');
              return (
                <div className="asa-ai-code-block">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(code).catch(() => undefined)}
                    aria-label="Копировать код"
                  >
                    Копировать код
                  </button>
                  <pre>{children}</pre>
                </div>
              );
            },
            table: ({ children }) => (
              <div
                className="asa-ai-table-scroll"
                role="region"
                aria-label="Таблица ответа"
                tabIndex={0}
              >
                <table>{children}</table>
              </div>
            ),
            img: ({ alt }) => <span>{alt || 'Изображение в ответе недоступно'}</span>,
          }}
        >
          {content}
        </ReactMarkdown>
      </ContentBoundary>
    </div>
  );
}
