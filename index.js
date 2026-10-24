import { isFreshTopLevelSession, isPristinePermissionState, isInitializedDefault } from './core.js';

export const name = 'default-auto-review';
export const inject = ['agents', 'sessions', 'permissionPresets', 'sessionProjections'];

/**
 * A post-initialization preference, not a replacement authorization gate.
 * The built-in Auto integration must be live; its admission and all of its
 * sandbox/approval event writers remain the sole authority for selecting Auto.
 */
export function apply(ctx) {
  const presets = ctx.permissionPresets;
  const projections = ctx.sessionProjections;
  const logger = ctx.logger('default-auto-review');
  const candidates = new WeakMap();
  let unavailableWarning = false;
  const permissionState = session => projections.stateOf(session, 'permissions');

  // session/created also announces restored sessions. Run BEFORE core pinning,
  // recording only fresh objects that carry no explicit permission facts.
  ctx.on('session/created', session => {
    if (!isFreshTopLevelSession(session)) return;
    if (!isPristinePermissionState(permissionState(session))) return;
    candidates.set(session, { baseline: undefined });
  }, { prepend: true });

  // The injected permission service registered its normal creation listener
  // before this plugin. Its projection object is an immutable change token:
  // unrelated events retain it; any later permission event replaces it.
  ctx.on('session/created', session => {
    const candidate = candidates.get(session);
    if (!candidate) return;
    const state = permissionState(session);
    if (!isInitializedDefault(state, presets)) {
      candidates.delete(session);
      return;
    }
    candidate.baseline = state;
  });

  // This is an awaited, pre-loop publication hook. Do NOT defer to timers or
  // modify all sessions on plugin load. Claim once so manual choices stay final.
  ctx.on('agent/created', ({ agent, source, signal }) => {
    const session = agent.session;
    const candidate = candidates.get(session);
    candidates.delete(session);
    if (source !== 'startup' || signal?.aborted || !candidate?.baseline) return;
    if (permissionState(session) !== candidate.baseline) return;
    if (!presets.names.includes('auto')) {
      if (!unavailableWarning) {
        unavailableWarning = true;
        logger.warn('内置自动审查未就绪：保留原权限，不追补已创建会话。');
      }
      return;
    }
    // Synchronous official API: a failed admission rejects startup rather than
    // silently allowing a new conversation to run with unintended permissions.
    presets.set(session, 'auto');
  });

  ctx.on('session/disposed', session => candidates.delete(session));
  logger.info('已启用：全新普通会话默认自动审查；旧会话、分叉、子 Agent 和手动选择保持不变。');
}
