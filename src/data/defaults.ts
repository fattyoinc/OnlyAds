import type { GeoPoint } from '@/types/offer';

/** Anchor for the demo catalog when the user hasn't shared a location. Demo builds only. */
export const DEFAULT_ANCHOR: GeoPoint & { label: string } = { lat: 25.7617, lng: -80.1918, label: 'Miami, FL (demo)' };
