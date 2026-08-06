/**
 * Whether the teacher's changes have actually reached the server.
 *
 * Kept out of the main store deliberately: this is transient truth about the
 * connection, not data, and persisting it would mean a relaunch could show
 * "3 changes waiting" for a queue that no longer exists.
 *
 * It exists at all because the app writes locally first and mirrors in the
 * background. That is the right trade for taking attendance on classroom wifi,
 * but it means a failed write used to be invisible — the group looked saved,
 * and only the send days later revealed that the server had never heard of it.
 */
import { create } from 'zustand';

export type SyncState = {
  /** Writes accepted locally that have not yet landed on the server. */
  pending: number;
  /** The last attempt failed because the server could not be reached. */
  offline: boolean;
  /** A write that failed for a reason retrying will not fix. */
  failure: string | null;
};

type SyncStore = SyncState & {
  report: (patch: Partial<SyncState>) => void;
  clearFailure: () => void;
};

export const useSyncStatus = create<SyncStore>()((set) => ({
  pending: 0,
  offline: false,
  failure: null,
  report: (patch) => set(patch),
  clearFailure: () => set({ failure: null }),
}));

export const syncStatus = () => useSyncStatus.getState();
