// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Project } from '../api';
import type { ApiResult } from '../api-call';
import { ProjectProperties } from '../components/ProjectProperties';
import { PublicationPanel } from './PublicationPanel';
import { publicProjectsApi, type ProjectPublicationStatus, type PublicationMetadata } from './api';
import { studentPublicationAuthorApi, type ReviewRequest } from './student-publication-review-api';

let host: HTMLDivElement;
let root: Root;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
const projectId = '123e4567-e89b-42d3-a456-426614174001';
const publicationId = '123e4567-e89b-42d3-a456-426614174002';
const revisionId = '123e4567-e89b-42d3-a456-426614174003';
const metadata: PublicationMetadata = {
  title: 'Маршрут робота',
  description: 'Поле с препятствиями',
  tags: ['robotics'],
  license: 'public-domain',
};
function status(allowed = false): ProjectPublicationStatus {
  return {
    publication: {
      publicationId,
      revisionId,
      revisionNo: 1,
      versionNo: 1,
      state: 'public',
      publishedAt: '2026-11-05T00:00:00Z',
      publicPath: `#/public-projects/${publicationId}`,
    },
    canPublish: true,
    reasonCode: null,
    acquisition: { allowed, version: 7 },
  };
}
function response(data: ProjectPublicationStatus): ApiResult<ProjectPublicationStatus> {
  return { ok: true, status: 200, data };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom has no layout scrolling; real focus/scroll remains covered by the browser journey.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(publicProjectsApi, 'status').mockResolvedValue(response(status()));
  vi.spyOn(publicProjectsApi, 'publish').mockResolvedValue(response(status()));
  vi.spyOn(publicProjectsApi, 'setAcquisition').mockResolvedValue(
    response({
      ...status(),
      acquisition: { allowed: false, version: 8 },
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  if (originalScrollIntoView)
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(moduleKey?: string, sourceRevision: number | null = null) {
  await act(async () =>
    root.render(
      createElement(PublicationPanel, {
        projectId,
        sourceRevision,
        ...(moduleKey === undefined ? {} : { moduleKey }),
        metadata,
        disabled: false,
        onBusyChange: vi.fn(),
      }),
    ),
  );
}
async function publish() {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="publication-publish"]')!.click(),
  );
}

it('submits the saved revision and publishes only after the approved request is refreshed', async () => {
  const owner = { ...status(), publication: null, requiresApproval: true as const };
  vi.mocked(publicProjectsApi.status).mockResolvedValue(response(owner));
  const candidate: ReviewRequest = {
    requestId: revisionId,
    state: 'waiting_teacher',
    sourceRevision: 2,
    moduleKey: 'electronics',
    metadata,
  };
  const current = vi.spyOn(studentPublicationAuthorApi, 'current').mockResolvedValue({
    ok: true,
    status: 200,
    data: { request: null },
  });
  const submit = vi.spyOn(studentPublicationAuthorApi, 'submit').mockResolvedValue({
    ok: true,
    status: 200,
    data: candidate,
  });
  const approvedPublish = vi.spyOn(studentPublicationAuthorApi, 'publish').mockResolvedValue({
    ok: true,
    status: 200,
    data: { ...candidate, state: 'published' },
  });
  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((element) => element.textContent === text);
  await render('electronics', 2);
  await act(async () => {
    await import('./StudentPublicationAuthor');
  });
  expect(button('Отправить на одобрение')?.disabled).toBe(false);
  expect(host.querySelector('[data-testid="publication-publish"]')).toBeNull();
  await act(async () => button('Отправить на одобрение')!.click());
  expect(submit).toHaveBeenCalledExactlyOnceWith(
    projectId,
    2,
    metadata,
    expect.any(String),
    expect.any(AbortSignal),
  );
  expect(button('Отправить на одобрение')?.disabled).toBe(true);
  expect(approvedPublish).not.toHaveBeenCalled();
  current.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      request: {
        ...candidate,
        state: 'approved',
      },
    },
  });
  await act(async () => button('Обновить статус заявки')!.click());
  await expect(button('Опубликовать одобренную версию')?.disabled).toBe(false);
  current.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      request: {
        ...candidate,
        state: 'published',
      },
    },
  });
  await act(async () => button('Опубликовать одобренную версию')!.click());
  expect(approvedPublish).toHaveBeenCalledExactlyOnceWith(
    projectId,
    revisionId,
    expect.any(AbortSignal),
  );
  expect(publicProjectsApi.publish).not.toHaveBeenCalled();
});

it('retains Seat approval after consent and revocation and describes the past receipt', async () => {
  const owner = { ...status(), requiresApproval: true as const };
  vi.mocked(publicProjectsApi.status).mockResolvedValue(response(owner));
  vi.spyOn(publicProjectsApi, 'setAcquisition').mockResolvedValue(
    response({ ...status(), acquisition: { allowed: true, version: 8 } }),
  );
  vi.spyOn(publicProjectsApi, 'revoke').mockResolvedValue(
    response({
      ...status(),
      publication: { ...owner.publication!, state: 'revoked', publicPath: null },
    }),
  );
  vi.spyOn(studentPublicationAuthorApi, 'current').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      request: {
        requestId: revisionId,
        state: 'published',
        sourceRevision: 1,
        moduleKey: 'electronics',
        metadata,
      },
    },
  });
  const directPublish = () => host.querySelector('[data-testid="publication-publish"]');
  const click = async (selector: string) =>
    act(async () => host.querySelector<HTMLElement>(selector)!.click());

  await render('electronics', 2);
  await act(async () => {
    await import('./StudentPublicationAuthor');
  });
  expect(host.textContent).toContain('Одобренная версия опубликована.');
  expect(directPublish()).toBeNull();
  await click('input[type="checkbox"]');
  expect(publicProjectsApi.setAcquisition).toHaveBeenCalledExactlyOnceWith(
    projectId,
    true,
    7,
    revisionId,
  );
  expect(directPublish()).toBeNull();
  await click('[data-testid="publication-revoke"]');
  await click('[data-testid="publication-revoke-confirm"]');
  expect(publicProjectsApi.revoke).toHaveBeenCalledExactlyOnceWith(projectId);
  expect(host.textContent).toContain('Снято с публикации');
  expect(host.textContent).toContain('Эта версия ранее была опубликована.');
  expect(host.textContent).not.toContain('Одобренная версия опубликована.');
  expect(host.textContent).toContain('Отправить на одобрение');
  expect(directPublish()).toBeNull();
  expect(publicProjectsApi.publish).not.toHaveBeenCalled();
  expect(publicProjectsApi.status).toHaveBeenCalledTimes(1);
});

