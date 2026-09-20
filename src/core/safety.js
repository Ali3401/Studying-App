/* ==========================================================================
   Lucid — keeping the notes safe.

   Everything lives in this browser, which means two real risks:
   the browser evicting the database to reclaim space, and the person
   clearing website data without a backup. This handles both.
   ========================================================================== */

import * as settings from './settings.js';
import * as store from './store.js';
import { fmtBytes, pluralize, downloadBlob } from './util.js';

const NUDGE_AFTER = 14 * 86400000;   // two weeks
const NUDGE_EVERY = 3 * 86400000;    // and at most once every three days
const WORTH_LOSING = 3;              // notes

/**
 * Ask the browser to treat our storage as persistent. Granted silently in
 * most engines once the site looks "used"; Safari grants it for sites added
 * to the Home Screen. Never blocks, never throws.
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return { supported: false, persisted: false };
    if (await navigator.storage.persisted?.()) return { supported: true, persisted: true };
    const persisted = await navigator.storage.persist();
    settings.set({ persisted }, true);
    return { supported: true, persisted };
  } catch {
    return { supported: false, persisted: false };
  }
}

export async function persistenceState() {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch { return null; }
}

/** Write a full backup to a file and remember that we did. */
export async function exportBackup({ onProgress } = {}) {
  onProgress?.('Packing everything up…');
  const data = await store.exportBackup();
  const name = `lucid-backup-${new Date().toISOString().slice(0, 10)}.json`;
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
  settings.set({ lastExport: Date.now() }, true);
  return { name, docs: data.docs.length, images: data.images.length };
}

/**
 * Should we ask them to back up? Only when there is something worth losing,
 * it has been a while, and we have not just asked.
 */
export function backupDue() {
  const docs = store.allIncludingArchived();
  if (docs.length < WORTH_LOSING) return null;

  const last = settings.get('lastExport') || 0;
  const asked = settings.get('lastBackupNudge') || 0;
  const now = Date.now();

  if (now - asked < NUDGE_EVERY) return null;
  const since = last ? now - last : now - Math.min(...docs.map(d => d.createdAt || now));
  if (since < NUDGE_AFTER) return null;

  return {
    docs: docs.length,
    days: Math.round(since / 86400000),
    never: !last,
    words: docs.reduce((n, d) => n + store.derived(d).words, 0),
  };
}

export const nudgeShown = () => settings.set({ lastBackupNudge: Date.now() }, true);

export async function storageSummary() {
  const { usage, quota } = await store.storageEstimate();
  return {
    usage, quota,
    label: quota ? `${fmtBytes(usage)} of about ${fmtBytes(quota)}` : fmtBytes(usage),
    persisted: await persistenceState(),
    lastExport: settings.get('lastExport') || 0,
  };
}

export { pluralize };
