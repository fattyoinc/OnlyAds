import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Animated, FlatList, Linking, Platform, Pressable, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddToListSheet } from '@/components/lists/ListSheets';
import { artBase, OfferArt } from '@/components/offers/OfferArt';
import { OfferCard } from '@/components/offers/OfferCard';
import { PriceTag } from '@/components/offers/PriceTag';
import { SaveButton } from '@/components/offers/SaveButton';
import { verifiedDiscount } from '@/components/offers/presentation';
import { config } from '@/config';
import { getCategory } from '@/data/categories';
import { reportError } from '@/services/monitoring';
import { scoreOffer } from '@/services/ranking';
import { isSafeHttpsUrl } from '@/services/urlSafety';
import { useApp } from '@/state/AppState';
import { artColors, layout, makeStyles, useTheme } from '@/theme';
import { Badge, Banner, Button, goBack, haptics, Icon, IconButton, NavBar, platformIcons, SectionHeader, Skeleton, StateView, Text, useContentWidth, useGuardedAction, useToast } from '@/ui';
import { distanceKm, expiryLabel, formatDate, formatDistance, formatMoney, hoursSinceVerified, isExpired, STALE_VERIFICATION_HOURS, verifiedLabel } from '@/utils/format';

function notify(title: string, msg: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

const SOURCE_LABEL = {
  sample: 'Demo catalog (fictional brand)',
  merchant_feed: 'Advertiser product feed',
  affiliate: 'Affiliate partner',
  direct: 'Direct advertiser',
} as const;

export default function OfferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const width = useContentWidth();
  const { colors, scheme } = useTheme();
  const toast = useToast();
  const app = useApp();
  const offer = app.getOffer(id);
  const [copied, setCopied] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [scrollY] = useState(() => new Animated.Value(0));

  const scored = useMemo(() => (offer ? scoreOffer(offer, { ...app.profile, location: app.anchor }, app.now) : undefined), [offer, app.profile, app.anchor, app.now]);
  const similar = useMemo(() => (offer ? app.feed.filter((x) => x.offer.id !== offer.id && x.offer.category === offer.category).slice(0, 8) : []), [offer, app.feed]);

  // Guarded so a double tap can't open two browser tabs.
  const getDeal = useGuardedAction(async () => {
    if (!offer) return;
    haptics.tap();
    app.track(offer, 'click');
    if (offer.source === 'sample') {
      notify('Demo offer', `In a real offer this opens ${offer.advertiser.name}’s page${offer.affiliate ? ' via a disclosed affiliate link' : ''}. This brand is fictional.`);
      return;
    }
    // Prefer our redirect (re-validates the link server-side); fall back to the validated URL.
    const target = offer.clickUrl ?? offer.url;
    const devLocal = config.env !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?\//.test(target);
    const safe: boolean = isSafeHttpsUrl(target, { allowPort: config.env !== 'production' }) || devLocal;
    if (!safe) {
      notify('Link unavailable', 'This offer’s link didn’t pass our safety checks.');
      return;
    }
    try {
      await Linking.openURL(target);
    } catch (e) {
      reportError(e, 'open-offer');
      notify('Couldn’t open link', 'Please try again in a moment.');
    }
  }, 1500);

  const notInterested = useGuardedAction(() => {
    if (!offer) return;
    app.track(offer, 'dismiss');
    toast({ message: 'Got it — we’ll show fewer offers like this.', icon: 'thumb-down-outline' });
    goBack();
  });

  const mute = useGuardedAction(() => {
    if (!offer) return;
    const adv = offer.advertiser;
    app.muteAdvertiser(adv.id);
    toast({ message: `${adv.name} muted`, icon: 'volume-off', actionLabel: 'Undo', onAction: () => app.unmuteAdvertiser(adv.id) });
    goBack();
  });

  if (!offer && app.firstLoadPending) {
    // Cold-start deep link: offers are still loading — show the page skeleton, not "not found".
    return (
      <View style={s.root} accessibilityLabel="Loading offer" accessibilityRole="progressbar">
        <Skeleton height={width} radius={0} />
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={14} width="40%" />
          <Skeleton height={28} width="85%" />
          <Skeleton height={24} width="30%" />
        </View>
        <NavBar overlay />
      </View>
    );
  }

  if (!offer) {
    return (
      <View style={s.root}>
        <NavBar />
        <StateView
          icon="tag-off-outline"
          title="This offer is no longer available"
          message="The advertiser may have ended it or removed it. There are plenty more waiting in Discover."
          primary={{ label: 'Back to Discover', icon: 'compass-outline', onPress: () => router.replace('/') }}
        />
      </View>
    );
  }

  const cat = getCategory(offer.category);
  const inLists = app.lists.filter((l) => l.offerIds.includes(offer.id));
  const ended = isExpired(offer, app.now);
  const discount = verifiedDiscount(offer);
  const dist = offer.location && app.anchor ? distanceKm(app.anchor, offer.location) : undefined;
  const brandColors = artColors(artBase(offer), scheme);
  const disclosures = [offer.sponsored && 'Sponsored', offer.affiliate && 'Affiliate link', (offer.source === 'sample' || offer.demo) && 'Demo — fictional brand'].filter(Boolean) as string[];

  const directions = () => {
    if (!offer.location) return;
    const { lat, lng } = offer.location;
    const label = encodeURIComponent(offer.location.placeName);
    const url = Platform.select({ ios: `https://maps.apple.com/?ll=${lat},${lng}&q=${label}`, default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` });
    Linking.openURL(url).catch(() => {});
  };

  const copyCode = async () => {
    if (!offer.promoCode) return;
    await Clipboard.setStringAsync(offer.promoCode);
    haptics.success();
    setCopied(true);
    toast({ message: `Code ${offer.promoCode} copied`, icon: 'content-copy', offset: 96 });
    setTimeout(() => setCopied(false), 1800);
  };

  const share = () => {
    const msg = `${offer.title} — ${offer.advertiser.name}${offer.price ? ` · ${formatMoney(offer.price)}` : ''} (found on Only Ads)`;
    if (Platform.OS === 'web') notify('Share', msg);
    else Share.share({ message: msg }).catch(() => {});
  };

  const reportAd = () => {
    if (!config.supportEmail) return;
    const subject = encodeURIComponent(`Report offer ${offer.id}`);
    const body = encodeURIComponent(`Offer: ${offer.title}\nAdvertiser: ${offer.advertiser.name}\n\nWhat’s wrong with this offer?\n`);
    Linking.openURL(`mailto:${config.supportEmail}?subject=${subject}&body=${body}`).catch(() => notify('No email app', `Email ${config.supportEmail} to report this offer.`));
  };

  const mediaH = Math.round(width * 0.92);

  return (
    <View style={s.root}>
      <Animated.ScrollView
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        <OfferArt offer={offer} width={width} glyphRatio={0.3} style={{ height: mediaH }}>
          {discount ? <Badge label={discount} tone="sale" style={s.mediaBadge} /> : null}
        </OfferArt>

        <View style={s.body}>
          {ended ? (
            <View style={{ marginBottom: 16 }}>
              <Banner tone="warning" icon="clock-alert-outline" message={`This offer ended${offer.expiresAt ? ` on ${formatDate(offer.expiresAt, { month: 'short', day: 'numeric' })}` : ''}. Similar offers are below.`} />
            </View>
          ) : null}

          <View style={s.brandRow}>
            <View style={[s.brandMark, { backgroundColor: brandColors.backdrop }]}>
              <Text variant="headline" style={{ color: brandColors.glyph, fontWeight: '900' }}>
                {offer.advertiser.name[0]}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {offer.advertiser.name}
                </Text>
                {offer.advertiser.verified ? (
                  <View accessible accessibilityLabel="Verified advertiser">
                    <Icon name="check-decagram" size="sm" color={colors.text} />
                  </View>
                ) : null}
              </View>
              <Text variant="footnote" tone="secondary">
                {cat.name}
                {offer.rating ? ` · ★ ${offer.rating.toFixed(1)}` : ''}
              </Text>
            </View>
          </View>

          {disclosures.length ? (
            <Text variant="caption" tone="secondary" style={s.disclosure}>
              {disclosures.join(' · ')}
            </Text>
          ) : null}

          <Text variant="title1" style={s.title} accessibilityRole="header">
            {offer.title}
          </Text>
          {offer.subtitle ? (
            <Text variant="callout" tone="secondary" style={{ marginTop: 4, fontWeight: '400' }}>
              {offer.subtitle}
            </Text>
          ) : null}

          <View style={s.priceBlock}>
            <PriceTag offer={offer} size="lg" />
            {offer.price && offer.originalPrice ? (
              <Text variant="subhead" tone="success" style={{ marginTop: 2, fontWeight: '700' }}>
                You save {formatMoney({ amount: offer.originalPrice.amount - offer.price.amount, currency: offer.price.currency })}
              </Text>
            ) : null}
          </View>

          {offer.expiresAt && !ended ? (
            <View style={s.infoLine}>
              <Icon name="clock-outline" size="sm" color={colors.textSecondary} />
              <Text variant="subhead" tone="secondary" style={{ fontWeight: '500' }}>
                {expiryLabel(offer, app.now)} · {formatDate(offer.expiresAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          ) : null}

          {verifiedLabel(offer, app.now) ? (
            <View style={s.infoLine}>
              <Icon name={(hoursSinceVerified(offer, app.now) ?? 0) > STALE_VERIFICATION_HOURS ? 'alert-circle-outline' : 'check-circle-outline'} size="sm" color={colors.textSecondary} />
              <Text variant="subhead" tone="secondary" style={{ fontWeight: '500', flex: 1 }}>
                {verifiedLabel(offer, app.now)}
                {(hoursSinceVerified(offer, app.now) ?? 0) > STALE_VERIFICATION_HOURS ? ' — details may have changed; confirm on the advertiser’s site.' : ' with the advertiser'}
              </Text>
            </View>
          ) : null}
          {offer.availability?.countries?.length ? (
            <View style={s.infoLine}>
              <Icon name="earth" size="sm" color={colors.textSecondary} />
              <Text variant="subhead" tone="secondary" style={{ fontWeight: '500', flex: 1 }}>
                Available in {offer.availability.countries.slice(0, 6).join(', ')}
                {offer.availability.countries.length > 6 ? ` +${offer.availability.countries.length - 6}` : ''}
              </Text>
            </View>
          ) : offer.availability?.online ? (
            <View style={s.infoLine}>
              <Icon name="web" size="sm" color={colors.textSecondary} />
              <Text variant="subhead" tone="secondary" style={{ fontWeight: '500' }}>
                Available online
              </Text>
            </View>
          ) : null}

          {offer.promoCode ? (
            <Pressable onPress={copyCode} style={s.code} accessibilityRole="button" accessibilityLabel={`Promo code ${offer.promoCode}. Double tap to copy`}>
              <View style={{ flex: 1 }}>
                <Text variant="overline" tone="secondary">
                  Promo code
                </Text>
                <Text variant="title3" style={{ letterSpacing: 1.5, marginTop: 2 }} selectable>
                  {offer.promoCode}
                </Text>
              </View>
              <View style={s.copyBtn}>
                <Icon name={copied ? 'check' : 'content-copy'} size="sm" color={colors.onInk} />
                <Text variant="subhead" tone="onInk" style={{ fontWeight: '700' }}>
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </View>
            </Pressable>
          ) : null}

          <Text variant="body" tone="secondary" style={s.description}>
            {offer.description}
          </Text>

          <View style={s.listRow}>
            <Button
              label={inLists.length ? `In ${inLists.length === 1 ? `“${inLists[0].name}”` : `${inLists.length} lists`}` : 'Add to a list'}
              icon={inLists.length ? 'playlist-check' : 'playlist-plus'}
              iconPosition="leading"
              variant="secondary"
              size="md"
              onPress={() => setListOpen(true)}
            />
          </View>
          {listOpen ? <AddToListSheet offer={offer} visible onClose={() => setListOpen(false)} /> : null}

          {offer.location ? (
            <Pressable onPress={directions} style={s.place} accessibilityRole="button" accessibilityLabel={`${offer.location.placeName}, ${offer.location.address}. Get directions`}>
              <View style={s.placeIcon}>
                <Icon name="map-marker-outline" size="md" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="headline">{offer.location.placeName}</Text>
                <Text variant="footnote" tone="secondary">
                  {offer.location.address}
                  {dist != null ? ` · ${formatDistance(dist)} away` : ''}
                </Text>
              </View>
              <Text variant="subhead" style={{ fontWeight: '700', textDecorationLine: 'underline' }}>
                Directions
              </Text>
            </Pressable>
          ) : null}

          <View style={s.why}>
            <Pressable onPress={() => setWhyOpen((v) => !v)} style={s.whyHead} accessibilityRole="button" accessibilityState={{ expanded: whyOpen }} accessibilityLabel="Why you’re seeing this">
              <Icon name="information-outline" size="md" />
              <Text variant="headline" style={{ flex: 1 }}>
                Why you’re seeing this
              </Text>
              <Icon name={whyOpen ? 'chevron-up' : 'chevron-down'} size="md" color={colors.textSecondary} />
            </Pressable>
            {whyOpen ? (
              <View style={{ marginTop: 8, gap: 6 }}>
                {scored?.reasons.map((r) => (
                  <Text key={r} variant="subhead" tone="secondary" style={{ fontWeight: '400' }}>
                    • {r}
                  </Text>
                ))}
                <Text variant="subhead" tone="secondary" style={{ fontWeight: '400' }}>
                  • Source: {SOURCE_LABEL[offer.source]}
                  {offer.sponsored ? ' · paid placement' : ''}
                </Text>
              </View>
            ) : null}
            <View style={s.controls}>
              <Button label="Not interested" icon="thumb-down-outline" iconPosition="leading" variant="secondary" size="md" onPress={notInterested} />
              <Button label="Mute brand" icon="volume-off" iconPosition="leading" variant="secondary" size="md" onPress={mute} />
              {config.supportEmail ? <Button label="Report" icon="flag-outline" iconPosition="leading" variant="secondary" size="md" onPress={reportAd} /> : null}
            </View>
          </View>
        </View>

        {similar.length ? (
          <View style={{ marginTop: 8 }}>
            <SectionHeader title={ended ? 'Similar offers still available' : `More in ${cat.name}`} action="See all" onAction={() => router.push({ pathname: '/category/[id]', params: { id: cat.id } })} />
            <FlatList
              horizontal
              data={similar}
              keyExtractor={(x) => x.offer.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: layout.inset, gap: layout.gutter }}
              renderItem={({ item }) => <OfferCard offer={item.offer} width={140} variant="compact" distanceKm={item.distanceKm} now={app.now} />}
            />
          </View>
        ) : null}
      </Animated.ScrollView>

      {/* Solid bar fades in once the media scrolls away, so floating buttons never sit on top of text. */}
      <Animated.View
        pointerEvents="none"
        style={[s.solidBar, { height: insets.top + 52, opacity: scrollY.interpolate({ inputRange: [mediaH - 140, mediaH - 70], outputRange: [0, 1], extrapolate: 'clamp' }) }]}
      >
        <Text variant="headline" numberOfLines={1} style={s.solidTitle}>
          {offer.advertiser.name}
        </Text>
      </Animated.View>

      <NavBar
        overlay
        right={
          <>
            <IconButton icon={platformIcons.share} label="Share" variant="overlay" onPress={share} />
            <View style={s.saveOverlay}>
              <SaveButton offer={offer} variant="plain" toastOffset={96} />
            </View>
          </>
        }
      />

      <View style={[s.ctaBar, { paddingBottom: insets.bottom + 10 }]}>
        <View style={{ flex: 1 }}>
          <PriceTag offer={offer} />
          <Text variant="caption" tone="secondary" numberOfLines={1} style={{ fontWeight: '400' }}>
            {ended ? 'This offer has ended' : offer.affiliate ? 'Affiliate link — we may earn a commission' : offer.advertiser.name}
          </Text>
        </View>
        <Button label={ended ? 'Offer ended' : offer.ctaLabel} icon={ended ? undefined : 'arrow-top-right'} onPress={getDeal} disabled={ended} accessibilityHint={ended ? undefined : `Opens ${offer.advertiser.name} in your browser`} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors, radius, space, elevation }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  solidBar: { position: 'absolute', top: 0, left: 0, right: 0, justifyContent: 'flex-end', paddingBottom: 14, backgroundColor: colors.canvas, borderBottomWidth: 1, borderBottomColor: colors.line, zIndex: 5 },
  solidTitle: { textAlign: 'center', marginHorizontal: 120 },
  mediaBadge: { position: 'absolute', left: space.lg, bottom: space.lg },
  body: { paddingHorizontal: space.lg, paddingTop: space.xl },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandMark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  disclosure: { marginTop: space.md, letterSpacing: 0.2 },
  title: { marginTop: space.sm },
  priceBlock: { marginTop: space.lg },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
  code: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl, padding: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.textTertiary },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.ink },
  description: { marginTop: space.xl },
  listRow: { flexDirection: 'row', marginTop: space.lg },
  place: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl, padding: space.lg, borderRadius: radius.md, backgroundColor: colors.fill },
  placeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas },
  why: { marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: space.xl },
  whyHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  saveOverlay: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlayButton, ...elevation(1) },
  ctaBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
}));
