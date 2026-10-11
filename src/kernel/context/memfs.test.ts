import { describe, it, expect, beforeAll } from 'vitest';
import { openDB } from '../storage/db';
import { runMemoryCommand, memoryIndex } from './memfs';

beforeAll(() => { openDB([]); });

describe('memfs', () => {
  it('supports the full command set on one global /memories tree', async () => {
    expect(await memoryIndex()).toBe('');
    await runMemoryCommand({ command: 'create', path: '/memories/user.md', file_text: '# 对方\n喜欢雨天' });
    expect(await runMemoryCommand({ command: 'view', path: '/memories/user.md' })).toBe('1: # 对方\n2: 喜欢雨天');
    await runMemoryCommand({ command: 'str_replace', path: '/memories/user.md', old_str: '雨天', new_str: '雪天' });
    await runMemoryCommand({ command: 'insert', path: '/memories/user.md', insert_line: 1, insert_text: '名字：阿天' });
    expect(await runMemoryCommand({ command: 'view', path: '/memories/user.md' })).toContain('2: 名字：阿天');
    expect(await runMemoryCommand({ command: 'view', path: '/memories' })).toContain('/memories/user.md');
    expect(await memoryIndex()).toContain('user.md');
    await runMemoryCommand({ command: 'rename', path: '/memories/user.md', old_path: '/memories/user.md', new_path: '/memories/u.md' });
    await expect(runMemoryCommand({ command: 'view', path: '/memories/user.md' })).rejects.toThrow();
    await runMemoryCommand({ command: 'delete', path: '/memories/u.md' });
    expect(await memoryIndex()).toBe('');
  });
  it('rejects paths outside /memories', async () => {
    await expect(runMemoryCommand({ command: 'create', path: '/etc/passwd', file_text: '' })).rejects.toThrow();
    await expect(runMemoryCommand({ command: 'create', path: '/memories/../x', file_text: '' })).rejects.toThrow();
  });
});
