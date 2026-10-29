import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Haptics are feedback, never information: every haptic action also has a visual change. */
const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

export const haptics = {
  /** Selection changes: chips, tabs, segmented controls. */
  select: () => enabled && Haptics.selectionAsync().catch(() => {}),
  /** A meaningful toggle: saving an offer. */
  tap: () => enabled && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  success: () => enabled && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  warning: () => enabled && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
};
