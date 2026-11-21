import { AI_TOOL_LABELS, type AiToolId } from '@asa-lab/contracts';
import { useEffect, useRef, useState } from 'react';
import { AdminAiToolProbe } from './AdminAiToolProbe';
import type { ToolPolicyConfiguration } from './AdminAiToolPolicies';
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
  principalId,
}: {
  readonly principalId: string;
  readonly onAccessDenied: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [selected, setSelected] = useState<AiToolId>(() => {
    try {
      const pending = JSON.parse(
        sessionStorage.getItem('asa-ai-tool-probe:v1:' + principalId) ?? 'null',
      );
      if (pending && ORDER.includes(pending.tool)) return pending.tool;
    } catch {
      /* Ignore an invalid local UI checkpoint. */
    }
    const value = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tool');
    return ORDER.includes(value as AiToolId) ? (value as AiToolId) : 'web_search';
  });
  const [policyDirty, setPolicyDirty] = useState(false);
  const [webDirty, setWebDirty] = useState(false);
  const [imageDirty, setImageDirty] = useState(false);
  const [configuration, setConfiguration] = useState<ToolPolicyConfiguration | null>(null);
  const [testing, setTesting] = useState(false);
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => {
    onDirtyChange?.(policyDirty || webDirty || imageDirty || testing);
  }, [policyDirty, webDirty, imageDirty, testing, onDirtyChange]);

  return (
    <section className="asa-ai-tools-workspace" aria-label="Настройки инструментов">
      <nav
        ref={tabs}
        role="tablist"
        aria-label="Инструменты помощника"
        aria-orientation="vertical"
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
            disabled={testing}
            onClick={() => setSelected(id)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowDown' || event.key === 'ArrowRight'
                  ? (index + 1) % ORDER.length
                  : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                    ? (index + ORDER.length - 1) % ORDER.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? ORDER.length - 1
                        : null;
              if (next === null || testing) return;
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
        <div className="asa-ai-tool-editor">
          <AdminAiToolPolicies
            onAccessDenied={onAccessDenied}
            selectedTool={selected}
            presentation="detail"
            onConfigurationChange={setConfiguration}
            onDirtyChange={setPolicyDirty}
          />
          <div hidden={!NETWORK.has(selected)}>
            <AdminAiWebSearch
              onAccessDenied={onAccessDenied}
              selectedTool={selected}
              presentation="parameters"
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
        <AdminAiToolProbe
          key={principalId}
          principalId={principalId}
          tool={selected}
          rule={configuration?.tools.find((item) => item.id === selected)}
          unsaved={policyDirty || webDirty || imageDirty}
          onBusyChange={setTesting}
          onAccessDenied={onAccessDenied}
        />
      </div>
    </section>
  );
}
