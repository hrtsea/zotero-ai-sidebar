import { beforeEach, describe, it, expect } from 'vitest';
import {
  MAX_CACHE_ENTRIES,
  cacheKey,
  setCachedTranslation,
  getCachedTranslation,
  translateCachePath,
} from '../../src/translate/cache';

let files: Map<string, string>;

beforeEach(() => {
  files = new Map();
  Object.defineProperty(globalThis, 'Zotero', {
    configurable: true,
    value: {
      DataDirectory: { dir: '/tmp/zotero-data' },
      Profile: { dir: '/tmp/zotero-profile' },
      File: {
        getContentsAsync: async (path: string) => {
          const value = files.get(path);
          if (value == null) throw new Error(`missing file: ${path}`);
          return value;
        },
        putContentsAsync: async (path: string, contents: string) => {
          files.set(path, contents);
        },
      },
    },
  });
});

describe('translate cache', () => {
  it('produces a stable 16-char key for same inputs', () => {
    const k1 = cacheKey({ sentence: 'Hello.', target: 'zh', endpoint: 'https://api.example.com', model: 'gpt-5.4', thinking: 'medium', ctxLevel: 'none' });
    const k2 = cacheKey({ sentence: 'Hello.', target: 'zh', endpoint: 'https://api.example.com', model: 'gpt-5.4', thinking: 'medium', ctxLevel: 'none' });
    expect(k1).toEqual(k2);
    expect(k1).toHaveLength(16);
  });

  it('produces different keys when any param changes', () => {
    const base = { sentence: 'Hello.', target: 'zh', endpoint: 'e', model: 'm', thinking: 't', ctxLevel: 'l' };
    const k1 = cacheKey(base);
    const k2 = cacheKey({ ...base, model: 'm2' });
    expect(k1).not.toEqual(k2);
  });

  it('round-trips through Zotero data directory storage', async () => {
    await setCachedTranslation('k1', { text: '你好。', model: 'gpt-5.4', createdAt: 1000 });
    const got = await getCachedTranslation('k1');
    expect(got?.text).toBe('你好。');
  });

  it('uses Windows separators when Zotero data directory is a Windows path', () => {
    Object.defineProperty(globalThis, 'Zotero', {
      configurable: true,
      value: {
        DataDirectory: { dir: 'C:\\Users\\admin\\Zotero' },
        Profile: { dir: 'C:\\Users\\admin\\AppData\\Roaming\\Zotero\\Zotero\\Profiles\\uerjpa0m.default' },
        File: {
          getContentsAsync: async () => {
            throw new Error('unused');
          },
          putContentsAsync: async () => undefined,
        },
      },
    });

    expect(translateCachePath()).toBe(
      'C:\\Users\\admin\\Zotero\\zotero-ai-sidebar-translate-cache.json',
    );
  });

  it('caps cache to MAX entries (oldest evicted)', async () => {
    for (let i = 0; i < 510; i++) {
      await setCachedTranslation(`k${i}`, { text: `t${i}`, model: 'm', createdAt: i });
    }
    const loaded = JSON.parse(files.get(translateCachePath()) || '{}') as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(loaded.entries).length).toBeLessThanOrEqual(MAX_CACHE_ENTRIES);
    expect(loaded.entries['k509']).toBeDefined();
    expect(loaded.entries['k0']).toBeUndefined();
  });
});
