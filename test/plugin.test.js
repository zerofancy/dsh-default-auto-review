import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
import { isFreshTopLevelSession, isPristinePermissionState } from '../core.js';

function session(overrides = {}) {
  return { header: { version: 4, isSeeded: false }, firstLiveSeq: 0,
    firstLifecycleSeq: 0, inheritedEventCount: 0, ...overrides };
}
const empty = () => ({ preset: null, sandbox: null, approval: null, seeded: false });
const initial = () => ({ preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask', seeded: false });
function harness({ ready = true, failAdmission = false } = {}) {
  const listeners = new Map(), states = new WeakMap(), warnings = [], writes = [];
  const ctx = {
    on(name, fn, options) {
      const list = listeners.get(name) ?? [];
      options?.prepend ? list.unshift(fn) : list.push(fn);
      listeners.set(name, list);
      return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    },
    logger: () => ({ info() {}, warn: text => warnings.push(text) }),
    sessionProjections: { stateOf: s => states.get(s) },
    permissionPresets: {
      names: ready ? ['workspace-write', 'auto'] : ['workspace-write'],
      defaultPreset: 'workspace-write',
      resolve: () => ({ sandbox: 'workspace-write', approval: 'ask' }),
      set(s, value) {
        if (failAdmission) throw new Error('integration is closing');
        writes.push({ session: s, value });
        states.set(s, { preset: value, sandbox: 'danger-full-access', approval: 'ask', seeded: false });
      },
    },
  };
  // Register the real core's relevant default behavior before the plugin.
  ctx.on('session/created', s => {
    if (isPristinePermissionState(states.get(s))) states.set(s, initial());
  });
  apply(ctx);
  function emit(name, ...args) {
    for (const fn of [...listeners.get(name) ?? []]) {
      const result = fn(...args);
      assert.equal(result instanceof Promise, false, 'creation listeners must not defer');
    }
  }
  return { ctx, states, warnings, writes, emit,
    create(s = session(), state = empty()) { states.set(s, state); emit('session/created', s); return s; },
    start(s, source = 'startup', extra = {}) { emit('agent/created', { agent: { session: s }, source, ...extra }); },
  };
}

test('new ordinary conversation selects real Auto exactly once', () => {
  const h = harness(), s = h.create();
  assert.deepEqual(h.states.get(s), initial(), 'no mutation before agent publication');
  h.start(s);
  assert.equal(h.states.get(s).preset, 'auto');
  assert.equal(h.writes.length, 1);
  h.start(s);
  assert.equal(h.writes.length, 1);
});

for (const [name, changes] of [
  ['restored nonempty log', { firstLiveSeq: 9, firstLifecycleSeq: 9 }],
  ['fork', { header: { version: 4, isSeeded: true }, inheritedEventCount: 4 }],
  ['durable parent', { header: { version: 4, isSeeded: false, parentSession: 'parent' } }],
  ['subagent origin', { header: { version: 4, isSeeded: false, origin: 'subagent' } }],
  ['delegation depth even zero', { header: { version: 4, isSeeded: false, delegationDepth: 0 } }],
  ['unknown session format', { header: { version: 5, isSeeded: false } }],
  ['missing offsets', { firstLiveSeq: undefined }],
  ['nonzero lifecycle', { firstLifecycleSeq: 1 }],
]) test(`preserves ${name}`, () => {
  const h = harness(), s = h.create(session(changes));
  h.start(s);
  assert.equal(h.writes.length, 0);
});

for (const [name, state] of [
  ['empty-log restore marker', { ...empty(), seeded: true }],
  ['explicit preset', { ...empty(), preset: 'workspace-write' }],
  ['explicit sandbox', { ...empty(), sandbox: 'read-only' }],
  ['explicit approval', { ...empty(), approval: 'never' }],
  ['missing permission projection', undefined],
]) test(`preserves ${name}`, () => {
  const h = harness(), s = session();
  h.states.set(s, state); h.emit('session/created', s); h.start(s);
  assert.equal(h.writes.length, 0);
});

for (const source of ['resume', 'clear', 'compact', undefined]) test(`does not select for source ${String(source)}`, () => {
  const h = harness(), s = h.create();
  h.emit('agent/created', { agent: { session: s }, source });
  assert.equal(h.writes.length, 0);
  h.start(s);
  assert.equal(h.writes.length, 0, 'candidate already consumed');
});

test('already loaded sessions are never enumerated or modified', () => {
  const h = harness(), s = session(); h.states.set(s, initial()); h.start(s);
  assert.equal(h.writes.length, 0);
});

test('permission change between creation and startup is preserved, even changed back', () => {
  const h = harness(), s = h.create();
  h.states.set(s, { ...initial(), preset: 'danger-full-access' });
  h.states.set(s, initial()); // Same values, different state identity.
  h.start(s);
  assert.equal(h.writes.length, 0);
});

test('non-default initialization by another plugin is preserved', () => {
  const h = harness();
  h.ctx.on('session/created', s => h.states.set(s, { ...initial(), approval: 'never' }), { prepend: true });
  const s = h.create(); h.start(s);
  assert.equal(h.writes.length, 0);
});

test('unrelated events retaining the permission projection do not prevent Auto', () => {
  const h = harness(), s = h.create(); s.unrelated = true; h.start(s);
  assert.equal(h.writes.length, 1);
});

test('manual choices after startup and blank reuse are not reasserted', () => {
  const h = harness(), s = h.create(); h.start(s);
  h.states.set(s, initial()); // User deliberately chooses workspace-write.
  h.start(s, 'resume'); h.start(s);
  assert.equal(h.states.get(s).preset, 'workspace-write');
  assert.equal(h.writes.length, 1);
});

test('unavailable Auto preserves defaults and warns only once', () => {
  const h = harness({ ready: false });
  const first = h.create(); h.start(first);
  const second = h.create(); h.start(second);
  assert.equal(h.writes.length, 0); assert.equal(h.warnings.length, 1);
  h.ctx.permissionPresets.names.push('auto'); h.start(first);
  assert.equal(h.writes.length, 0, 'no retroactive retry');
  h.start(h.create()); assert.equal(h.writes.length, 1);
});

test('aborted startup does not change permissions', () => {
  const h = harness(), s = h.create();
  h.start(s, 'startup', { signal: AbortSignal.abort() });
  assert.equal(h.writes.length, 0);
});

test('official admission failure propagates instead of bypassing safety', () => {
  const h = harness({ failAdmission: true }), s = h.create();
  assert.throws(() => h.start(s), /integration is closing/);
  assert.equal(h.states.get(s).preset, 'workspace-write');
});

test('disposed candidates cannot be changed later', () => {
  const h = harness(), s = h.create(); h.emit('session/disposed', s); h.start(s);
  assert.equal(h.writes.length, 0);
});

test('fresh identity predicate is conservative on malformed input', () => {
  assert.equal(isFreshTopLevelSession(null), false);
  assert.equal(isFreshTopLevelSession({}), false);
});
