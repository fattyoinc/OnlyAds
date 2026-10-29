import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, SectionList, Share, View } from 'react-native';

import { ListNameSheet } from '@/components/lists/ListSheets';
import { OfferCard } from '@/components/offers/OfferCard';
import { track as trackEvent } from '@/services/analytics';
import { remindersSupported } from '@/services/reminders';
import { useApp } from '@/state/AppState';
import { LIMITS } from '@/state/persistence';
import { makeStyles } from '@/theme';
import type { Offer } from '@/types/offer';
import { Banner, Button, Chip, LargeHeader, StateView, Text, useToast } from '@/ui';
import { distanceKm, formatMoney, isEndingSoon, isExpired } from '@/utils/format';

type Naming = { mode: 'create' } | { mode: 'rename'; id: string; name: string } | null;

export default function Saved() {
  const s = useStyles();
  const { saved, savedOrder, getOffer, anchor, now, toggleSave, lists, createList, renameList, deleteList, remindersEnabled, setRemindersEnabled } = useApp();
  const toast = useToast();
  const [listId, setListId] = useState<string | null>(null);
  const [naming, setNaming] = useState<Naming>(null);
  const [reminderPromptHidden, setReminderPromptHidden] = useState(false);
  const list = lists.find((l) => l.id === listId);

  const { sections, ended, items, anyExpiring } = useMemo(() => {
    // Prefer the live version of an offer; fall back to the saved snapshot.
    const ids = list ? list.offerIds : savedOrder;
    const items = ids.map((id) => getOffer(id) ?? saved[id]).filter(Boolean) as Offer[];
    const ended = items.filter((o) => isExpired(o, now));
    const soon = items.filter((o) => !isExpired(o, now) && isEndingSoon(o, now));
    const active = items.filter((o) => !isExpired(o, now) && !isEndingSoon(o, now));
    return {
      items,
      ended,
      anyExpiring: items.some((o) => o.expiresAt && !isExpired(o, now)),
      sections: [
        { key: 'soon', title: 'Ending soon', data: soon },
        { key: 'active', title: soon.length || ended.length ? (list ? 'In this list' : 'Saved') : '', data: active },
        { key: 'ended', title: 'Ended', data: ended },
      ].filter((x) => x.data.length),
    };
  }, [saved, savedOrder, getOffer, now, list]);

  const shareList = async () => {
    if (!list) return;
    const lines = items.filter((o) => !isExpired(o, now)).map((o) => `• ${o.title} — ${o.advertiser.name}${o.price ? ` (${formatMoney(o.price)})` : ''}\n  ${o.url}`);
    const message = `${list.name}\n\n${lines.join('\n')}\n\n(made with Only Ads)`;
    trackEvent('list_share');
    if (Platform.OS === 'web') {
      await Clipboard.setStringAsync(message).catch(() => {});
      toast({ message: 'List copied to clipboard', icon: 'content-copy' });
    } else Share.share({ message }).catch(() => {});
  };

  const showReminderPrompt = !remindersEnabled && !reminderPromptHidden && anyExpiring && remindersSupported();
  const subtitle = list
    ? `${list.offerIds.length} ${list.offerIds.length === 1 ? 'item' : 'items'}`
    : savedOrder.length
      ? `${savedOrder.length} ${savedOrder.length === 1 ? 'offer' : 'offers'} · kept even after deals change`
      : undefined;

  const header = (
    <View>
      <LargeHeader title={list ? list.name : 'Saved'} subtitle={subtitle} />
      {savedOrder.length || lists.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} accessibilityRole="tablist">
          <Chip label="All saved" selected={!list} onPress={() => setListId(null)} />
          {lists.map((l) => (
            <Chip key={l.id} label={`${l.name} · ${l.offerIds.length}`} selected={l.id === listId} onPress={() => setListId(l.id)} accessibilityLabel={`${l.name}, ${l.offerIds.length} items`} />
          ))}
          {lists.length < LIMITS.lists ? <Chip label="New list" icon="plus" onPress={() => setNaming({ mode: 'create' })} /> : null}
        </ScrollView>
      ) : null}
      {list ? (
        <View style={s.listActions}>
          <Button label="Share" icon="share-variant" iconPosition="leading" variant="secondary" size="md" onPress={shareList} disabled={!items.length} />
          <Button label="Rename" icon="pencil-outline" iconPosition="leading" variant="secondary" size="md" onPress={() => setNaming({ mode: 'rename', id: list.id, name: list.name })} />
          <Button
            label="Delete list"
            icon="trash-can-outline"
            iconPosition="leading"
            variant="secondary"
            size="md"
            onPress={() => {
              deleteList(list.id);
              setListId(null);
              toast({ message: 'List deleted — your saved offers are still here', icon: 'check' });
            }}
          />
        </View>
      ) : null}
      {showReminderPrompt ? (
        <View style={s.banner}>
          <Banner
            tone="info"
            icon="bell-outline"
            message="Get a heads-up before saved deals end"
            actionLabel="Turn on"
            onAction={async () => {
              const on = await setRemindersEnabled(true);
              setReminderPromptHidden(true);
              toast({ message: on ? 'Reminders on — a day before deals end' : 'Notifications are off for Only Ads in system settings', icon: on ? 'bell-check-outline' : 'bell-off-outline' });
            }}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={s.root}>
      <SectionList
        sections={sections}
        keyExtractor={(o) => o.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) =>
          section.title ? (
            <View style={s.sectionHead}>
              <Text variant="overline" tone={section.key === 'soon' ? 'warning' : 'secondary'} accessibilityRole="header">
                {section.title}
              </Text>
              {section.key === 'ended' && !list ? (
                <Pressable onPress={() => ended.forEach((o) => toggleSave(o))} accessibilityRole="button" accessibilityLabel="Remove all ended offers" hitSlop={12}>
                  <Text variant="subhead" style={{ textDecorationLine: 'underline' }}>
                    Remove ended
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={s.row}>
            <OfferCard offer={item} width={88} variant="row" distanceKm={item.location && anchor ? distanceKm(anchor, item.location) : undefined} now={now} />
          </View>
        )}
        ListEmptyComponent={
          list ? (
            <StateView icon="playlist-plus" title="This list is empty" message="Open any offer and tap “Add to a list”. Lists are great for gift ideas, a kitchen refresh, or anything you’re planning." />
          ) : (
            <StateView
              icon="heart-outline"
              title="Nothing saved yet"
              message="Tap the heart on any offer to keep it here. Saving also teaches your feed what you like."
              primary={{ label: 'Discover offers', icon: 'compass-outline', onPress: () => router.navigate('/') }}
            />
          )
        }
      />
      {naming ? (
        <ListNameSheet
          visible
          title={naming.mode === 'create' ? 'New list' : 'Rename list'}
          cta={naming.mode === 'create' ? 'Create list' : 'Save'}
          initial={naming.mode === 'rename' ? naming.name : ''}
          onSubmit={(name) => {
            if (naming.mode === 'rename') renameList(naming.id, name);
            else {
              const id = createList(name);
              if (id) setListId(id);
            }
          }}
          onClose={() => setNaming(null)}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  listActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
  banner: { paddingHorizontal: space.lg, paddingTop: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.xs },
  row: { paddingHorizontal: space.lg },
}));
