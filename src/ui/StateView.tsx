import { View } from 'react-native';

import { makeStyles, useTheme } from '@/theme';
import { Button, type ButtonProps } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Action = Pick<ButtonProps, 'label' | 'onPress' | 'icon' | 'loading'>;

/**
 * Empty / error / permission state: always says what happened and offers a next step.
 */
export function StateView({ icon, title, message, primary, secondary, tone = 'neutral', compact }: { icon: IconName; title: string; message: string; primary?: Action; secondary?: Action; tone?: 'neutral' | 'error'; compact?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[s.root, compact && s.compact]} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <View style={[s.iconWrap, tone === 'error' && { backgroundColor: colors.dangerSoft }]}>
        <Icon name={icon} size={30} color={tone === 'error' ? colors.danger : colors.text} />
      </View>
      <Text variant="title3" align="center" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="callout" tone="secondary" align="center" style={s.message}>
        {message}
      </Text>
      {primary || secondary ? (
        <View style={s.actions}>
          {primary ? <Button {...primary} variant="primary" size="md" /> : null}
          {secondary ? <Button {...secondary} variant="secondary" size="md" /> : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors, space }) => ({
  root: { alignItems: 'center', paddingHorizontal: space.xxxl, paddingVertical: space.huge },
  compact: { paddingVertical: space.xxl },
  iconWrap: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill, marginBottom: space.lg },
  message: { marginTop: space.sm, fontWeight: '400', maxWidth: 320 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.xl },
}));
