/**
 * Jahez: no public developer documentation found. POS vendors integrate via a
 * private partner channel. Scaffolded and clearly marked needs-partner.
 */
import type { PlatformAdapter } from '../types';

export const jahezAdapter: PlatformAdapter = {
  key: 'jahez',
  displayName: 'Jahez',
  docsUrl: '',
  readiness: 'needs-partner',
  partnerRequirements: [
    'No public API documentation - contact Jahez business development for partner integration',
    'Jahez is Saudi-based; availability for Kuwait branches unverified',
  ],
  mapInbound() { return null; },
  verifySignature() { return false; },
  buildStatusUpdate() { return null; },
  validateConfig() {
    return { ok: false, message: 'Jahez has no public integration program; partner agreement required first.' };
  },
};
