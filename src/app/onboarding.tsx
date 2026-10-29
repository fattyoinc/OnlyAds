import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Platform, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CATEGORIES } from '@/data/categories';
import { useApp } from '@/state/AppState';
import { artColors, makeStyles, useTheme } from '@/theme';
import { Button, Chip, Icon, Text, useContentWidth, useGuardedAction } from '@/ui';

/** Four "ad" tiles that preview what the app is about — built from categories, so it works in production. */
const PREVIEW = ['sneakers', 'food', 'beauty', 'travel'] as const;

function Preview() {
  const s = useStyles();
  const { scheme, reduceMotion } = useTheme();
  const width = useContentWidth();
  const tileW = (width - 16 * 2 - 12) / 2;
  const anims = useState(() => PREVIEW.map(() => new Animated.Value(reduceMotion ? 1 : 0)))[0];
  useEffect(() => {
    if (reduceMotion) return;
    Animated.stagger(70, anims.map((a) => Animated.timing(a, { toValue: 1, duration: 360, useNativeDriver: true }))).start();
  }, [anims, reduceMotion]);
  
  return (
    <View style={s.preview} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {[0, 1].map((col) => (
        <View key={col} style={{ gap: 12, marginTop: col === 1 ? 20 : 0 }}>
          {PREVIEW.filter((_, i) => i % 2 === col).map((id, j) => {
            const i = col + j * 2;
            const cat = CATEGORIES.find((c) => c.id === id)!;
            const c = artColors(cat.colors[0], scheme);
            return (
              <Animated.View
                key={id}
                style={[
                  s.tile,
                  { width: tileW, height: 100, backgroundColor: c.backdrop, opacity: anims[i] },
                  !reduceMotion && { transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
                ]}
              >
                <Icon name={cat.icon} size={44} color={c.glyph} />
              </Animated.View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function Onboarding() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { profile, toggleInterest, completeOnboarding, analyticsConsent, setAnalyticsConsent } = useApp();
  const { colors } = useTheme();
  const n = profile.interests.length;

  const start = useGuardedAction(() => {
    completeOnboarding();
    router.replace('/');
  });

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.scroll, { paddingTop: insets.top + 12 }]} showsVerticalScrollIndicator={false}>
        <View style={s.brand} accessible accessibilityRole="header" accessibilityLabel="Only Ads">
          <View style={s.dot} />
          <Text variant="headline" style={s.wordmark}>
            only ads
          </Text>
        </View>
        <Preview />
        <Text variant="display" style={s.title}>
          The ads you{'\n'}actually want.
        </Text>
        <Text variant="body" tone="secondary" style={s.lead}>
          Deals, drops and local finds — only when you feel like looking. No account needed.
        </Text>

        <Text variant="headline" style={s.question}>
          What are you into?{' '}
          <Text variant="headline" tone="tertiary" style={{ fontWeight: '400' }}>
            Optional
          </Text>
        </Text>
        <View style={s.chips}>
          {CATEGORIES.map((c) => (
            <Chip key={c.id} label={c.name} icon={c.icon} showCheck selected={profile.interests.includes(c.id)} onPress={() => toggleInterest(c.id)} />
          ))}
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={s.consent}>
          <View style={{ flex: 1 }}>
            <Text variant="subhead" style={{ fontWeight: '600' }}>
              Share anonymous usage stats
            </Text>
            <Text variant="caption" tone="secondary" style={{ fontWeight: '400' }}>
              Daily counts only — no account, no ID, no location. Change anytime in You.
            </Text>
          </View>
          <Switch
            value={analyticsConsent}
            onValueChange={setAnalyticsConsent}
            accessibilityLabel="Share anonymous usage stats"
            trackColor={{ true: Platform.OS === 'ios' ? '#34C759' : colors.ink, false: colors.fillPressed }}
            thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
          />
        </View>
        <Button label={n ? `Start exploring · ${n} picked` : 'Start exploring'} icon="arrow-right" fullWidth onPress={start} />
        <Text variant="footnote" tone="secondary" align="center" style={{ marginTop: 10 }}>
          Your picks stay on this phone.
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  scroll: { paddingHorizontal: space.lg, paddingBottom: 160 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  wordmark: { fontSize: 18, fontWeight: '900', letterSpacing: -0.6 },
  preview: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xl, height: 232 },
  tile: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: space.xxl },
  lead: { marginTop: space.sm },
  question: { marginTop: space.xxxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  consent: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.canvas, borderTopWidth: 1, borderTopColor: colors.line },
}));
