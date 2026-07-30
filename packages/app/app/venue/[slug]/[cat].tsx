import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VENUES, euro, menuFor } from '../../../src/dining';
import { theme } from '../../../src/theme';

/**
 * Items within one menu category.
 *
 * Reached from the venue's section list. The category is addressed by index
 * because the names contain commas, ampersands and slashes.
 */
export default function CategoryScreen() {
  const { slug, cat } = useLocalSearchParams<{ slug: string; cat: string }>();
  const insets = useSafeAreaInsets();
  const [aiOnly, setAiOnly] = useState(false);

  const venue = VENUES.find((v) => v.slug === slug);
  const menu = venue ? menuFor(venue) : null;
  const category = menu?.categories[Number(cat)];

  const items = useMemo(() => {
    if (!category) return [];
    // "Included or discounted": filtering to only "included" would hide the
    // half-price items, which is most of what the filter is for.
    return aiOnly
      ? category.items.filter((i) => i.allInclusive !== 'none')
      : category.items;
  }, [category, aiOnly]);

  if (!venue || !category) {
    return (
      <View style={styles.centre}>
        <Text style={styles.muted}>Menu section not found.</Text>
      </View>
    );
  }

  const aiCount = category.items.filter((i) => i.allInclusive !== 'none').length;
  // A toggle that changes nothing is worse than no toggle.
  const showFilter = aiCount > 0 && aiCount < category.items.length;

  return (
    <>
      <Stack.Screen options={{ title: category.name }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {showFilter && (
          <View style={styles.filterCard}>
            <View style={styles.flex}>
              <Text style={styles.filterTitle}>All-inclusive only</Text>
              <Text style={styles.filterSub}>
                {aiCount} of {category.items.length} items
              </Text>
            </View>
            <Switch
              value={aiOnly}
              onValueChange={setAiOnly}
              trackColor={{ true: theme.accent, false: theme.card2 }}
              thumbColor={theme.ink}
            />
          </View>
        )}

        {!showFilter && aiCount === category.items.length && (
          <View style={styles.noteCard}>
            <Text style={styles.noteText}>
              Everything here is covered by all-inclusive.
            </Text>
          </View>
        )}

        <View style={styles.menuCard}>
          {items.map((item, i) => (
            <View
              key={`${item.name}-${i}`}
              style={[styles.item, i === items.length - 1 && styles.itemLast]}
            >
              <View style={styles.flex}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.description && (
                  <Text style={styles.itemDesc}>{item.description}</Text>
                )}
              </View>

              <View style={styles.priceCol}>
                {item.allInclusive === 'included' ? (
                  <Text style={styles.included}>Included</Text>
                ) : item.allInclusive === 'discounted' &&
                  item.finalPrice !== undefined ? (
                  <>
                    <Text style={styles.wasPrice}>{euro(item.price!)}</Text>
                    <Text style={styles.finalPrice}>{euro(item.finalPrice)}</Text>
                  </>
                ) : item.price !== undefined ? (
                  <Text style={styles.price}>{euro(item.price)}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.legend}>
          Struck-through prices are the menu price; the figure beside it is what
          an all-inclusive guest pays. Prices and availability are as published
          by the resort.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  flex: { flex: 1 },
  centre: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muted: { color: theme.muted, fontSize: 14 },

  filterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
  },
  filterTitle: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  filterSub: { color: theme.muted, fontSize: 12, marginTop: 2 },

  noteCard: {
    backgroundColor: 'rgba(242,184,128,0.12)',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  noteText: { color: theme.accent, fontSize: 13, lineHeight: 19 },

  menuCard: {
    backgroundColor: theme.card,
    borderRadius: 14,
    marginTop: 12,
    overflow: 'hidden',
  },
  item: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.card2,
  },
  itemLast: { borderBottomWidth: 0 },
  itemName: { color: theme.ink, fontSize: 15, lineHeight: 20 },
  itemDesc: { color: theme.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
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
    marginTop: 1,
  },
  included: { color: theme.ok, fontSize: 12, fontWeight: '700' },

  legend: { color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 22 },
});
