// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AI_CHAT_TOOLS, AI_TOOL_ACTIVITY_LABELS } from '@asa-lab/contracts';
import { AiActivity } from './AiActivity';

afterEach(() => vi.unstubAllGlobals());
it('announces every tool without exposing request payloads or provider details', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    for (const tool of AI_CHAT_TOOLS) {
      await act(async () => root.render(createElement(AiActivity, { tool })));
      expect(host.querySelector('[role=status]')?.textContent).toContain(
        AI_TOOL_ACTIVITY_LABELS[tool],
      );
      expect(host.querySelector('.ai-activity-canvas')).toBeNull();
    }
    await act(async () => root.render(createElement(AiActivity, { image: true, imageSize: 864 })));
    expect(host.querySelector<HTMLElement>('.ai-activity-canvas')?.style.aspectRatio).toBe(
      '864 / 1536',
    );
    expect(host.querySelectorAll('.ai-activity-orb')).toHaveLength(3);
    expect(host.textContent).toContain('Создаю изображение');
    expect(host.textContent).not.toContain('%');
  } finally {
    await act(async () => root.unmount());
  }
});