it.each([
  ['classroom_safe_mode', 'Безопасный режим запрещает публикацию этой работы.'],
  ['publication_forbidden', 'Публикация этой работы ограничена настройками доступа.'],
])('explains the actual publication restriction %s', async (reasonCode, message) => {
  const banned = status();
  vi.mocked(publicProjectsApi.status).mockResolvedValue(
    response({
      ...banned,
      publication: { ...banned.publication!, publicPath: null },
      canPublish: false,
      reasonCode,
    }),
  );
  await render('electronics');
  expect(host.querySelector('[data-testid="publication-permission"]')?.textContent).toBe(message);
  expect(
    host.querySelector<HTMLButtonElement>('[data-testid="publication-publish"]')?.disabled,
  ).toBe(true);
  expect(publicProjectsApi.publish).not.toHaveBeenCalled();
});

it('receives Robotics identity through ProjectProperties and describes only the public view', async () => {
  const project = { id: projectId, moduleKey: 'robotics', ...metadata } as Project;
  await act(async () =>
    root.render(
      createElement(ProjectProperties, {
        project,
        onClose: vi.fn(),
        onSaved: vi.fn(),
        initialSection: 'publication',
      }),
    ),
  );
  const help = host.querySelector('.publication-help')?.textContent;
  expect(help).toContain('сохранённое поле и конструкция робота');
  expect(help).not.toMatch(/Arduino|просмотра и запуска/);
  expect(host.querySelector('.publication-panel input[type="checkbox"]')).toBeNull();
  await publish();
  expect(publicProjectsApi.publish).toHaveBeenCalledWith(projectId, metadata);
  expect(publicProjectsApi.setAcquisition).not.toHaveBeenCalled();
});

it('waits for confirmed false consent before publishing Robotics when the stored value was true', async () => {
  vi.mocked(publicProjectsApi.status).mockResolvedValue(response(status(true)));
  let settle: ((value: ApiResult<ProjectPublicationStatus>) => void) | undefined;
  vi.mocked(publicProjectsApi.setAcquisition).mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  await render('robotics');
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  await publish();
  expect(publicProjectsApi.setAcquisition).toHaveBeenCalledExactlyOnceWith(
    projectId,
    false,
    7,
    revisionId,
  );
  expect(publicProjectsApi.publish).not.toHaveBeenCalled();
  await act(async () => {
    if (!settle) throw Error('consent request missing');
    settle(response({ ...status(), acquisition: { allowed: false, version: 8 } }));
  });
  expect(publicProjectsApi.publish).toHaveBeenCalledExactlyOnceWith(projectId, metadata);
  expect(vi.mocked(publicProjectsApi.setAcquisition).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(publicProjectsApi.publish).mock.invocationCallOrder[0]!,
  );
});

it.each([
  { ok: false, status: 409, error: { code: 'publication_changed', message: 'Changed' } },
  response(status(true)),
  response({ ...status(), publication: { ...status().publication!, revisionId: projectId } }),
] satisfies ApiResult<ProjectPublicationStatus>[])(
  'refuses to publish Robotics after a conflict or unconfirmed acquisition change (%#)',
  async (result) => {
    vi.mocked(publicProjectsApi.status).mockResolvedValue(response(status(true)));
    vi.mocked(publicProjectsApi.setAcquisition).mockResolvedValue(result);
    await render('robotics');
    await publish();
    expect(publicProjectsApi.publish).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="publication-error"]')).not.toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="publication-publish"]')?.disabled,
    ).toBe(false);
  },
);

it.each(['electronics', undefined])(
  'keeps the existing program explanation and consent behavior for %s',
  async (moduleKey) => {
    vi.mocked(publicProjectsApi.status).mockResolvedValue(response(status(true)));
    await render(moduleKey);
    expect(host.querySelector('.publication-help')?.textContent).toContain(
      'Если есть программа Arduino',
    );
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    await publish();
    expect(publicProjectsApi.publish).toHaveBeenCalledExactlyOnceWith(projectId, metadata);
    expect(publicProjectsApi.setAcquisition).not.toHaveBeenCalled();
  },
);

it('keeps an explicit supported-module consent request with its exact version and revision', async () => {
  vi.mocked(publicProjectsApi.setAcquisition).mockResolvedValue(
    response({
      ...status(true),
      acquisition: { allowed: true, version: 8 },
    }),
  );
  await render('electronics');
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(publicProjectsApi.setAcquisition).toHaveBeenCalledExactlyOnceWith(
    projectId,
    true,
    7,
    revisionId,
  );
  expect(publicProjectsApi.publish).not.toHaveBeenCalled();
});
