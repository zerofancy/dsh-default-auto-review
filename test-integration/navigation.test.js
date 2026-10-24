import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installFreshSessionNavigation } from '../client-core.js';

const runtime = process.env.DSH_TEST_RUNTIME_ROOT;
if (!runtime) throw new Error('DSH_TEST_RUNTIME_ROOT is required.');
const { Context, Service } = await import(pathToFileURL(resolve(runtime, 'node_modules/@deepseek-ai/cordis/lib/index.js')).href);
const source = await readFile(resolve(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8');
function method(start, end) {
  const begin = source.indexOf(start), finish = source.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, `installed navigation method ${start}`);
  return source.slice(begin, finish).trim();
}
const definitions = [
  method('async connectBlank(workspaceId, reuse) {', 'createInWorkspace(workspace, options) {'),
  method('createInWorkspace(workspace, options) {', 'async createNamed(request) {'),
  method('async createNamed(request) {', 'async restoreBlank(workspaceId, sessionId) {'),
  method('openWorkspace(workspaceId, beforeOpen, options = {}) {', 'async openWorkspaceSession(workspaceId, beforeOpen, reuse) {'),
  method('async openWorkspaceSession(workspaceId, beforeOpen, reuse) {', 'async forkSession(sessionId, onCreated, options) {'),
  method('startSession(workspaceId, options) {', 'prepareDraft(binding, options) {'),
  method('prepareDraft(binding, options) {', 'draftPreparationFailed() {'),
].join(',\n');
const installedMethods = Function('recentWorkspace', 'creationFailureMessage', `return {${definitions}}`)(
  items => items[0]?.workspaceId, reason => String(reason));

function fixture() {
  const ctx = new Context(), requests = [], notices = [], drafts = [], opened = [];
  const workspace = { workspaceId: 'workspace-1', path: 'C:\\project', sessionIds: ['old-blank'] };
  const summaries = { phase: 'ready', ids: ['old-blank'], byId: {
    'old-blank': { id: 'old-blank', blank: true, cwd: workspace.path, projectionValues: { agentPreset: 'standard', permissions: { currentValue: 'workspace-write' } } },
  } };
  const sessions = {
    list: { getSnapshot: () => summaries },
    async create(request) { requests.push(request); return request.sessionId ?? `new-${requests.length}`; },
    refreshProjections: async () => {}, binding: id => ({ id }),
  };
  let navigation = new AbortController();
  ctx.provide('sessions', sessions);
  ctx.provide('layout', { beginNavigation: () => navigation.signal });
  ctx.provide('conversation', { input: { requestDraftInitialization(binding, options) { drafts.push({ binding, options }); return 'ready'; } } });
  ctx.provide('locale', { bind: () => () => 'workspace required' });
  class Ui extends Service {
    constructor(ctx) {
      super(ctx, 'uiWorkspace');
      Object.assign(this, installedMethods, {
        workspaces: { list: { getSnapshot: () => ({ phase: 'ready', items: [workspace], archivedSessionIds: [] }) } },
        sessions, connecting: new Map(), lifetime: new AbortController(), mainReference: { sessionId: 'old-blank' },
        notify: notice => notices.push(notice),
        replaceMain(id, signal, mode, beforeOpen) { beforeOpen?.(id); opened.push(id); },
        clearMain() { opened.push(null); },
      });
    }
  }
  const ui = new Ui(ctx);
  return { ctx, ui, sessions, requests, notices, drafts, opened, summaries,
    cancel() { navigation.abort(); }, resetNavigation() { navigation = new AbortController(); },
    async settle() { for (let n = 0; n < 12; n++) await Promise.resolve(); },
    async dispose() { await ctx.fiber.dispose(); await ctx.fiber.await(); },
  };
}

test('actual installed UI without fix reuses workspace-write blank', async () => {
  const f = fixture();
  try { f.ui.startSession('workspace-1'); await f.settle();
    assert.equal(f.requests[0].sessionId, 'old-blank'); assert.deepEqual(f.opened, ['old-blank']);
  } finally { await f.dispose(); }
});

test('fixed installed UI mints a distinct session and leaves old blank untouched', async () => {
  const f = fixture();
  try {
    const before = JSON.stringify(f.summaries);
    const stop = installFreshSessionNavigation(f.ctx);
    f.ctx.uiWorkspace.startSession('workspace-1'); await f.settle();
    assert.deepEqual(f.requests, [{ workspaceId: 'workspace-1' }]);
    assert.deepEqual(f.opened, ['new-1']); assert.equal(JSON.stringify(f.summaries), before);
    stop();
  } finally { await f.dispose(); }
});

test('fixed installed UI preserves preset, original draft initialization and workspace fallback', async () => {
  const f = fixture();
  try { const stop = installFreshSessionNavigation(f.ctx);
    f.ctx.uiWorkspace.startSession(undefined, { agentPreset: 'standard', prompt: 'draft only', whenDraftExists: 'replace' });
    await f.settle();
    assert.deepEqual(f.requests, [{ workspaceId: 'workspace-1', agentPreset: 'standard' }]);
    assert.deepEqual(f.drafts, [{ binding: { id: 'new-1' }, options: { prompt: 'draft only', whenDraftExists: 'replace' } }]); stop();
  } finally { await f.dispose(); }
});

test('fixed installed UI joins duplicate explicit-new clicks, but never an old restore attempt', async () => {
  const f = fixture();
  try {
    f.ui.connecting.set('workspace-1', { agentPreset: undefined, attempt: Promise.resolve('old-blank') });
    const stop = installFreshSessionNavigation(f.ctx);
    f.ctx.uiWorkspace.startSession('workspace-1'); f.ctx.uiWorkspace.startSession('workspace-1');
    await f.settle(); assert.equal(f.requests.length, 1); assert.equal(f.requests[0].sessionId, undefined);
    f.ctx.uiWorkspace.startSession('workspace-1'); await f.settle(); assert.equal(f.requests.length, 2); stop();
  } finally { await f.dispose(); }
});

test('fixed installed UI retains navigation cancellation and ordinary restoration reuse', async () => {
  const f = fixture();
  try { const stop = installFreshSessionNavigation(f.ctx);
    f.ctx.uiWorkspace.startSession('workspace-1'); f.cancel(); await f.settle(); assert.deepEqual(f.opened, []);
    f.resetNavigation();
    const restored = await f.ctx.uiWorkspace.connectBlank('workspace-1', {});
    assert.equal(restored, 'old-blank'); assert.equal(f.requests.at(-1).sessionId, 'old-blank'); stop();
  } finally { await f.dispose(); }
});

test('stopping navigation shim restores original reuse exactly', async () => {
  const f = fixture();
  try { const start = Object.getOwnPropertyDescriptor(f.ui, 'startSession').value;
    const connect = Object.getOwnPropertyDescriptor(f.ui, 'connectBlank').value;
    const stop = installFreshSessionNavigation(f.ctx); stop();
    assert.equal(Object.getOwnPropertyDescriptor(f.ui, 'startSession').value, start);
    assert.equal(Object.getOwnPropertyDescriptor(f.ui, 'connectBlank').value, connect);
    f.ctx.uiWorkspace.startSession('workspace-1'); await f.settle(); assert.equal(f.requests[0].sessionId, 'old-blank');
  } finally { await f.dispose(); }
});
