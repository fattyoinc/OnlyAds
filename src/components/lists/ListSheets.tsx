import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/state/AppState';
import { LIMITS } from '@/state/persistence';
import { makeStyles, useTheme } from '@/theme';
import type { Offer } from '@/types/offer';
import { Button, haptics, Icon, Text, useToast } from '@/ui';

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap} pointerEvents="box-none">
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
          <View style={s.handle} />
          <Text variant="headline" style={s.title} accessibilityRole="header">
            {title}
          </Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Name a new list, or rename one. Unmount (key) between uses so the field resets. */
export function ListNameSheet({ visible, initial = '', title, cta, onSubmit, onClose }: { visible: boolean; initial?: string; title: string; cta: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const s = useStyles();
  const { colors, scheme } = useTheme();
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0;
  const submit = () => {
    if (!ok) return;
    onSubmit(name);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={s.body}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Birthday gifts, Kitchen refresh"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          keyboardAppearance={scheme}
          maxLength={LIMITS.listName}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
          accessibilityLabel="List name"
          style={s.input}
        />
        <Button label={cta} onPress={submit} disabled={!ok} fullWidth />
      </View>
    </Sheet>
  );
}

/** Add/remove an offer from lists (multi-select), or start a new list with it. */
export function AddToListSheet({ offer, visible, onClose }: { offer: Offer; visible: boolean; onClose: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { lists, toggleInList, createList } = useApp();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  if (naming)
    return (
      <ListNameSheet
        visible
        title="New list"
        cta="Create and add"
        onSubmit={(n) => {
          if (createList(n, offer)) toast({ message: `Added to “${n.trim()}”`, icon: 'playlist-check' });
          else toast({ message: `You can have up to ${LIMITS.lists} lists`, icon: 'alert-circle-outline' });
        }}
        onClose={() => {
          setNaming(false);
          onClose();
        }}
      />
    );
  return (
    <Sheet visible={visible} onClose={onClose} title="Add to list">
      {lists.map((l) => {
        const on = l.offerIds.includes(offer.id);
        return (
          <Pressable
            key={l.id}
            onPress={() => {
              haptics.select();
              toggleInList(l.id, offer);
            }}
            android_ripple={{ color: colors.fillPressed }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${l.name}, ${l.offerIds.length} items`}
            style={s.row}
          >
            <View style={{ flex: 1 }}>
              <Text variant="callout" style={{ fontWeight: on ? '700' : '500' }} numberOfLines={1}>
                {l.name}
              </Text>
              <Text variant="footnote" tone="secondary">
                {l.offerIds.length} {l.offerIds.length === 1 ? 'item' : 'items'}
              </Text>
            </View>
            <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size="md" color={on ? colors.text : colors.textTertiary} />
          </Pressable>
        );
      })}
      <Pressable onPress={() => setNaming(true)} android_ripple={{ color: colors.fillPressed }} accessibilityRole="button" style={s.row} disabled={lists.length >= LIMITS.lists}>
        <Icon name="plus" size="md" color={colors.text} />
        <Text variant="callout" style={{ flex: 1, fontWeight: '600', marginLeft: 12 }}>
          {lists.length >= LIMITS.lists ? `List limit reached (${LIMITS.lists})` : 'New list'}
        </Text>
      </Pressable>
      <View style={s.body}>
        <Button label="Done" variant="secondary" onPress={onClose} fullWidth />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles(({ colors, radius, space, type }) => ({
  backdrop: { ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const), backgroundColor: colors.scrim },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.sm, maxHeight: '85%' },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: space.sm },
  title: { paddingHorizontal: space.xl, paddingVertical: space.md },
  body: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: space.xl, gap: space.md },
  input: { ...type.callout, fontWeight: '400', color: colors.text, minHeight: 48, paddingHorizontal: space.md + 2, borderRadius: radius.md, backgroundColor: colors.fill, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
}));
