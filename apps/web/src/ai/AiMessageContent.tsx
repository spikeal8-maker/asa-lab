import { AiCopyButton } from './AiCopyButton';
import {
  Component,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { codePreviewDocument } from './ai-code-preview';
import { AiChatIcon } from './AiChatIcon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './ai-text-complete.css';
import { codeDownloadFormat, downloadBlob } from './ai-download';
import { readWebEvidence } from './ai-web-evidence';

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
  readonly pending?: boolean;
  readonly webSearch?: unknown;
}

const CodePendingContext = createContext(false);
// Stable renderer identity keeps a running app alive when the surrounding chat
// rerenders (typing, focus, provider status). Inline component functions remount it.
function CodePre({ children }: { children?: ReactNode }): JSX.Element {
  const pending = useContext(CodePendingContext);
  return <CodeCard pending={pending}>{children}</CodeCard>;
}

function CodeCard({ children, pending }: { children: ReactNode; pending: boolean }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [zoom, setZoom] = useState(0.5);
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState(0);
  const code = flattenText(children).replace(/\n$/, '');
  const child = Array.isArray(children) ? children[0] : children;
  const language = isValidElement<{ className?: string }>(child)
    ? (child.props.className?.match(/language-([^\s]+)/)?.[1] ?? '')
    : '';
  const file = codeDownloadFormat(language, code);
  const previewable = file.name.endsWith('.html') || file.name.endsWith('.svg');
  const preview = useMemo(
    () =>
      previewable && !pending
        ? codePreviewDocument(code, running && file.name.endsWith('.html'))
        : null,
    [code, pending, previewable, running, file.name],
  );
  const previewVisible = Boolean(preview && showPreview);
  const scale = file.name.endsWith('.svg') ? 1 : zoom;
  return (
    <div className="asa-ai-code-block" data-expanded={expanded || undefined}>
      <div className="asa-ai-code-actions">
        <span className="asa-ai-code-format">
          <AiChatIcon name="file" size={16} />
          {language || 'Текст'}
        </span>
        {preview && (
          <div className="asa-ai-code-tabs" role="group" aria-label="Отображение результата">
            <button
              type="button"
              aria-pressed={previewVisible}
              onClick={() => setShowPreview(true)}
            >
              Просмотр
            </button>
            <button
              type="button"
              aria-pressed={!previewVisible}
              onClick={() => {
                setShowPreview(false);
                setRunning(false);
              }}
            >
              Код
            </button>
          </div>
        )}
        {previewVisible && file.name.endsWith('.html') && (
          <>
            <div className="asa-ai-code-devices" role="group" aria-label="Размер экрана">
              <button
                type="button"
                aria-label="Компьютер — 1024 пикселя"
                data-ai-tooltip="Компьютер · 1024 px"
                aria-pressed={device === 'desktop'}
                onClick={() => setDevice('desktop')}
              >
                <AiChatIcon name="monitor" size={17} />
              </button>
              <button
                type="button"
                aria-label="Телефон — 390 пикселей"
                data-ai-tooltip="Телефон · 390 px"
                aria-pressed={device === 'phone'}
                onClick={() => setDevice('phone')}
              >
                <AiChatIcon name="phone" size={17} />
              </button>
            </div>
            <select
              aria-label="Масштаб HTML"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            >
              {[0.5, 0.75, 1].map((value) => (
                <option key={value} value={value}>
                  {value * 100}%
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={running ? 'Остановить приложение' : 'Запустить приложение'}
              data-ai-tooltip={running ? 'Остановить' : 'Запустить'}
              onClick={() => setRunning(!running)}
            >
              <AiChatIcon name={running ? 'stop' : 'play'} size={17} />
            </button>
            {running && (
              <button
                type="button"
                aria-label="Перезапустить приложение"
                data-ai-tooltip="Перезапустить"
                onClick={() => setRunId(runId + 1)}
              >
                <AiChatIcon name="refresh" size={17} />
              </button>
            )}
          </>
        )}
        <span className="asa-ai-code-spacer" />
        <AiCopyButton text={code} label="Копировать код" />
        <button
          type="button"
          disabled={pending}
          data-ai-tooltip={pending ? 'Доступно после завершения ответа' : file.name}
          onClick={() => downloadBlob(new Blob([code], { type: file.mime }), file.name)}
          aria-label={'Скачать код: ' + file.name}
        >
          <AiChatIcon name="download" size={17} />
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Свернуть код' : 'Развернуть код'}
          data-ai-tooltip={expanded ? 'Свернуть код' : 'Развернуть код'}
          onClick={() => setExpanded(!expanded)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path
              d={
                expanded
                  ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6'
                  : 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5'
              }
            />
          </svg>
        </button>
      </div>
      {previewVisible && (
        <div
          className="asa-ai-code-preview"
          data-device={file.name.endsWith('.html') ? device : 'svg'}
          style={
            {
              '--code-preview-scale': scale,
              '--code-device-width': device === 'phone' ? '390px' : '1024px',
            } as React.CSSProperties
          }
        >
          <div className="asa-ai-preview-stage">
            <iframe
              key={String(running) + ':' + runId}
              title={'Предпросмотр ' + (file.name.endsWith('.svg') ? 'SVG' : 'HTML')}
              sandbox={running && file.name.endsWith('.html') ? 'allow-scripts' : ''}
              allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; fullscreen 'none'"
              referrerPolicy="no-referrer"
              srcDoc={preview!}
            />
          </div>
        </div>
      )}
      <pre
        hidden={previewVisible}
        tabIndex={0}
        role="region"
        aria-label={'Код: ' + (language || 'текст')}
      >
        {children}
      </pre>
      {previewable && !pending && !preview && (
        <p className="asa-ai-preview-notice">
          Предпросмотр недоступен для этого блока. Код можно скопировать или скачать.
        </p>
      )}
    </div>
  );
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

export function AiMessageContent({
  content,
  pending = false,
  webSearch,
}: ContentProps): JSX.Element {
  const evidence = readWebEvidence(webSearch);
  return (
    <div className="asa-ai-rich-text">
      <ContentBoundary content={content}>
        <CodePendingContext.Provider value={pending}>
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
                const number = flattenText(children).replace(/^\[|\]$/g, '');
                const cited = evidence?.sources.find(
                  (source) => String(source.id) === number && safe?.href === source.url,
                );
                return safe ? (
                  <a
                    href={safe.href}
                    target={safe.external ? '_blank' : undefined}
                    rel={safe.external ? 'noreferrer noopener' : undefined}
                    className={cited ? 'asa-ai-citation' : undefined}
                    aria-label={cited ? 'Источник ' + cited.id + ': ' + cited.title : undefined}
                    title={cited?.hostname}
                  >
                    {children}
                  </a>
                ) : (
                  <span>{children}</span>
                );
              },
              pre: CodePre,
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
        </CodePendingContext.Provider>
      </ContentBoundary>
    </div>
  );
}
