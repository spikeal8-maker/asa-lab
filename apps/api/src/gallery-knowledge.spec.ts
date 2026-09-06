import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { GalleryController } from './gallery.controller.js';
const ID = '123e4567-e89b-42d3-a456-426614174000';
const request = { cookies: { asa_session: 'test' } } as unknown as FastifyRequest;
function setup(rows: unknown[] = [], authenticated = true) {
  const query = vi.fn(async () => ({ rows }));
  const resolve = vi.fn(async () => (authenticated ? { principalId: ID, accountId: ID } : null));
  return {
    query,
    value: new GalleryController(
      { resolve } as unknown as ActiveContextUseCase,
      {} as AccountDirectoryPort,
      { query } as unknown as pg.Pool,
    ),
  };
}
describe('public knowledge boundary', () => {
  it('does not query the catalogue for an anonymous request', async () => {
    const { value, query } = setup([], false);
    await expect(value.knowledge(request)).rejects.toMatchObject({ status: 401 });
    expect(query).not.toHaveBeenCalled();
  });
  it('limits the home response and excludes private/school/teacher shares in SQL', async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      id: String(i),
      title: 'Published',
      summary: null,
      author_name: 'Author',
      created_at: '2026-09-06',
      item_count: 3,
    }));
    const { value, query } = setup(rows);
    const result = await value.knowledge(request, '0', '10');
    expect(result.items).toHaveLength(10);
    expect(result.nextOffset).toBe(10);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("kind = 'course' AND visibility = 'public'"),
      [ID, 11, 0],
    );
  });
  it('does not interpolate pagination into SQL or accept unbounded limits', async () => {
    const { value, query } = setup();
    await value.knowledge(request, '-1;DELETE', '9999999');
    expect(query).toHaveBeenCalledWith(expect.any(String), [ID, 25, 0]);
  });
  it('checks public visibility in the same query as the immutable outline', async () => {
    const { value, query } = setup();
    await expect(value.knowledgeCourse(request, ID)).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("entry.visibility = 'public'"), [
      ID,
      ID,
    ]);
  });
  it('rejects malformed direct IDs before querying', async () => {
    const { value, query } = setup();
    await expect(value.knowledgeCourse(request, '../private')).rejects.toMatchObject({
      status: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });
  it('does not send teacher assignment payloads or answer keys to learners', async () => {
    const { value } = setup([
      {
        version_number: 1,
        title: 'Published',
        summary: null,
        published_at: '2026-09-06',
        outline: {
          sections: [
            {
              title: 'Section',
              lessons: [
                {
                  title: 'Lesson',
                  kind: 'assignment',
                  assignment: { answerKey: 'secret' },
                  blocks: [{ id: 'a', type: 'paragraph', text: 'Read this' }],
                },
              ],
            },
          ],
        },
      },
    ]);
    const result = await value.knowledgeCourse(request, ID);
    expect(result.sections[0]?.lessons[0]?.blocks).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('answerKey');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
