// js/storage.js
// Storage adapter that works in both Claude.ai artifact mode (using window.storage)
// and standalone browser mode (using localStorage).

const STATE_KEY = "keypad_designer_state_v1";
const API_KEY_KEY = "keypad_designer_api_key_v1";

export const isArtifactMode =
  typeof window !== "undefined" &&
  typeof window.storage === "object" &&
  window.storage !== null &&
  typeof window.storage.get === "function";

export async function loadState() {
  try {
    if (isArtifactMode) {
      const r = await window.storage.get(STATE_KEY);
      return r && r.value ? JSON.parse(r.value) : null;
    } else {
      const v = localStorage.getItem(STATE_KEY);
      return v ? JSON.parse(v) : null;
    }
  } catch (e) {
    console.error("loadState error:", e);
    return null;
  }
}

export async function saveState(state) {
  const json = JSON.stringify(state);
  try {
    if (isArtifactMode) {
      await window.storage.set(STATE_KEY, json);
    } else {
      localStorage.setItem(STATE_KEY, json);
    }
    return true;
  } catch (e) {
    console.error("saveState error:", e);
    return false;
  }
}

// API key only used in standalone (BYOK) mode. In artifact mode, the runtime
// handles auth automatically.
export function getApiKey() {
  if (isArtifactMode) return null;
  try {
    return localStorage.getItem(API_KEY_KEY);
  } catch {
    return null;
  }
}

export function setApiKey(key) {
  if (isArtifactMode) return;
  try {
    if (key) localStorage.setItem(API_KEY_KEY, key);
    else localStorage.removeItem(API_KEY_KEY);
  } catch {}
}

export function hasApiKey() {
  return isArtifactMode || !!getApiKey();
}
