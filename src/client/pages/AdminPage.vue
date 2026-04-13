<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  listDevices,
  approveDevice,
  approveAllDevices,
  restartGateway,
  getStorageStatus,
  triggerSync,
  AuthError,
  type PendingDevice,
  type PairedDevice,
  type DeviceListResponse,
  type StorageStatusResponse,
} from '../api';

const pending = ref<PendingDevice[]>([]);
const paired = ref<PairedDevice[]>([]);
const storageStatus = ref<StorageStatusResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const actionInProgress = ref<string | null>(null);
const restartInProgress = ref(false);
const syncInProgress = ref(false);

const hasPending = computed(() => pending.value.length > 0);

function formatSyncTime(isoString: string | null) {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString();
}

function formatTimestamp(ts: number) {
  const date = new Date(ts);
  return date.toLocaleString();
}

function formatTimeAgo(ts: number) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function fetchDevices() {
  try {
    error.value = null;
    const data: DeviceListResponse = await listDevices();
    pending.value = data.pending || [];
    paired.value = data.paired || [];

    if (data.error) {
      error.value = data.error;
    } else if (data.parseError) {
      error.value = `Parse error: ${data.parseError}`;
    }
  } catch (err) {
    if (err instanceof AuthError) {
      error.value = 'Authentication required. Please log in via Cloudflare Access.';
    } else {
      error.value = err instanceof Error ? err.message : 'Failed to fetch devices';
    }
  } finally {
    loading.value = false;
  }
}

async function fetchStorageStatus() {
  try {
    storageStatus.value = await getStorageStatus();
  } catch (err) {
    console.error('Failed to fetch storage status:', err);
  }
}

