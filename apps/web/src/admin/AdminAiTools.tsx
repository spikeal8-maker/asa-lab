import { AI_TOOL_LABELS, type AiToolId } from '@asa-lab/contracts';
import { useEffect, useRef, useState } from 'react';
import { AdminAiToolPolicies } from './AdminAiToolPolicies';
import { AdminAiWebSearch } from './AdminAiWebSearch';
import { AdminAiImages } from './AdminAiImages';
import './ai-tools-workspace.css';

const ORDER: readonly AiToolId[] = [
  'web_search',
  'read_page',
  'image_search',
  'weather',
  'generate_image',
  'create_working_file',
  'read_working_file',
  'edit_working_file',
];
const NETWORK = new Set<AiToolId>(['web_search', 'read_page', 'image_search', 'weather']);

/** One owner of each settings draft; changing the selected tool never remounts its form. */
export function AdminAiTools({
  onAccessDenied,
  onDirtyChange,
}: {
  readonly onAccessDenied: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState<AiToolId>('web_search');
  const [policyDirty, setPolicyDirty] = useState(false);
  const [webDirty, setWebDirty] = useState(false);
  const [imageDirty, setImageDirty] = useState(false);
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => {
    onDirtyChange?.(policyDirty || webDirty || imageDirty);
  }, [policyDirty, webDirty, imageDirty, onDirtyChange]);

  return (
    <section className="asa-ai-tools-workspace" aria-label="Настройки инструментов">
      <nav
        ref={tabs}
        role="tablist"
        aria-label="Инструменты помощника"
        className="asa-ai-tool-tabs"
      >
        {ORDER.map((id, index) => (
          <button
            key={id}
            id={'ai-tool-tab-' + id}
            type="button"
            role="tab"
            aria-selected={selected === id}
            aria-controls="ai-tool-settings"
            tabIndex={selected === id ? 0 : -1}
            onClick={() => setSelected(id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % ORDER.length
                  : event.key === 'ArrowLeft'
                    ? (index + ORDER.length - 1) % ORDER.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? ORDER.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setSelected(ORDER[next]!);
              tabs.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
            }}
          >
            {AI_TOOL_LABELS[id]}
          </button>
        ))}
      </nav>
      <div id="ai-tool-settings" role="tabpanel" aria-labelledby={'ai-tool-tab-' + selected}>
        <h2 className="asa-ai-tool-page-title">{AI_TOOL_LABELS[selected]}</h2>
        <AdminAiToolPolicies
          onAccessDenied={onAccessDenied}
          selectedTool={selected}
          onDirtyChange={setPolicyDirty}
        />
        <div hidden={!NETWORK.has(selected)}>
          <AdminAiWebSearch
            onAccessDenied={onAccessDenied}
            selectedTool={selected}
            onDirtyChange={setWebDirty}
          />
        </div>
        <div hidden={selected !== 'generate_image'}>
          <AdminAiImages onAccessDenied={onAccessDenied} onDirtyChange={setImageDirty} />
          <a href="#/admin/ai?section=comfyui">Подключение генератора и тестовое изображение →</a>
        </div>
        {!NETWORK.has(selected) && selected !== 'generate_image' ? (
          <p className="asa-ai-tool-footnote">
            Форматы, размеры и проверка версий ограничиваются сервером. Их действующие ограничения
            доступны в подсказке рядом с состоянием; произвольное изменение этих пределов пока не
            поддерживается.
          </p>
        ) : null}
      </div>
    </section>
  );
}
