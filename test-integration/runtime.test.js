import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as plugin from '../index.js';

// Run with the installed Electron executable in ELECTRON_RUN_AS_NODE mode so
// imports use the installed ASAR packages rather than extracted mock copies.
const root = process.env.DSH_TEST_RUNTIME_ROOT;
if (!root) throw new Error('Set DSH_TEST_RUNTIME_ROOT to the installed app.asar/dsh directory.');
const load = (name, path = 'lib/index.js') => import(pathToFileURL(resolve(root, 'node_modules', '@deepseek-ai', name, path)).href);
const [{ Context }, { default: Sessions }, { default: Projections },
  { default: Permissions }, { default: Agents }] = await Promise.all([
    load('cordis'), load('dsh-session'), load('dsh-session-projection'),
    load('dsh-permission-presets'), load('dsh-agent'),
  ]);
const autoReview = await load('dsh-experimental-auto-review');

async function fixture({ auto = true, install = true } = {}) {
  const ctx = new Context();
  ctx.provide('shell', { sandboxMode: 'workspace-write' });
  ctx.provide('approval', { config: { policy: 'ask' }, overrideOf: () => 'ask' });
  ctx.provide('llm', {}); ctx.provide('tools', {}); ctx.provide('workingDirectory', {});
  await ctx.plugin(Sessions); await ctx.plugin(Projections); await ctx.plugin(Agents);
  await ctx.plugin(Permissions);
  if (auto) await ctx.plugin(autoReview);
  const installation = install ? await ctx.plugin(plugin) : undefined;
  return { ctx, installation, dispose: async () => { await ctx.fiber.dispose(); await ctx.fiber.await(); } };
}
async function publish(ctx, s, source = 'startup') {
  const agent = { id: s.id, session: s, ctx, status: 'idle' };
  const detach = ctx.agents.enter(agent, undefined);
  await ctx.agents.announce(agent, source);
  return { agent, detach };
}
const state = (ctx, s) => ctx.sessionProjections.stateOf(s, 'permissions');

test('installed services: official Auto is selected and persisted before later creation listeners', async () => {
  const f = await fixture();
  try {
    const s = f.ctx.sessions.create('new-conversation');
    assert.equal(f.ctx.permissionPresets.current(s), 'workspace-write');
    let laterRan = false;
    f.ctx.on('agent/created', () => {
      laterRan = true;
      assert.equal(f.ctx.permissionPresets.current(s), 'auto');
    });
    await publish(f.ctx, s);
    assert.equal(laterRan, true, 'plugin must not bail the serial creation chain');
    assert.deepEqual(state(f.ctx, s), { preset: 'auto', sandbox: 'danger-full-access', approval: 'ask', seeded: false });
    assert.equal(s.snapshotEvents().some(e => e.type === 'permission/preset' && e.data.preset === 'auto'), true);
    f.ctx.permissionPresets.set(s, 'workspace-write');
    assert.equal(f.ctx.permissionPresets.current(s), 'workspace-write');
  } finally { await f.dispose(); }
});

test('installed services: restored empty log is not treated as a new session', async () => {
  const f = await fixture();
  try {
    const s = f.ctx.sessions.create('restored-empty', { seed: [] });
    assert.equal(s.firstLiveSeq, 0);
    assert.equal(state(f.ctx, s).seeded, true);
    await publish(f.ctx, s, 'resume');
    assert.equal(f.ctx.permissionPresets.current(s), 'workspace-write');
  } finally { await f.dispose(); }
});

test('installed services: nonempty restored and seeded child sessions retain permissions', async () => {
  const f = await fixture();
  try {
    const base = f.ctx.sessions.create('original');
    const seed = base.snapshotEvents();
    const restored = f.ctx.sessions.create('restored', { seed });
    await publish(f.ctx, restored, 'resume');
    assert.equal(f.ctx.permissionPresets.current(restored), 'workspace-write');
    const child = f.ctx.sessions.create('child', { seed,
      inheritedEventCount: seed.length,
      meta: { parentSession: base.id, origin: 'subagent', delegationDepth: 1, isSeeded: true } });
    await publish(f.ctx, child);
    assert.equal(f.ctx.permissionPresets.current(child), 'workspace-write');
    const freshChild = f.ctx.sessions.create('unseeded-child', {
      meta: { parentSession: base.id, origin: 'subagent', delegationDepth: 1 } });
    await publish(f.ctx, freshChild);
    assert.equal(f.ctx.permissionPresets.current(freshChild), 'workspace-write');
  } finally { await f.dispose(); }
});

test('installed services: startup setup permission change, including change-back, wins', async () => {
  const f = await fixture();
  try {
    const s = f.ctx.sessions.create('explicit');
    f.ctx.permissionPresets.set(s, 'danger-full-access');
    f.ctx.permissionPresets.set(s, 'workspace-write');
    await publish(f.ctx, s);
    assert.equal(f.ctx.permissionPresets.current(s), 'workspace-write');
  } finally { await f.dispose(); }
});

test('installed services: hot installation does not touch already attached blank sessions', async () => {
  const f = await fixture({ install: false });
  try {
    const s = f.ctx.sessions.create('old-blank');
    await f.ctx.plugin(plugin);
    await publish(f.ctx, s);
    assert.equal(f.ctx.permissionPresets.current(s), 'workspace-write');
    const next = f.ctx.sessions.create('next'); await publish(f.ctx, next);
    assert.equal(f.ctx.permissionPresets.current(next), 'auto');
  } finally { await f.dispose(); }
});

test('installed services: unavailable Auto preserves canonical default', async () => {
  const f = await fixture({ auto: false });
  try {
    const s = f.ctx.sessions.create('without-auto'); await publish(f.ctx, s);
    assert.equal(f.ctx.permissionPresets.current(s), 'workspace-write');
  } finally { await f.dispose(); }
});

test('installed services: stopping preference plugin affects only future sessions', async () => {
  const f = await fixture();
  try {
    const s = f.ctx.sessions.create('before-disable'); await publish(f.ctx, s);
    assert.equal(f.ctx.permissionPresets.current(s), 'auto');
    await f.installation.dispose(); await f.installation.await();
    assert.equal(f.ctx.permissionPresets.current(s), 'auto');
    const next = f.ctx.sessions.create('after-disable'); await publish(f.ctx, next);
    assert.equal(f.ctx.permissionPresets.current(next), 'workspace-write');
  } finally { await f.dispose(); }
});
