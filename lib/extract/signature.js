'use strict';

/**
 * Canonical signature fingerprint for graph nodes.
 * Used by diff (SEMANTIC_NODE_FIELDS.signature) and R14 signature-break.
 * Missing on old baselines is treated as "no comparable signature", not a change.
 */

function normTypes(list) {
  return (list || []).map((t) => String(t)).filter(Boolean).slice().sort();
}

function methodSig(mt, fallbackCount) {
  const paramCount = (typeof mt.paramCount === 'number')
    ? mt.paramCount
    : (typeof fallbackCount === 'number' ? fallbackCount : (mt.paramTypes || []).length);
  const optionalParams = typeof mt.optionalParams === 'number' ? mt.optionalParams : 0;
  return {
    method: mt.method || '',
    paramCount,
    paramTypes: normTypes(mt.paramTypes),
    returnTypes: normTypes(mt.returnTypes),
    optionalParams
  };
}

function emptySig() {
  return {
    paramCount: 0,
    paramTypes: [],
    returnTypes: [],
    optionalParams: 0,
    methods: []
  };
}

/**
 * Build a signature fingerprint from an extracted entity (or a graph node
 * that already carries methodTypes / members / signature).
 */
function signatureFromEntity(entity) {
  if (!entity) return emptySig();
  if (entity.signature && typeof entity.signature.paramCount === 'number' && Array.isArray(entity.signature.methods)) {
    return entity.signature;
  }
  const methods = [];
  const mts = entity.methodTypes || [];
  const members = (entity.members || []).filter((m) => m.kind === 'method');
  if (mts.length) {
    for (const mt of mts) {
      const mem = members.find((m) => m.name === mt.method);
      const fallback = mem && typeof mem.params === 'number' ? mem.params : undefined;
      methods.push(methodSig(mt, fallback));
    }
  } else {
    for (const m of members) {
      methods.push(methodSig({
        method: m.name,
        paramCount: typeof m.params === 'number' ? m.params : (m.paramTypes || []).length,
        paramTypes: m.paramTypes || [],
        returnTypes: m.returnType ? [m.returnType] : (m.returnTypes || []),
        optionalParams: m.optionalParams || 0
      }));
    }
  }
  methods.sort((a, b) => String(a.method).localeCompare(String(b.method)));
  const primary = methods[0] || methodSig({ method: entity.name, paramCount: 0, paramTypes: [], returnTypes: [], optionalParams: 0 });
  return {
    paramCount: primary.paramCount,
    paramTypes: primary.paramTypes,
    returnTypes: primary.returnTypes,
    optionalParams: primary.optionalParams,
    methods
  };
}

function hasSignatureData(sig) {
  return !!(sig && (sig.methods.length || sig.paramCount || sig.paramTypes.length || sig.returnTypes.length || sig.optionalParams));
}

function argsCompatible(argCount, sig) {
  if (typeof argCount !== 'number' || !sig) return true;
  const total = sig.paramCount || 0;
  const optional = sig.optionalParams || 0;
  const required = Math.max(0, total - optional);
  if (argCount < required) return false;
  if (argCount > total && optional === 0) return false;
  return true;
}

function methodSigByName(sig, name) {
  if (!sig) return sig;
  if (name && sig.methods && sig.methods.length) {
    const hit = sig.methods.find((m) => m.method === name);
    if (hit) return hit;
  }
  return sig;
}

module.exports = {
  signatureFromEntity,
  hasSignatureData,
  argsCompatible,
  methodSigByName,
  emptySig
};
