import { forwardRef } from 'react';
import { Platform, Pressable, TextInput, View, type TextInputProps } from 'react-native';

import { makeStyles, useTheme } from '@/theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** Tappable search entry point (opens the search screen). */
export function SearchTrigger({ placeholder, onPress }: { placeholder: string; onPress: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="search" accessibilityLabel={placeholder} scaleTo={0.985} style={s.field}>
      <Icon name="magnify" size="md" color={colors.textSecondary} />
      <Text variant="callout" tone="secondary" style={{ flex: 1, fontWeight: '400' }} numberOfLines={1}>
        {placeholder}
      </Text>
    </PressableScale>
  );
}

/** The real search input. Clear button is platform-native on iOS, custom elsewhere. */
export const SearchInput = forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps & { onClear?: () => void }>(function SearchInput({ value, onClear, style, ...rest }, ref) {
  const s = useStyles();
  const { colors, scheme } = useTheme();
  return (
    <View style={s.field}>
      <Icon name="magnify" size="md" color={colors.textSecondary} />
      <TextInput
        ref={ref}
        value={value}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.accent}
        keyboardAppearance={scheme}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        enterKeyHint="search"
        clearButtonMode="never"
        style={[s.input, style]}
        {...rest}
      />
      {value && onClear ? (
        <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={12}>
          <Icon name="close-circle" size="md" color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles(({ colors, radius, space, type }) => ({
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: space.md + 2, borderRadius: radius.md, backgroundColor: colors.fill },
  input: { flex: 1, minWidth: 0, ...type.callout, fontWeight: '400', color: colors.text, paddingVertical: Platform.OS === 'android' ? space.sm : space.md, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
}));