async function handleApprove(requestId: string) {
  actionInProgress.value = requestId;
  try {
    const result = await approveDevice(requestId);
    if (result.success) {
      await fetchDevices();
    } else {
      error.value = result.error || 'Approval failed';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to approve device';
  } finally {
    actionInProgress.value = null;
  }
}

async function handleApproveAll() {
  if (!hasPending.value) return;

  actionInProgress.value = 'all';
  try {
    const result = await approveAllDevices();
    if (result.failed && result.failed.length > 0) {
      error.value = `Failed to approve ${result.failed.length} device(s)`;
    }
    await fetchDevices();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to approve devices';
  } finally {
    actionInProgress.value = null;
  }
}

async function handleRestartGateway() {
  if (
    !confirm(
      'Are you sure you want to restart the gateway? This will disconnect all clients temporarily.',
    )
  ) {
    return;
  }

  restartInProgress.value = true;
  try {
    const result = await restartGateway();
    if (result.success) {
      error.value = null;
      alert('Gateway restart initiated. Clients will reconnect automatically.');
    } else {
      error.value = result.error || 'Failed to restart gateway';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to restart gateway';
  } finally {
    restartInProgress.value = false;
  }
}

async function handleSync() {
  syncInProgress.value = true;
  try {
    const result = await triggerSync();
    if (result.success) {
      if (storageStatus.value) {
        storageStatus.value = { ...storageStatus.value, lastBackupId: result.backupId || null };
      }
      error.value = null;
    } else {
      error.value = result.error || 'Sync failed';
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to sync';
  } finally {
    syncInProgress.value = false;
  }
}

onMounted(async () => {
  await Promise.all([fetchDevices(), fetchStorageStatus()]);
});
</script>

<template>
  <div class="devices-page">
    <div v-if="error" class="error-banner">
      <span>{{ error }}</span>
      <button class="dismiss-btn" @click="error = null">Dismiss</button>
    </div>

    <div v-if="storageStatus && !storageStatus.configured" class="warning-banner">
      <div class="warning-content">
        <strong>R2 Storage Not Configured</strong>
        <p>
          Paired devices and conversations will be lost when the container restarts. To enable
          persistent storage, configure R2 credentials. See the
          <a href="https://github.com/cloudflare/moltworker" target="_blank" rel="noopener noreferrer">
            README
          </a>
          for setup instructions.
        </p>
        <p v-if="storageStatus.missing" class="missing-secrets">
          Missing: {{ storageStatus.missing.join(', ') }}
        </p>
      </div>
    </div>

    <div v-if="storageStatus?.configured" class="success-banner">
      <div class="storage-status">
        <div class="storage-info">
          <span>R2 storage is configured. Your data will persist across container restarts.</span>
          <span class="last-sync">Last backup: {{ formatSyncTime(storageStatus.lastBackupId) }}</span>
        </div>
        <button class="btn btn-secondary btn-sm" :disabled="syncInProgress" @click="handleSync">
          <span v-if="syncInProgress" class="btn-spinner" />
          {{ syncInProgress ? 'Syncing...' : 'Backup Now' }}
        </button>
      </div>
    </div>

    <section class="devices-section gateway-section">
      <div class="section-header">
        <h2>Gateway Controls</h2>
        <button class="btn btn-danger" :disabled="restartInProgress" @click="handleRestartGateway">
          <span v-if="restartInProgress" class="btn-spinner" />
          {{ restartInProgress ? 'Restarting...' : 'Restart Gateway' }}
        </button>
      </div>
      <p class="hint">
        Restart the gateway to apply configuration changes or recover from errors. All connected
        clients will be temporarily disconnected.
      </p>
    </section>

    <div v-if="loading" class="loading">
      <div class="spinner" />
      <p>Loading devices...</p>
    </div>

    <template v-else>
      <section class="devices-section">
        <div class="section-header">
          <h2>Pending Pairing Requests</h2>
          <div class="header-actions">
            <button
              v-if="hasPending"
              class="btn btn-primary"
              :disabled="actionInProgress !== null"
              @click="handleApproveAll"
            >
              <span v-if="actionInProgress === 'all'" class="btn-spinner" />
              {{ actionInProgress === 'all' ? 'Approving...' : `Approve All (${pending.length})` }}
            </button>
            <button class="btn btn-secondary" :disabled="loading" @click="fetchDevices">Refresh</button>
          </div>
        </div>

        <div v-if="pending.length === 0" class="empty-state">
          <p>No pending pairing requests</p>
          <p class="hint">Devices will appear here when they attempt to connect without being paired.</p>
        </div>

        <div v-else class="devices-grid">
          <div v-for="device in pending" :key="device.requestId" class="device-card pending">
            <div class="device-header">
              <span class="device-name">{{ device.displayName || device.deviceId || 'Unknown Device' }}</span>
              <span class="device-badge pending">Pending</span>
            </div>
            <div class="device-details">
              <div v-if="device.platform" class="detail-row">
                <span class="label">Platform:</span>
                <span class="value">{{ device.platform }}</span>
              </div>
              <div v-if="device.clientId" class="detail-row">
                <span class="label">Client:</span>
                <span class="value">{{ device.clientId }}</span>
              </div>
              <div v-if="device.clientMode" class="detail-row">
                <span class="label">Mode:</span>
                <span class="value">{{ device.clientMode }}</span>
              </div>
              <div v-if="device.role" class="detail-row">
                <span class="label">Role:</span>
                <span class="value">{{ device.role }}</span>
              </div>
              <div v-if="device.remoteIp" class="detail-row">
                <span class="label">IP:</span>
                <span class="value">{{ device.remoteIp }}</span>
              </div>
              <div class="detail-row">
                <span class="label">Requested:</span>
                <span class="value" :title="formatTimestamp(device.ts)">{{ formatTimeAgo(device.ts) }}</span>
              </div>
            </div>
            <div class="device-actions">
              <button
                class="btn btn-success"
                :disabled="actionInProgress !== null"
                @click="handleApprove(device.requestId)"
              >
                <span v-if="actionInProgress === device.requestId" class="btn-spinner" />
                {{ actionInProgress === device.requestId ? 'Approving...' : 'Approve' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="devices-section">
        <div class="section-header">
          <h2>Paired Devices</h2>
        </div>

        <div v-if="paired.length === 0" class="empty-state">
          <p>No paired devices</p>
        </div>

        <div v-else class="devices-grid">
          <div v-for="device in paired" :key="device.deviceId" class="device-card paired">
            <div class="device-header">
              <span class="device-name">{{ device.displayName || device.deviceId || 'Unknown Device' }}</span>
              <span class="device-badge paired">Paired</span>
            </div>
            <div class="device-details">
              <div v-if="device.platform" class="detail-row">
                <span class="label">Platform:</span>
                <span class="value">{{ device.platform }}</span>
              </div>
              <div v-if="device.clientId" class="detail-row">
                <span class="label">Client:</span>
                <span class="value">{{ device.clientId }}</span>
              </div>
              <div v-if="device.clientMode" class="detail-row">
                <span class="label">Mode:</span>
                <span class="value">{{ device.clientMode }}</span>
              </div>
              <div v-if="device.role" class="detail-row">
                <span class="label">Role:</span>
                <span class="value">{{ device.role }}</span>
              </div>
              <div class="detail-row">
                <span class="label">Paired:</span>
                <span class="value" :title="formatTimestamp(device.approvedAtMs)">
                  {{ formatTimeAgo(device.approvedAtMs) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style src="./AdminPage.css"></style>
