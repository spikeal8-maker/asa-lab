import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  WorkingFileStore,
  fencedFiles,
  validateFileCall,
  workingFileTools,
} from './ai-working-files';
import { parseNativeToolCalls } from './ai-native-tools';

describe('working file tools', () => {
  it('requires a current read before patching and writes only the matched fragment', async () => {
    const store = new WorkingFileStore({} as pg.Pool);
    const read = vi.spyOn(store, 'read').mockResolvedValue({
      id: 'file',
      name: 'snake.html',
      version: 2,
      content: '<h1>Snake</h1>',
      anchorRequestId: 'request',
      sourceMessageId: null,
      sourceBlock: null,
      updatedAt: '',
    });
    const write = vi
      .spyOn(store, 'write')
      .mockImplementation(async (...args) => ({ ...(await read()), version: 3, content: args[4] }));
    const reads = new Map<string, number>();
    const edit = {
      name: 'edit_working_file' as const,
      arguments: {
        name: 'snake.html',
        expectedVersion: 2,
        edits: [{ oldText: 'Snake', newText: 'Змейка' }],
      },
    };
    await expect(
      store.execute('owner', 'thread', 'request', edit, 0, [], reads),
    ).rejects.toMatchObject({ code: 'ai_file_read_required' });
    expect(write).not.toHaveBeenCalled();
    await store.execute(
      'owner',
      'thread',
      'request',
      { name: 'read_working_file', arguments: { name: 'snake.html', version: 1 } },
      0,
      [],
      reads,
    );
    expect(reads.size).toBe(0);
    await store.execute(
      'owner',
      'thread',
      'request',
      { name: 'read_working_file', arguments: { name: 'snake.html' } },
      1,
      [],
      reads,
    );
    expect(
      JSON.parse(await store.execute('owner', 'thread', 'request', edit, 2, [], reads)),
    ).toMatchObject({ saved: true, version: 3 });
    expect(write.mock.calls[0]?.slice(0, 5)).toEqual([
      'owner',
      'thread',
      'snake.html',
      2,
      '<h1>Змейка</h1>',
    ]);
    expect(reads.size).toBe(0);
  });
  it('adopts only a complete assistant code block from the supplied owned history', async () => {
    const store = new WorkingFileStore({} as pg.Pool);
    const write = vi.spyOn(store, 'write').mockResolvedValue({
      id: 'file',
      name: 'snake.html',
      version: 1,
      anchorRequestId: 'old',
      sourceMessageId: null,
      sourceBlock: null,
      updatedAt: '',
    });
    const id = '11111111-1111-4111-8111-111111111111';
    const call = {
      name: 'create_working_file' as const,
      arguments: { name: 'snake.html', sourceMessageId: id, blockIndex: 0 },
    };
    await expect(store.execute('owner', 'thread', 'new', call, 0, [], new Map())).rejects.toThrow();
    const messages = [
      {
        id,
        role: 'assistant',
        state: 'complete',
        requestId: 'old',
        content: '```html\n<h1>Snake</h1>\n```',
      },
    ];
    await store.execute('owner', 'thread', 'new', call, 0, messages, new Map());
    expect(write.mock.calls[0]?.slice(7, 10)).toEqual(['old', id, 0]);
    expect(write.mock.calls[0]?.[4]).toBe('<h1>Snake</h1>');
    await expect(
      store.execute(
        'owner',
        'thread',
        'new',
        call,
        0,
        [{ ...messages[0]!, state: 'stopped' }],
        new Map(),
      ),
    ).rejects.toThrow();
  });
  it('rejects paths, unknown properties and invalid versions before execution', () => {
    expect(validateFileCall('read_working_file', { name: '../secret.html' })).toBe(false);
    expect(validateFileCall('read_working_file', { name: 'snake.html', version: 101 })).toBe(false);
    expect(() =>
      parseNativeToolCalls(
        [
          {
            function: {
              name: 'read_working_file',
              arguments: { name: 'snake.html', shell: 'whoami' },
            },
          },
        ],
        workingFileTools(),
      ),
    ).toThrow();
    expect(fencedFiles('```html\nunfinished')).toEqual([]);
  });
});
