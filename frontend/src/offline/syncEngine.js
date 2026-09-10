import { offlineDB } from './db';
import { api, getApiBaseUrl } from '../api';

class SyncEngine {
  constructor() {
    this.isOnline = navigator.onLine;
    this.isSyncing = false;
    this.listeners = new Set();
    this.heartbeatTimer = null;

    // Listen to browser network events
    window.addEventListener('online', () => this.handleNetworkChange(true));
    window.addEventListener('offline', () => this.handleNetworkChange(false));

    // Start background health heartbeat
    this.startHeartbeat();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    // Initial notify
    listener({ isOnline: this.isOnline, isSyncing: this.isSyncing });
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      listener({ isOnline: this.isOnline, isSyncing: this.isSyncing });
    }
  }

  async checkConnectivity() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const apiBase = getApiBaseUrl();
      const res = await fetch(`${apiBase}/health`, {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeoutId);
      const onlineNow = res.ok;
      if (onlineNow !== this.isOnline) {
        this.isOnline = onlineNow;
        this.notify();
      }
      return onlineNow;
    } catch {
      if (this.isOnline) {
        this.isOnline = false;
        this.notify();
      }
      return false;
    }
  }

  async handleNetworkChange(onlineFlag) {
    if (onlineFlag) {
      const actuallyOnline = await this.checkConnectivity();
      if (actuallyOnline) {
        console.log('[SyncEngine] Connectivity restored. Initiating automatic queue sync...');
        this.syncPendingQueue();
      }
    } else {
      this.isOnline = false;
      this.notify();
    }
  }

  startHeartbeat() {
    this.checkConnectivity();
    this.heartbeatTimer = setInterval(() => {
      this.checkConnectivity();
    }, 15000); // Check every 15s
  }

  /**
   * Pre-caches assignments and statutory rules for offline field work.
   */
  async cacheFieldData() {
    try {
      const [apps, rules] = await Promise.all([
        api.getPendingApplications(),
        api.getVerificationRules(),
      ]);
      await offlineDB.saveAssignedApplications(apps);
      await offlineDB.saveRules(rules);
      return { success: true, count: apps.length };
    } catch (err) {
      console.error('[SyncEngine] Failed to cache field data:', err);
      throw err;
    }
  }

  /**
   * Idempotent Synchronization of all PENDING records in the queue.
   */
  async syncPendingQueue() {
    if (this.isSyncing) return;
    const isConn = await this.checkConnectivity();
    if (!isConn) {
      console.warn('[SyncEngine] Cannot sync while offline.');
      return { success: false, reason: 'OFFLINE' };
    }

    this.isSyncing = true;
    this.notify();

    const queue = await offlineDB.getSyncQueue();
    const pendingItems = queue.filter(item => item.status === 'PENDING');
    let syncedCount = 0;
    let conflictCount = 0;

    for (const item of pendingItems) {
      try {
        await offlineDB.updateSyncQueueItem(item.clientOperationId, {
          attemptCount: (item.attemptCount || 0) + 1,
          lastAttemptAt: new Date().toISOString()
        });

        const syncPayload = {
          clientOperationId: item.clientOperationId,
          applicationId: item.applicationId,
          ruleVersion: item.ruleVersion,
          readings: item.readings,
          remarks: item.remarks,
          clientCreatedAt: item.createdAt,
        };

        const res = await api.syncOfflineInspection(syncPayload);

        if (res.syncResult === 'ACCEPTED' || res.syncResult === 'SYNCED_EXISTING') {
          await offlineDB.updateSyncQueueItem(item.clientOperationId, {
            status: 'SYNCED',
            serverResult: {
              result: res.overallResult,
              certificateNumber: res.certificate?.certificateNumber ?? null,
              inspectionId: res.inspection?.id ?? null,
            },
            error: null
          });
          syncedCount++;
        }
      } catch (err) {
        console.error(`[SyncEngine] Error syncing ${item.clientOperationId}:`, err);
        const errMsg = err.message || 'Synchronization failed';

        if (errMsg.includes('Conflict') || errMsg.includes('already verified') || errMsg.includes('mismatch')) {
          await offlineDB.updateSyncQueueItem(item.clientOperationId, {
            status: 'CONFLICT',
            error: errMsg
          });
          conflictCount++;
        } else {
          await offlineDB.updateSyncQueueItem(item.clientOperationId, {
            error: errMsg
          });
        }
      }
    }

    this.isSyncing = false;
    this.notify();

    return { success: true, syncedCount, conflictCount, remaining: pendingItems.length - syncedCount };
  }
}

export const syncEngine = new SyncEngine();
