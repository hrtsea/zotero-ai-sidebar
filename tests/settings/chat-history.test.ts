import { beforeEach, describe, expect, it } from 'vitest';
import { chatHistoryPath, loadChatMessages, saveChatMessages } from '../../src/settings/chat-history';

let stored = '{}';

beforeEach(() => {
  stored = '{}';
  Object.defineProperty(globalThis, 'Zotero', {
    configurable: true,
    value: {
      Profile: { dir: '/tmp/zotero-profile' },
      File: {
        getContentsAsync: async () => stored,
        putContentsAsync: async (_path: string, contents: string) => {
          stored = contents;
        },
      },
    },
  });
});

describe('chat history', () => {
  it('preserves screenshot attachments and agent context', async () => {
    await saveChatMessages(42, [
      {
        role: 'user',
        content: '分析截图',
        images: [
          {
            id: 'img-1',
            name: 'shot.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,abc',
            size: 3,
          },
        ],
        context: {
          selectedText: 'paper text',
          toolCalls: [
            {
              name: 'zotero_get_current_item',
              status: 'completed',
              summary: '读取当前条目',
            },
          ],
        },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'user',
        content: '分析截图',
        images: [
          {
            id: 'img-1',
            name: 'shot.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,abc',
            size: 3,
          },
        ],
        context: {
          selectedText: 'paper text',
          toolCalls: [
            {
              name: 'zotero_get_current_item',
              status: 'completed',
              summary: '读取当前条目',
            },
          ],
        },
      },
    ]);
  });

  it('preserves assistant annotation draft color', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: '解释正文',
        annotationDraft: {
          comment: '- 核心问题',
          color: '#ff6666',
          snapshot: {
            text: 'selected sentence',
            attachmentID: 7,
            annotation: { position: { pageIndex: 0, rects: [] } },
          },
          state: { kind: 'idle' },
          textState: { kind: 'saved', annotationID: 8, savedAt: 1234 },
        },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'assistant',
        content: '解释正文',
        annotationDraft: {
          comment: '- 核心问题',
          color: '#ff6666',
          snapshot: {
            text: 'selected sentence',
            attachmentID: 7,
            annotation: { position: { pageIndex: 0, rects: [] } },
          },
          state: { kind: 'idle' },
          textState: { kind: 'saved', annotationID: 8, savedAt: 1234 },
        },
      },
    ]);
  });

  it('preserves assistant token usage', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 1234, output: 56, cacheRead: 789 },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 1234, output: 56, cacheRead: 789 },
      },
    ]);
  });

  it('preserves missing cache usage as unknown', async () => {
    await saveChatMessages(42, [
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 100, output: 20 },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'assistant',
        content: '回答',
        usage: { input: 100, output: 20 },
      },
    ]);
  });

  it('preserves local task queue metadata', async () => {
    await saveChatMessages(42, [
      {
        role: 'user',
        content: '解释这句话',
        task: {
          id: 'task-1',
          kind: 'selection',
          title: '选中文字提问',
          promptPreview: 'While most robotic learning systems...',
          createdAt: 100,
          completedAt: 200,
          viewedAt: 300,
          pdfSelection: {
            attachmentID: 7,
            selectedText: 'While most robotic learning systems...',
            pageIndex: 0,
            pageLabel: '1',
            position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
          },
        },
      },
    ]);

    expect(await loadChatMessages(42)).toEqual([
      {
        role: 'user',
        content: '解释这句话',
        task: {
          id: 'task-1',
          kind: 'selection',
          title: '选中文字提问',
          promptPreview: 'While most robotic learning systems...',
          createdAt: 100,
          completedAt: 200,
          viewedAt: 300,
          pdfSelection: {
            attachmentID: 7,
            selectedText: 'While most robotic learning systems...',
            pageIndex: 0,
            pageLabel: '1',
            position: { pageIndex: 0, rects: [[1, 2, 3, 4]] },
          },
        },
      },
    ]);
  });

  it('uses Windows separators for data-dir and old profile migration paths', async () => {
    const newPath = 'C:\\Users\\admin\\Zotero\\zotero-ai-sidebar-chat-history.json';
    const oldPath =
      'C:\\Users\\admin\\AppData\\Roaming\\Zotero\\Zotero\\Profiles\\uerjpa0m.default\\zotero-ai-sidebar-chat-history.json';
    const reads: string[] = [];
    const writes: string[] = [];
    Object.defineProperty(globalThis, 'Zotero', {
      configurable: true,
      value: {
        DataDirectory: { dir: 'C:\\Users\\admin\\Zotero' },
        Profile: {
          dir: 'C:\\Users\\admin\\AppData\\Roaming\\Zotero\\Zotero\\Profiles\\uerjpa0m.default',
        },
        File: {
          getContentsAsync: async (path: string) => {
            reads.push(path);
            if (path === oldPath) {
              return JSON.stringify({
                'item:42': {
                  itemID: 42,
                  updatedAt: '2026-05-27T00:00:00.000Z',
                  messages: [{ role: 'user', content: 'old chat' }],
                },
              });
            }
            throw new Error(`missing file: ${path}`);
          },
          putContentsAsync: async (path: string, contents: string) => {
            writes.push(path);
            stored = contents;
          },
        },
      },
    });

    expect(chatHistoryPath()).toBe(newPath);
    expect(await loadChatMessages(42)).toEqual([{ role: 'user', content: 'old chat' }]);
    expect(reads).toEqual([newPath, oldPath]);
    expect(writes).toEqual([newPath]);
  });
});
