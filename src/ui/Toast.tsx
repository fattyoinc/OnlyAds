import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface ToastOptions {
  message: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  /** Distance from the bottom edge (e.g. above a tab bar). */
  offset?: number;
}

const ToastCtx = createContext<(t: ToastOptions) => void>(() => {});

/** Lightweight confirmation toasts ("Saved · View"). Also announced to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const s = useStyles();
  const { colors, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const anim = useState(() => new Animated.Value(0))[0];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback(
    (t: ToastOptions) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(t);
      anim.setValue(0);
      Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      AccessibilityInfo.announceForAccessibility(t.message);
      timer.current = setTimeout(hide, t.actionLabel ? 3500 : 2200);
    },
    [anim, hide],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            s.wrap,
            { bottom: insets.bottom + (toast.offset ?? 16), opacity: anim },
            !reduceMotion && { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
          ]}
        >
          <View style={s.toast}>
            {toast.icon ? <Icon name={toast.icon} size="md" color={colors.onInk} /> : null}
            <Text variant="subhead" tone="onInk" style={{ flex: 1 }} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.actionLabel && toast.onAction ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.actionLabel}
                hitSlop={10}
                onPress={() => {
                  hide();
                  toast.onAction?.();
                }}
              >
                <Text variant="subhead" tone="onInk" style={{ fontWeight: '800', textDecorationLine: 'underline' }}>
                  {toast.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

const useStyles = makeStyles(({ colors, radius, space, elevation }) => ({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space.md, maxWidth: 480, width: '100%', minHeight: 48, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.ink, ...elevation(2) },
}));
