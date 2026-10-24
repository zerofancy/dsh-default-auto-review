/** No history scanning, time heuristics, private service mutation, or LLM calls. */
export function isFreshTopLevelSession(session) {
  const header = session?.header;
  return header?.version === 4
    && header.isSeeded === false
    && header.parentSession === undefined
    && header.origin === undefined
    && header.delegationDepth === undefined
    && session.firstLiveSeq === 0
    && session.firstLifecycleSeq === 0
    && session.inheritedEventCount === 0;
}

export function isPristinePermissionState(state) {
  return state?.seeded === false
    && state.preset === null
    && state.sandbox === null
    && state.approval === null;
}

/** Capture only the canonical default written by the core permission service. */
export function isInitializedDefault(state, presets) {
  if (state?.seeded !== false || state.preset === null) return false;
  const name = presets.defaultPreset;
  const spec = presets.resolve(name);
  return state.preset === name
    && state.sandbox === spec.sandbox
    && state.approval === spec.approval;
}
