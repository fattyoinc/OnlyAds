import { useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { config } from '@/config';
import { LEGAL_DOCS, type LegalDocId } from '@/legal/content';
import { makeStyles } from '@/theme';
import { Banner, goBack, NavBar, StateView, Text } from '@/ui';

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const content = doc && doc in LEGAL_DOCS ? LEGAL_DOCS[doc as LegalDocId] : undefined;

  return (
    <View style={s.root}>
      <NavBar title={content?.title} fallback="/profile" />
      {!content ? (
        <StateView icon="file-question-outline" title="Document not found" message="This page doesn’t exist." primary={{ label: 'Go back', onPress: () => goBack('/profile') }} />
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}>
          <Text variant="title1" accessibilityRole="header">
            {content.title}
          </Text>
          <Text variant="footnote" tone="secondary" style={{ marginTop: 4 }}>
            Last updated: {content.updated}
          </Text>
          {!content.reviewed && config.env !== 'production' ? (
            <View style={{ marginTop: 12 }}>
              <Banner tone="warning" icon="alert-outline" message="Draft pending legal review — not for publication." />
            </View>
          ) : null}
          {content.sections.map((sec) => (
            <View key={sec.heading} style={{ marginTop: 28 }}>
              <Text variant="title3" accessibilityRole="header">
                {sec.heading}
              </Text>
              {sec.body.map((p, i) => (
                <Text key={i} variant="body" tone="secondary" style={{ marginTop: 8 }}>
                  {p}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors, space }) => ({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, maxWidth: 680 },
}));
