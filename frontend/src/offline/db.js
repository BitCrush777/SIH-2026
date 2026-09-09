const DB_NAME = 'eMaanak_OfflineDB';
const DB_VERSION = 1;

/**
 * Opens or initializes the IndexedDB database for Field Officer Offline operations.
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // 1. Assigned Applications store
      if (!db.objectStoreNames.contains('assignedApplications')) {
        db.createObjectStore('assignedApplications', { keyPath: 'id' });
      }

      // 2. Statutory Calibration Rules store
      if (!db.objectStoreNames.contains('verificationRules')) {
        db.createObjectStore('verificationRules', { keyPath: 'typeCode' });
      }

      // 3. In-progress Inspection Drafts store (to protect against accidental closure)
      if (!db.objectStoreNames.contains('inspectionDrafts')) {
        db.createObjectStore('inspectionDrafts', { keyPath: 'applicationId' });
      }

      // 4. Offline Synchronization Queue store
      if (!db.objectStoreNames.contains('syncQueue')) {
        const syncStore = db.createObjectStore('syncQueue', { keyPath: 'clientOperationId' });
        syncStore.createIndex('status', 'status', { unique: false });
        syncStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const offlineDB = {
  // Assigned Applications
  saveAssignedApplications: async (apps) => {
    const db = await openDB();
    const tx = db.transaction('assignedApplications', 'readwrite');
    const store = tx.objectStore('assignedApplications');
    await store.clear();
    for (const app of apps) {
      await store.put(app);
    }
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });
  },

  getAssignedApplications: async () => {
    const db = await openDB();
    const tx = db.transaction('assignedApplications', 'readonly');
    const store = tx.objectStore('assignedApplications');
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
    });
  },

  // Statutory Rules
  saveRules: async (rules) => {
    const db = await openDB();
    const tx = db.transaction('verificationRules', 'readwrite');
    const store = tx.objectStore('verificationRules');
    for (const rule of rules) {
      await store.put(rule);
    }
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });
  },

  getRules: async () => {
    const db = await openDB();
    const tx = db.transaction('verificationRules', 'readonly');
    const store = tx.objectStore('verificationRules');
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
    });
  },

  // Inspection Drafts (Auto-Save on typing)
  saveDraft: async (applicationId, draftData) => {
    const db = await openDB();
    const tx = db.transaction('inspectionDrafts', 'readwrite');
    const store = tx.objectStore('inspectionDrafts');
    await store.put({ applicationId, ...draftData, lastModified: new Date().toISOString() });
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });
  },

  getDraft: async (applicationId) => {
    const db = await openDB();
    const tx = db.transaction('inspectionDrafts', 'readonly');
    const store = tx.objectStore('inspectionDrafts');
    const request = store.get(applicationId);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || null);
    });
  },

  clearDraft: async (applicationId) => {
    const db = await openDB();
    const tx = db.transaction('inspectionDrafts', 'readwrite');
    const store = tx.objectStore('inspectionDrafts');
    await store.delete(applicationId);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });
  },

  // Synchronization Queue
  enqueueInspection: async (inspectionItem) => {
    const db = await openDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const record = {
      clientOperationId: inspectionItem.clientOperationId,
      applicationId: inspectionItem.applicationId,
      instrumentSerial: inspectionItem.instrumentSerial,
      applicantName: inspectionItem.applicantName,
      instrumentType: inspectionItem.instrumentType,
      ruleVersion: inspectionItem.ruleVersion,
      readings: inspectionItem.readings,
      remarks: inspectionItem.remarks,
      status: 'PENDING', // PENDING, SYNCED, CONFLICT, REJECTED
      attemptCount: 0,
      error: null,
      serverResult: null,
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
    };
    await store.put(record);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(record);
    });
  },

  getSyncQueue: async () => {
    const db = await openDB();
    const tx = db.transaction('syncQueue', 'readonly');
    const store = tx.objectStore('syncQueue');
    const request = store.getAll();
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
    });
  },

  updateSyncQueueItem: async (clientOperationId, updates) => {
    const db = await openDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const existing = await new Promise((resolve) => {
      const req = store.get(clientOperationId);
      req.onsuccess = () => resolve(req.result);
    });

    if (existing) {
      const merged = { ...existing, ...updates };
      await store.put(merged);
    }

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });
  },

  removeSyncQueueItem: async (clientOperationId) => {
    const db = await openDB();
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    await store.delete(clientOperationId);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
    });
  }
};
