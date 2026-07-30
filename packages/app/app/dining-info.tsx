import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INFO_PAGES } from '../src/dining';
import { theme } from '../src/theme';

/**
 * Dining reference: dress code, allergy sheets, all-inclusive terms, snack
 * packs. PDFs open in Safari — they are large scanned sheets that an in-app
 * viewer would render worse, and the system viewer handles zoom and sharing.
 */
export default function DiningInfoScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
    >
      {INFO_PAGES.map((page) => {
        const pdfs = page.pdfs ?? (page.pdf ? [page.pdf] : []);
        return (
          <View key={page.slug} style={styles.card}>
            <Text style={styles.title}>{page.title}</Text>
            {page.body && <Text style={styles.body}>{page.body}</Text>}

            {pdfs.map((url, i) => (
              <Pressable
                key={url}
                style={styles.link}
                onPress={() => Linking.openURL(url)}
              >
                <Text style={styles.linkText}>
                  {pdfs.length > 1 ? `Open sheet ${i + 1}` : 'Open PDF'}
                </Text>
              </Pressable>
            ))}

            {page.bookingUrl && (
              <Pressable
                style={styles.link}
                onPress={() => Linking.openURL(page.bookingUrl!)}
              >
                <Text style={styles.linkText}>Book</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <Text style={styles.footnote}>
        Booking links open in Safari and only work on the hotel network.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  card: {
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
  },
  title: { color: theme.ink, fontSize: 16, fontWeight: '600' },
  body: { color: theme.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  link: {
    backgroundColor: theme.card2,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  linkText: { color: theme.ink, fontSize: 14, fontWeight: '600' },
  footnote: { color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 22 },
});
