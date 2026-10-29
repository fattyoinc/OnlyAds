import { ActionSheetIOS, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, useTheme } from '@/theme';
import { haptics } from './haptics';
import { Icon } from './Icon';
import { Text } from './Text';

export interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * Pick one option. iOS uses the native action sheet; Android/web use a bottom
 * sheet with radio-style rows (Material convention).
 */
export function showOptionsIOS<T extends string>(title: string, options: Option<T>[], onSelect: (v: T) => void) {
  ActionSheetIOS.showActionSheetWithOptions({ title, options: [...options.map((o) => o.label), 'Cancel'], cancelButtonIndex: options.length }, (i) => {
    if (i < options.length) onSelect(options[i].value);
  });
}

export function OptionSheet<T extends string>({ visible, title, options, value, onSelect, onClose }: { visible: boolean; title: string; options: Option<T>[]; value: T; onSelect: (v: T) => void; onClose: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'ios') return null; // handled by showOptionsIOS
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.handle} />
        <Text variant="headline" style={s.title} accessibilityRole="header">
          {title}
        </Text>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => {
                haptics.select();
                onSelect(o.value);
                onClose();
              }}
              android_ripple={{ color: colors.fillPressed }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={s.row}
            >
              <Text variant="callout" style={{ flex: 1, fontWeight: on ? '700' : '400' }}>
                {o.label}
              </Text>
              <Icon name={on ? 'radiobox-marked' : 'radiobox-blank'} size="md" color={on ? colors.text : colors.textTertiary} />
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  backdrop: { flex: 1, backgroundColor: colors.scrim },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.sm },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.sm },
  title: { paddingHorizontal: space.xl, paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: space.xl },
}));
