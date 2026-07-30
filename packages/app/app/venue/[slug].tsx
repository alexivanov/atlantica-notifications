import { useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isOpenAt, timeOf, weekdayOf } from '@atlantica/shared';
import { VENUES, euro, formatPeriod, menuFor } from '../../src/dining';
import { RESORT_TZ, theme } from '../../src/theme';

/**
 * A venue: whether it is open, what it costs you, and the full menu.
 *
 * Laid out as discrete cards rather than one long ruled list -- a 165-item bar
 * menu is unreadable as a flat run, and boxing each category gives the eye
 * somewhere to stop.
 */
export default function VenueScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();
  const [aiOnly, setAiOnly] = useState(false);

  const venue = VENUES.find((v) => v.slug === slug);
  const menu = venue ? menuFor(venue) : null;

  const now = new Date();
  const state = venue
    ? isOpenAt(venue, weekdayOf(now, RESORT_TZ), timeOf(now, RESORT_TZ))
    : null;

  const categories = useMemo(() => {
    if (!menu) return [];
    if (!aiOnly) return menu.categories;
    // "Included or discounted" -- filtering to only "included" would hide the
    // half-price cocktails, which is most of what the filter is for.
    return menu.categories
      .map((c) => ({ ...c, items: c.items.filter((i) => i.allInclusive !== 'none') }))
      .filter((c) => c.items.length > 0);
  }, [menu, aiOnly]);

  if (!venue) {
    return (
      <View style={styles.centre}>
        <Text style={styles.muted}>Venue not found.</Text>
      </View>
    );
  }

  const flags = [
    venue.extraCharge && 'Extra charge',
    venue.reservationRequired && 'Reservation required',
    venue.weatherPermitting && 'Weather permitting',
    venue.restriction,
  ].filter(Boolean) as string[];

  const totalItems = menu
    ? menu.categories.reduce((n, c) => n + c.items.length, 0)
    : 0;
  const aiCount = menu
    ? menu.categories.reduce(
        (n, c) => n + c.items.filter((i) => i.allInclusive !== 'none').length,
        0,
      )
    : 0;
  // Pointless control if everything (or nothing) qualifies -- Ginger's whole
  // menu is all-inclusive, so the toggle would just sit there doing nothing.
  const showAiFilter = aiCount > 0 && aiCount < totalItems;

  return (
    <>
      <Stack.Screen options={{ title: venue.name }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {/* Status — the first thing you want to know. */}
        {state && (
          <View style={[styles.card, styles.statusCard, state.open && styles.statusOpen]}>
            <View style={[styles.dot, state.open ? styles.dotOpen : styles.dotShut]} />
            <View style={styles.flex}>
              <Text style={[styles.statusTitle, state.open && styles.statusTitleOpen]}>
                {state.open ? 'Open now' : 'Closed'}
              </Text>
              <Text style={styles.statusSub}>
                {state.open && state.current
                  ? formatPeriod(state.current)
                  : state.next
                    ? `Opens at ${state.next.from}`
                    : (venue.hoursNote ?? 'Hours not published')}
              </Text>
            </View>
          </View>
        )}

        {(venue.description || flags.length > 0) && (
          <View style={styles.card}>
            {venue.description && <Text style={styles.desc}>{venue.description}</Text>}
            {flags.length > 0 && (
              <View style={styles.chipRow}>
                {flags.map((f) => (
                  <Text key={f} style={styles.chip}>
                    {f}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {(venue.periods.length > 0 || venue.hoursNote) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Hours</Text>
            {venue.periods.length > 0 ? (
              venue.periods.map((p, i) => (
                <View key={i} style={styles.hoursRow}>
                  <Text style={styles.hoursLabel}>{p.label ?? 'Open'}</Text>
                  <Text style={styles.hoursValue}>
                    {p.from}–{p.to === '00:00' ? 'midnight' : p.to}
                    {p.days ? ` · ${p.days.join(', ')} only` : ''}
                    {p.exceptDays ? ` · except ${p.exceptDays.join(', ')}` : ''}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.muted}>{venue.hoursNote}</Text>
            )}
          </View>
        )}

        {venue.bookingUrl && (
          <Pressable
            style={styles.bookBtn}
            // Safari, not in-app: the booking host is plain HTTP on a raw IP,
            // which iOS blocks, and it only resolves on the hotel network.
            onPress={() => Linking.openURL(venue.bookingUrl!)}
          >
            <Text style={styles.bookText}>Book a table</Text>
          </Pressable>
        )}

        {menu && (
          <>
            <Text style={styles.section}>Menu</Text>

            {showAiFilter && (
              <View style={[styles.card, styles.filterCard]}>
                <View style={styles.flex}>
                  <Text style={styles.filterTitle}>All-inclusive only</Text>
                  <Text style={styles.filterSub}>
                    {aiCount} of {totalItems} items
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

            {!showAiFilter && aiCount === totalItems && totalItems > 0 && (
              <View style={[styles.card, styles.noteCard]}>
                <Text style={styles.noteText}>
                  Everything on this menu is covered by all-inclusive.
                </Text>
              </View>
            )}

            {menu.note && (
              <View style={[styles.card, styles.noteCard]}>
                <Text style={styles.noteText}>{menu.note}</Text>
              </View>
            )}

            {categories.map((cat) => (
              <View key={cat.name} style={styles.menuCard}>
                <View style={styles.catHeader}>
                  <Text style={styles.catName}>{cat.name}</Text>
                </View>

                {cat.items.map((item, i) => (
                  <View
                    key={`${item.name}-${i}`}
                    style={[styles.item, i === cat.items.length - 1 && styles.itemLast]}
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
            ))}

            {categories.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.muted}>
                  Nothing on this menu is included in all-inclusive.
                </Text>
              </View>
            )}

            <Text style={styles.legend}>
              Struck-through prices are the menu price; the figure beside it is
              what an all-inclusive guest pays. Prices and availability are as
              published by the resort.
            </Text>
          </>
        )}
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
  muted: { color: theme.muted, fontSize: 14, lineHeight: 20 },

  card: {
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
  },
  cardTitle: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusOpen: { backgroundColor: 'rgba(127,209,193,0.14)' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOpen: { backgroundColor: theme.ok },
  dotShut: { backgroundColor: theme.muted },
  statusTitle: { color: theme.ink, fontSize: 16, fontWeight: '700' },
  statusTitleOpen: { color: theme.ok },
  statusSub: { color: theme.muted, fontSize: 13, marginTop: 2 },

  desc: { color: theme.ink, fontSize: 15, lineHeight: 22 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: {
    color: theme.accent,
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: theme.card2,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    overflow: 'hidden',
  },

  hoursRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: 5,
    gap: 12,
  },
  hoursLabel: { color: theme.muted, fontSize: 14 },
  hoursValue: {
    color: theme.ink,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
    textAlign: 'right',
  },

  bookBtn: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  bookText: { color: '#24180b', fontSize: 15, fontWeight: '700' },

  section: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 28,
  },
  filterCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filterTitle: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  filterSub: { color: theme.muted, fontSize: 12, marginTop: 2 },
  noteCard: { backgroundColor: 'rgba(242,184,128,0.12)' },
  noteText: { color: theme.accent, fontSize: 13, lineHeight: 19 },

  menuCard: {
    backgroundColor: theme.card,
    borderRadius: 14,
    marginTop: 12,
    overflow: 'hidden',
  },
  catHeader: {
    backgroundColor: theme.card2,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  catName: {
    color: theme.ink,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
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
