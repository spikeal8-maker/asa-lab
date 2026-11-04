import { AiCopyButton } from './AiCopyButton';
import {
  Component,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import {
  embedPreviewImages,
  loadPreviewImages,
  previewImageCandidates,
  usePreviewImages,
  type GeneratedPreviewAssets,
} from './ai-preview-images';

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
  readonly hideCodeBlocks?: readonly number[];
  readonly codeHeader?: { name: string; controls: ReactNode; actions?: ReactNode };
  readonly content: string;
  readonly pending?: boolean;
  readonly webSearch?: unknown;
  readonly previewEvidence?: readonly unknown[];
  readonly generatedAssets?: GeneratedPreviewAssets;
  readonly seatId?: string | undefined;
}

const CodePendingContext = createContext(false);
const CodeHeaderContext = createContext<ContentProps['codeHeader']>(undefined);
const CodeImagesContext = createContext<{
  evidence: readonly unknown[];
  seatId?: string | undefined;
  generatedAssets?: GeneratedPreviewAssets | undefined;
}>({ evidence: [] });
// Stable renderer identity keeps a running app alive when the surrounding chat
// rerenders (typing, focus, provider status). Inline component functions remount it.
function CodePre({ children }: { children?: ReactNode }): JSX.Element {
  const pending = useContext(CodePendingContext);
  return <CodeCard pending={pending}>{children}</CodeCard>;
}

