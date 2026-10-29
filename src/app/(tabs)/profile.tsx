import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Platform, ScrollView, View } from 'react-native';

import { config } from '@/config';
import { CATEGORIES, getCategory } from '@/data/categories';
import { recentErrors } from '@/services/monitoring';
import { remindersSupported } from '@/services/reminders';
import { useApp } from '@/state/AppState';
import { makeStyles, useTheme } from '@/theme';
import type { CategoryId } from '@/types/offer';
import { Chip, LargeHeader, ListGroup, ListRow, Text } from '@/ui';

function confirm(title: string, msg: string, action: string, onYes: () => void | Promise<void>) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${msg}`)) onYes();
  } else Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: () => void onYes() }]);
}

const STATUS = { simulated: 'Demo', live: 'Connected', disabled: 'Not connected' } as const;

export default function Profile() {
  const s = useStyles();
  const { colors } = useTheme();
  const app = useApp();
  const { profile } = app;
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const learned = (Object.entries(profile.categoryAffinity) as [CategoryId, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const maxAff = Math.max(1, ...learned.map(([, v]) => v));
  const muted = profile.mutedAdvertiserIds.map((id) => ({ id, name: app.offers.find((o) => o.advertiser.id === id)?.advertiser.name ?? id }));

  return (
    <ScrollView style={s.root} contentContainerStyle={{ paddingBottom: 48 }}>
      <LargeHeader title="You" subtitle="Everything that shapes your feed lives on this phone." />

      <View style={s.block}>
        <Text variant="headline">Your interests</Text>
        <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
          Followed categories rank higher in Discover.
        </Text>
        <View style={s.chips}>
          {CATEGORIES.map((c) => (
            <Chip key={c.id} label={c.name} icon={c.icon} showCheck selected={profile.interests.includes(c.id)} onPress={() => app.toggleInterest(c.id)} />
          ))}
        </View>
      </View>

      {learned.length ? (
        <View style={s.block}>
          <Text variant="headline">What we’ve learned</Text>
          <Text variant="footnote" tone="secondary" style={{ marginTop: 2, marginBottom: 10 }}>
            From offers you open, save or hide.
          </Text>
          {learned.map(([id, v]) => (
            <View key={id} style={s.barRow} accessible accessibilityLabel={`${getCategory(id).name}, ${Math.round((v / maxAff) * 100)} percent`}>
              <Text variant="subhead" style={s.barLabel} numberOfLines={1}>
                {getCategory(id).name}
              </Text>
              <View style={s.barTrack}>
                <View style={[s.barFill, { width: `${Math.max(6, (v / maxAff) * 100)}%` }]} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <ListGroup title="Privacy & personalization" footer="Location is approximate (about 1 km), used only while the app is open, and never shared with advertisers.">
        <ListRow
          icon="map-marker-outline"
          title="Nearby deals"
          subtitle={app.locationState === 'denied' ? 'Blocked in system settings' : app.locationEnabled ? 'Using approximate location' : 'Off'}
          toggle={{ value: app.locationEnabled, onChange: (v) => (v ? void app.enableLocation() : app.disableLocation()), disabled: app.locationState === 'requesting' }}
        />
        {app.locationState === 'denied' ? <ListRow icon="cog-outline" title="Open system settings" onPress={() => Linking.openSettings().catch(() => {})} /> : null}
        <ListRow
          icon="chart-box-outline"
          title="Anonymous usage stats"
          subtitle="Daily counts of opens, searches, views and clicks. No ID, no location."
          toggle={{ value: app.analyticsConsent, onChange: app.setAnalyticsConsent }}
        />
        {remindersSupported() ? (
          <ListRow
            icon="bell-outline"
            title="Saved-deal reminders"
            subtitle="A notification a day before a saved deal ends. Scheduled on this device only."
            toggle={{ value: app.remindersEnabled, onChange: (v) => void app.setRemindersEnabled(v) }}
          />
        ) : null}
        <ListRow icon="volume-off" title="Muted brands" value={muted.length ? String(muted.length) : 'None'} />
        <ListRow
          icon="restore"
          title="Reset what we’ve learned"
          subtitle="Keeps your interests and saved offers"
          onPress={() => confirm('Reset learned preferences?', 'Your interests and saved offers are kept.', 'Reset', app.resetPersonalization)}
          last
        />
      </ListGroup>
      {muted.length ? (
        <View style={[s.chips, { paddingHorizontal: 16 }]}>
          {muted.map((m) => (
            <Chip key={m.id} label={m.name} trailingIcon="close" onPress={() => app.unmuteAdvertiser(m.id)} accessibilityLabel={`Unmute ${m.name}`} />
          ))}
        </View>
      ) : null}

      <ListGroup title="Where offers come from" footer="Sponsored placements and affiliate links are always labeled. Paid placement never outranks relevance.">
        {app.providers.map((p, i) => {
          const err = app.providerErrors.find((e) => e.providerId === p.id);
          return <ListRow key={p.id} icon={p.id === 'sample' ? 'flask-outline' : 'storefront-outline'} title={p.label} subtitle={err ? err.message : p.description} value={STATUS[p.status]} last={i === app.providers.length - 1} />;
        })}
      </ListGroup>

      <ListGroup title="Legal & support">
        <ListRow icon="shield-lock-outline" title="Privacy Policy" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })} />
        <ListRow icon="file-document-outline" title="Terms of Use" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })} last={!config.supportEmail} />
        {config.supportEmail ? <ListRow icon="email-outline" title="Contact support" onPress={() => Linking.openURL(`mailto:${config.supportEmail}`).catch(() => {})} last /> : null}
      </ListGroup>

      <ListGroup title="Your data" footer="Stored on this phone only: interests, saved offers, activity counts, recent searches and (if on) a rounded location. No account. Nothing is sold.">
        <ListRow
          icon="delete-outline"
          title="Erase all my data"
          destructive
          onPress={() =>
            confirm('Erase all data?', 'This clears interests, saved offers and history, and restarts the app.', 'Erase', async () => {
              await app.resetAll();
              router.replace('/onboarding');
            })
          }
          last
        />
      </ListGroup>

      <ListGroup title="About">
        <ListRow icon="information-outline" title="Version" value={`${Constants.expoConfig?.version ?? '?'} · ${config.env}`} />
        <ListRow icon="stethoscope" title="Diagnostics" subtitle="No personal data" onPress={() => setShowDiagnostics((v) => !v)} last />
      </ListGroup>
      {showDiagnostics ? (
        <Text variant="footnote" tone="secondary" style={s.diag} selectable>
          Offers API: {config.apiUrl ? 'configured' : 'not configured'}
          {'\n'}Recent errors: {recentErrors().length}
          {recentErrors()
            .slice(-3)
            .map((e) => `\n• ${e.context ?? ''} ${e.message}`)
            .join('')}
          {config.warnings.map((w) => `\n⚠ ${w}`).join('')}
        </Text>
      ) : null}
      <View style={{ height: 1, backgroundColor: colors.canvas }} />
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors, radius, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  block: { paddingHorizontal: space.lg, marginTop: space.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  barLabel: { width: 112 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.fill, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.ink },
  diag: { marginHorizontal: space.xl, marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.fill },
}));
