import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { euro, searchMenus } from '../src/dining';
import { theme } from '../src/theme';

/**
 * Search every menu at once.
 *
 * 700 items across 10 venues is past the point of browsing — this answers
 * "where do I get a mojito, and is it included" in one step. Everything is
 * bundled, so it works offline and needs no debouncing.
 */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const hits = useMemo(() => searchMenus(query), [query]);
  const tooShort = query.trim().length > 0 && query.trim().length < 2;

  return (
    <View style={styles.root}>
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Mojito, gin, salad…"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {query.trim().length === 0 && (
          <Text style={styles.hint}>
            Search across every restaurant and bar menu — 700 items.
          </Text>
        )}

        {tooShort && <Text style={styles.hint}>Keep typing…</Text>}

        {query.trim().length >= 2 && hits.length === 0 && (
          <Text style={styles.hint}>Nothing matches “{query.trim()}”.</Text>
        )}

        {hits.length > 0 && (
          <Text style={styles.count}>
            {hits.length} {hits.length === 1 ? 'match' : 'matches'}
          </Text>
        )}

        {hits.map((hit, i) => (
          <Link
            key={`${hit.venueSlug}-${hit.categoryIndex}-${hit.item.name}-${i}`}
            href={{
              pathname: '/venue/[slug]/[cat]',
              params: { slug: hit.venueSlug, cat: String(hit.categoryIndex) },
            }}
            asChild
          >
            <Pressable style={styles.hit}>
              <View style={styles.flex}>
                <Text style={styles.itemName}>{hit.item.name}</Text>
                <Text style={styles.where}>
                  {hit.venueName} · {hit.categoryName}
                </Text>
                {hit.item.description && (
                  <Text style={styles.desc} numberOfLines={2}>
                    {hit.item.description}
                  </Text>
                )}
              </View>

              <View style={styles.priceCol}>
                {hit.item.allInclusive === 'included' ? (
                  <Text style={styles.included}>Included</Text>
                ) : hit.item.allInclusive === 'discounted' &&
                  hit.item.finalPrice !== undefined ? (
                  <>
                    <Text style={styles.wasPrice}>{euro(hit.item.price!)}</Text>
                    <Text style={styles.finalPrice}>{euro(hit.item.finalPrice)}</Text>
                  </>
                ) : hit.item.price !== undefined ? (
                  <Text style={styles.price}>{euro(hit.item.price)}</Text>
                ) : null}
              </View>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    marginTop: 12,
  },
  searchIcon: { color: theme.muted, fontSize: 20 },
  input: {
    flex: 1,
    color: theme.ink,
    fontSize: 16,
    paddingVertical: 13,
  },
  list: { flex: 1, paddingHorizontal: 16 },
  hint: { color: theme.muted, fontSize: 14, lineHeight: 21, marginTop: 20 },
  count: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 4,
  },
  hit: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  itemName: { color: theme.ink, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  where: { color: theme.accent, fontSize: 12, marginTop: 3 },
  desc: { color: theme.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  priceCol: { alignItems: 'flex-end', minWidth: 72 },
  price: { color: theme.ink, fontSize: 15, fontVariant: ['tabular-nums'] },
  wasPrice: {
    color: theme.muted,
    fontSize: 12,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  finalPrice: {
    color: theme.ok,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  included: { color: theme.ok, fontSize: 12, fontWeight: '700' },
});