function CodeCard({ children, pending }: { children: ReactNode; pending: boolean }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const inlineZoom = useRef<number | 'fit'>('fit');
  function expand(next: boolean): void {
    if (next) {
      inlineZoom.current = zoom;
      setZoom(1);
    } else setZoom(inlineZoom.current);
    setExpanded(next);
  }
  const card = useRef<HTMLDialogElement>(null);
  const modal = useRef(false);
  useEffect(() => {
    const dialog = card.current;
    if (!dialog) return;
    if (expanded) {
      if (dialog.open) dialog.close();
      dialog.showModal();
      modal.current = true;
    } else {
      if (modal.current) dialog.close();
      modal.current = false;
      dialog.open = true;
    }
  }, [expanded]);
  const [showPreview, setShowPreview] = useState(true);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const previewArea = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [runId, setRunId] = useState(0);
  const code = flattenText(children).replace(/\n$/, '');
  const header = useContext(CodeHeaderContext);
  const child = Array.isArray(children) ? children[0] : children;
  const language = isValidElement<{ className?: string }>(child)
    ? (child.props.className?.match(/language-([^\s]+)/)?.[1] ?? '')
    : '';
  const format = codeDownloadFormat(language, code);
  const file = { ...format, name: header?.name ?? format.name };
  const previewable = file.name.endsWith('.html') || file.name.endsWith('.svg');
  const running = !pending && file.name.endsWith('.html');
  const imageContext = useContext(CodeImagesContext);
  const images = usePreviewImages(
    pending || !previewable ? '' : code,
    imageContext.evidence,
    imageContext.seatId,
    imageContext.generatedAssets,
  );
  const downloadAbort = useRef<AbortController>();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  useEffect(() => {
    setDownloading(false);
    setDownloadError('');
    return () => downloadAbort.current?.abort();
  }, [code, imageContext.seatId, imageContext.generatedAssets?.threadId]);
  async function downloadFile(): Promise<void> {
    if (pending || downloading) return;
    downloadAbort.current?.abort();
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloading(true);
    setDownloadError('');
    try {
      const candidates = file.name.endsWith('.html')
        ? previewImageCandidates(code, imageContext.evidence, imageContext.generatedAssets)
        : [];
      const ready = candidates.every((candidate) => candidate.refs.every((ref) => images.has(ref)));
      const assets = ready
        ? images
        : await loadPreviewImages(candidates, imageContext.seatId, controller.signal);
      controller.signal.throwIfAborted();
      if (!candidates.every((candidate) => candidate.refs.every((ref) => assets.has(ref))))
        throw new Error('image_unavailable');
      downloadBlob(
        new Blob([file.name.endsWith('.html') ? embedPreviewImages(code, assets) : code], {
          type: file.mime,
        }),
        file.name,
      );
    } catch {
      if (!controller.signal.aborted)
        setDownloadError('Не удалось подготовить файл с изображениями. Попробуйте ещё раз.');
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
    }
  }
  const preview = useMemo(
    () =>
      previewable && !pending
        ? codePreviewDocument(
            code,
            running && file.name.endsWith('.html'),
            file.name.endsWith('.svg'),
            images,
          )
        : null,
    [code, pending, previewable, running, file.name, images],
  );
  const previewVisible = Boolean(preview && showPreview);
  useEffect(() => {
    const element = previewArea.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewVisible]);
  const scale = file.name.endsWith('.svg')
    ? 1
    : zoom === 'fit'
      ? availableWidth > 0
        ? availableWidth / (device === 'phone' ? 390 : 1024)
        : 0.5
      : zoom;
  return (
    <dialog
      ref={card}
      open
      className="asa-ai-code-block"
      data-expanded={expanded || undefined}
      role={expanded ? 'dialog' : 'region'}
      aria-label="Код и предпросмотр"
      aria-modal={expanded || undefined}
      onCancel={(event) => {
        event.preventDefault();
        expand(false);
      }}
    >
      <div className="asa-ai-code-actions">
        <div className="asa-ai-code-file">
          {header ? (
            header.controls
          ) : (
            <span className="asa-ai-code-format">
              <AiChatIcon name="file" size={16} />
              {language || 'Текст'}
            </span>
          )}
        </div>

        {preview && (
          <div className="asa-ai-code-tabs" role="group" aria-label="Отображение результата">
            <button
              type="button"
              aria-label="Просмотр"
              aria-pressed={previewVisible}
              onClick={() => setShowPreview(true)}
            >
              <AiChatIcon name="image" size={16} />
              <span>Просмотр</span>
            </button>
            <button
              type="button"
              aria-label="Код"
              aria-pressed={!previewVisible}
              onClick={() => {
                setShowPreview(false);
              }}
            >
              <span aria-hidden="true" className="asa-ai-code-symbol">
                &lt;/&gt;
              </span>
              <span>Код</span>
            </button>
          </div>
        )}
        {previewVisible && file.name.endsWith('.html') && (
          <>
            <button
              type="button"
              className="asa-ai-code-device"
              aria-label={device === 'desktop' ? 'Показать на телефоне' : 'Показать на компьютере'}
              data-ai-tooltip={
                device === 'desktop'
                  ? 'Компьютер · переключить на телефон'
                  : 'Телефон · переключить на компьютер'
              }
              onClick={() => setDevice(device === 'desktop' ? 'phone' : 'desktop')}
            >
              <AiChatIcon name={device === 'desktop' ? 'monitor' : 'phone'} size={17} />
            </button>
            <select
              aria-label="Масштаб HTML"
              value={zoom}
              onChange={(event) =>
                setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))
              }
            >
              <option value="fit">По ширине</option>
              {[0.25, 0.5, 0.75, 1].map((value) => (
                <option key={value} value={value}>
                  {value * 100}%
                </option>
              ))}
            </select>
            {running && (
              <button
                type="button"
                className="asa-ai-code-restart"
                aria-label="Перезапустить приложение"
                data-ai-tooltip="Перезапустить"
                onClick={() => setRunId(runId + 1)}
              >
                <AiChatIcon name="refresh" size={17} />
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="asa-ai-code-expand"
          aria-expanded={expanded}
          aria-label={expanded ? 'Вернуть в чат' : 'Открыть на всё окно'}
          data-ai-tooltip={expanded ? 'Вернуть в чат · Esc' : 'На всё окно · масштаб 100%'}
          onClick={() => expand(!expanded)}
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
      <div className="asa-ai-code-body" aria-label="Область кода и предпросмотра">
        <div className="asa-ai-code-overlay-actions" role="group" aria-label="Действия с файлом">
          {header?.actions}
          <AiCopyButton text={code} label="Копировать код" />
          <button
            type="button"
            disabled={pending || downloading}
            data-ai-tooltip={pending ? 'Доступно после завершения ответа' : 'Скачать ' + file.name}
            onClick={() => void downloadFile()}
            aria-label={'Скачать код: ' + file.name}
          >
            <AiChatIcon name="download" size={17} />
          </button>
        </div>
        {previewVisible && (
          <div
            className="asa-ai-code-preview"
            ref={previewArea}
            data-fit={zoom === 'fit' || undefined}
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
                loading="lazy"
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
      </div>
      {downloadError && (
        <p role="status" className="asa-ai-preview-notice">
          {downloadError}
        </p>
      )}
      {previewable && !pending && !preview && (
        <p className="asa-ai-preview-notice">
          Предпросмотр недоступен для этого блока. Код можно скопировать или скачать.
        </p>
      )}
    </dialog>
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
  codeHeader,
  hideCodeBlocks,
  previewEvidence,
  generatedAssets,
  seatId,
}: ContentProps): JSX.Element {
  const evidence = readWebEvidence(webSearch);
  let blockIndex = 0;
  const visibleContent = hideCodeBlocks?.length
    ? content.replace(/^(`{3,}|~{3,})[\w+-]*[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (block) =>
        hideCodeBlocks.includes(blockIndex++) ? '' : block,
      )
    : content;
  return (
    <div className="asa-ai-rich-text">
      <ContentBoundary content={content}>
        <CodePendingContext.Provider value={pending}>
          <CodeHeaderContext.Provider value={codeHeader}>
            <CodeImagesContext.Provider
              value={{ evidence: previewEvidence ?? [webSearch], seatId, generatedAssets }}
            >
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
                {visibleContent}
              </ReactMarkdown>
            </CodeImagesContext.Provider>
          </CodeHeaderContext.Provider>
        </CodePendingContext.Provider>
      </ContentBoundary>
    </div>
  );
}
