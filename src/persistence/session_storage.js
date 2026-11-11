import { decodeSessionSnapshot, encodeSessionSnapshot } from "./session_codec.js";

export const SESSION_STATE_KEY = "netlistGraphBuilder.session.v2";
export const LEGACY_SESSION_STATE_KEY = "netlistGraphBuilder.session.v1";

export function loadSessionStateResult(storage) {
  try {
    const target = arguments.length > 0 ? storage : globalThis.sessionStorage;
    if (!target || typeof target.getItem !== "function") throw new Error("Session storage is unavailable");
    const encoded = target.getItem(SESSION_STATE_KEY) || target.getItem(LEGACY_SESSION_STATE_KEY);
    return { ok: true, value: encoded ? decodeSessionSnapshot(encoded) : null };
  } catch (error) {
    return { ok: false, value: null, error };
  }
}

export function saveSessionStateResult(snapshot, storage) {
  try {
    const target = arguments.length > 1 ? storage : globalThis.sessionStorage;
    if (!target || typeof target.setItem !== "function") throw new Error("Session storage is unavailable");
    target.setItem(SESSION_STATE_KEY, encodeSessionSnapshot(snapshot));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

// Preserve the value/bool API for callers that do not need diagnostics.
export function loadSessionState(...args) {
  return loadSessionStateResult(...args).value;
}

export function saveSessionState(...args) {
  return saveSessionStateResult(...args).ok;
}
