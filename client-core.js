/**
 * rc.3 navigation compatibility shim. Keep the original startSession pipeline
 * (workspace fallback, navigation cancellation, beforeOpen draft handling and
 * error notices). Only replace its synchronous connectBlank call with a fresh
 * public Session API request. Restoration/opening remain untouched.
 */
export function installFreshSessionNavigation(ctx) {
  const ui = ctx.uiWorkspace;
  const sessions = ctx.sessions;
  if (typeof ui.startSession !== 'function' || typeof ui.connectBlank !== 'function'
      || typeof ui.openWorkspaceSession !== 'function' || typeof sessions.create !== 'function') {
    throw new Error('default-auto-review: unsupported workspace navigation API');
  }
  // Service property reads may return Cordis function proxies. Descriptors
  // provide the actual implementation for ABI checks and exact restoration.
  function implementation(key) {
    for (let target = ui; target; target = Object.getPrototypeOf(target)) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor) return descriptor.value;
    }
  }
  const originalStart = implementation('startSession');
  const originalConnect = implementation('connectBlank');
  // This shim is deliberately tied to the synchronous rc.3 call chain. A future
  // asynchronous startSession must not accidentally reuse an old blank silently.
  if (!/this\.openWorkspace\(/.test(String(originalStart))
      || !/this\.connectBlank\(/.test(String(implementation('openWorkspaceSession')))) {
    throw new Error('default-auto-review: unsupported workspace navigation implementation');
  }
  const previousStart = Object.getOwnPropertyDescriptor(ui, 'startSession');
  const previousConnect = Object.getOwnPropertyDescriptor(ui, 'connectBlank');
  const pending = new Map();
  let depth = 0;
  let active = true;

  function startSession(...args) {
    if (!active) return Reflect.apply(originalStart, this, args);
    depth++;
    try { return Reflect.apply(originalStart, this, args); }
    finally { depth--; }
  }
  function connectBlank(workspaceId, options = {}) {
    if (!active || depth === 0) return Reflect.apply(originalConnect, this, arguments);
    const key = JSON.stringify([workspaceId, options.agentPreset ?? null]);
    if (pending.has(key)) return pending.get(key);
    // No sessionId: this must mint a new entity, never change the old blank.
    const request = { workspaceId,
      ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }) };
    const attempt = Promise.resolve().then(() => sessions.create(request)).finally(() => {
      if (pending.get(key) === attempt) pending.delete(key);
    });
    pending.set(key, attempt);
    return attempt;
  }
  Object.defineProperty(ui, 'startSession', { configurable: true, writable: true, value: startSession });
  Object.defineProperty(ui, 'connectBlank', { configurable: true, writable: true, value: connectBlank });

  return () => {
    active = false;
    for (const [key, wrapper, previous] of [
      ['startSession', startSession, previousStart],
      ['connectBlank', connectBlank, previousConnect],
    ]) {
      if (Object.getOwnPropertyDescriptor(ui, key)?.value !== wrapper) continue;
      if (previous) Object.defineProperty(ui, key, previous);
      else Reflect.deleteProperty(ui, key);
    }
  };
}
