/**
 * "Ending soon" reminders for saved offers — local notifications only, scheduled
 * on the device. Nothing is sent to a server and no push token is ever created.
 * Opt-in: permission is requested only when the user turns reminders on.
 */
import { Platform } from 'react-native';

import type { Offer } from '@/types/offer';

/** First choice: a day before the end; if that's already past, two hours before. */
const LEAD_TIMES_H = [24, 2];
/** Don't schedule something that would fire almost immediately. */
const MIN_DELAY_MS = 10 * 60_000;
/** iOS keeps at most 64 pending local notifications per app; stay well below. */
export const MAX_REMINDERS = 20;
const TAG = 'onlyads-ending';

export interface PlannedReminder {
  offerId: string;
  at: Date;
  title: string;
  body: string;
}

/** Pure: which reminders should exist right now for these saved offers. */
export function planReminders(saved: Offer[], now: Date): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const o of saved) {
    if (!o.expiresAt) continue;
    const end = Date.parse(o.expiresAt);
    for (const h of LEAD_TIMES_H) {
      const at = end - h * 3600_000;
      if (at - now.getTime() >= MIN_DELAY_MS) {
        out.push({
          offerId: o.id,
          at: new Date(at),
          title: h >= 24 ? 'A saved deal ends tomorrow' : 'A saved deal ends soon',
          body: `${o.title} — ${o.advertiser.name}`.slice(0, 140),
        });
        break;
      }
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_REMINDERS);
}

type NotificationsModule = typeof import('expo-notifications');
let mod: NotificationsModule | null | undefined;
/** Loaded lazily; unavailable on web (no scheduled local notifications there). */
function notifications(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  if (Platform.OS === 'web') return (mod = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-notifications') as NotificationsModule;
  } catch {
    mod = null;
  }
  return mod;
}

export const remindersSupported = () => notifications() !== null;

export async function requestReminderPermission(): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  const current = await N.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })).granted;
}

/** Replace our scheduled reminders with `plan`. Safe to call often; no-op without permission. */
export async function syncReminders(plan: PlannedReminder[]): Promise<number> {
  const N = notifications();
  if (!N) return 0;
  if (!(await N.getPermissionsAsync()).granted) return 0;
  const existing = await N.getAllScheduledNotificationsAsync();
  await Promise.all(existing.filter((r) => r.content.data?.tag === TAG).map((r) => N.cancelScheduledNotificationAsync(r.identifier)));
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('ending-soon', { name: 'Saved deals ending', importance: N.AndroidImportance.DEFAULT });
  }
  for (const r of plan) {
    await N.scheduleNotificationAsync({
      content: { title: r.title, body: r.body, data: { tag: TAG, offerId: r.offerId } },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: 'ending-soon' },
    });
  }
  return plan.length;
}

export async function cancelAllReminders(): Promise<void> {
  const N = notifications();
  if (!N) return;
  const existing = await N.getAllScheduledNotificationsAsync();
  await Promise.all(existing.filter((r) => r.content.data?.tag === TAG).map((r) => N.cancelScheduledNotificationAsync(r.identifier)));
}

/** Open the offer when a reminder is tapped. Returns an unsubscribe function. */
export function onReminderOpened(open: (offerId: string) => void): () => void {
  const N = notifications();
  if (!N) return () => {};
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  const handle = (r: import('expo-notifications').NotificationResponse | null) => {
    const id = r?.notification.request.content.data?.offerId;
    if (typeof id === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(id)) open(id);
  };
  const sub = N.addNotificationResponseReceivedListener(handle);
  // The tap that launched the app from a killed state.
  N.getLastNotificationResponseAsync()
    .then((r) => {
      if (r) {
        handle(r);
        void N.clearLastNotificationResponseAsync?.();
      }
    })
    .catch(() => {});
  return () => sub.remove();
}
