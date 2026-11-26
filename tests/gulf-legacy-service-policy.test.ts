/** GULF release policy: a restored legacy configuration must not re-enable remote traffic.
 * Run: node tests/run-electron-node-test.cjs tests/gulf-legacy-service-policy.test.ts
 */
import assert from 'node:assert/strict';

async function run() {
  const { isLegacyCloudBlocked } = require('../main/services/offline-mode');
  const { CloudSyncService } = require('../main/services/cloud-sync');
  const { isTelemetrySuppressed, sendEvent } = require('../main/services/telemetry');
  const { postHogEnvironment, readPostHogConfig, postHogConnectOrigin } = require('../main/services/posthog-config');
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = (async () => { attempted++; throw new Error('Unexpected outbound request'); }) as typeof fetch;
  try {
    assert.equal(isLegacyCloudBlocked(), true);
    assert.equal(isTelemetrySuppressed(), true);
    assert.equal(postHogEnvironment(), null);
    assert.equal(readPostHogConfig(), null);
    assert.equal(postHogConnectOrigin(), null);
    const cloud = new CloudSyncService();
    assert.equal(cloud.isCloudAccountAvailable(), false);
    assert.equal(cloud.isTrustedRecoveryServerUrl('https://blue.flopos.com/'), false);
    await assert.rejects(() => cloud.register(), /not available/);
    await assert.rejects(() => (cloud as any).trackedFetch('https://blue.flopos.com/', { method: 'GET' }), /not available/);
    assert.equal(await sendEvent('gulf_policy_probe'), false);
    assert.equal(attempted, 0);
    console.log('GULF legacy-service policy passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
