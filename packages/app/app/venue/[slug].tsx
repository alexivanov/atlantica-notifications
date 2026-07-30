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

/** A venue's hours, flags and full menu, with all-inclusive pricing. */
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
    // "Included or discounted" is what an all-inclusive guest cares about;
    // filtering to only "included" would hide the half-price cocktails.
    return menu.categories
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => i.allInclusive !== 'none'),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu, aiOnly]);

  if (!venue) {
    return (
      <View style={styles.centre}>
        <Text style={styles.muted}>Venue not found.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: venue.name }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {state && (
          <View style={[styles.status, state.open ? styles.statusOpen : null]}>
            <Text style={[styles.statusText, state.open && styles.statusTextOpen]}>
              {state.open
                ? `Open now · ${state.current ? formatPeriod(state.current) : ''}`
                : state.next
                  ? `Closed · opens ${state.next.from}`
                  : 'Closed'}
            </Text>
          </View>
        )}

        {venue.description && <Text style={styles.desc}>{venue.description}</Text>}

        {(venue.extraCharge ||
          venue.reservationRequired ||
          venue.weatherPermitting ||
          venue.restriction) && (
          <View style={styles.flags}>
            {venue.extraCharge && <Text style={styles.flag}>Extra charge</Text>}
            {venue.reservationRequired && (
              <Text style={styles.flag}>Reservation required</Text>
            )}
            {venue.weatherPermitting && (
              <Text style={styles.flag}>Weather permitting</Text>
            )}
            {venue.restriction && <Text style={styles.flag}>{venue.restriction}</Text>}
          </View>
        )}

        {venue.periods.length > 0 ? (
          <>
            <Text style={styles.section}>Hours</Text>
            {venue.periods.map((p, i) => (
              <Text key={i} style={styles.hours}>
                {formatPeriod(p)}
                {p.days ? `  (${p.days.join(', ')} only)` : ''}
                {p.exceptDays ? `  (except ${p.exceptDays.join(', ')})` : ''}
              </Text>
            ))}
          </>
        ) : venue.hoursNote ? (
          <>
            <Text style={styles.section}>Hours</Text>
            <Text style={styles.hours}>{venue.hoursNote}</Text>
          </>
        ) : null}

        {venue.bookingUrl && (
          <Pressable
            style={styles.bookBtn}
            // Hands off to Safari: the resort's booking host is plain HTTP on a
            // raw IP, which iOS blocks in-app, and it is only reachable on the
            // hotel network. Failing in the browser is at least visible.
            onPress={() => Linking.openURL(venue.bookingUrl!)}
          >
            <Text style={styles.bookText}>Book a table</Text>
          </Pressable>
        )}

        {menu && (
          <>
            <View style={styles.menuHead}>
              <Text style={styles.section}>Menu</Text>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>All-inclusive only</Text>
                <Switch
                  value={aiOnly}
                  onValueChange={setAiOnly}
                  trackColor={{ true: theme.accent, false: theme.card2 }}
                  thumbColor={theme.ink}
                />
              </View>
            </View>

            {menu.note && <Text style={styles.menuNote}>{menu.note}</Text>}

            {categories.map((cat) => (
              <View key={cat.name}>
                <Text style={styles.catName}>{cat.name}</Text>
                {cat.items.map((item, i) => (
                  <View key={`${item.name}-${i}`} style={styles.item}>
                    <View style={styles.itemBody}>
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
                          {/* Struck-through original next to what an
                              all-inclusive guest actually pays. */}
                          <Text style={styles.wasPrice}>{euro(item.price!)}</Text>
                          <Text style={styles.finalPrice}>
                            {euro(item.finalPrice)}
                          </Text>
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
              <Text style={styles.muted}>
                Nothing on this menu is included in all-inclusive.
              </Text>
            )}

            <Text style={styles.legend}>
              Prices shown for discounted items are what an all-inclusive guest
              pays. Menu prices and availability are as published by the resort.
            </Text>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  centre: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muted: { color: theme.muted, fontSize: 14, marginTop: 12 },
  status: {
    backgroundColor: theme.card2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 14,
  },
  statusOpen: { backgroundColor: 'rgba(127,209,193,0.16)' },
  statusText: { color: theme.muted, fontSize: 14, fontWeight: '600' },
  statusTextOpen: { color: theme.ok },
  desc: { color: theme.ink, fontSize: 15, lineHeight: 22, marginTop: 14 },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  flag: {
    color: theme.accent,
    fontSize: 12,
    backgroundColor: theme.card,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  section: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
  },
  hours: { color: theme.ink, fontSize: 15, lineHeight: 24 },
  bookBtn: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 20,
  },
  bookText: { color: '#24180b', fontSize: 15, fontWeight: '700' },
  menuHead: { marginTop: 4 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  toggleLabel: { color: theme.ink, fontSize: 15 },
  menuNote: { color: theme.accent, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  catName: {
    color: theme.accent,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 6,
  },
  item: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.card2,
  },
  itemBody: { flex: 1 },
  itemName: { color: theme.ink, fontSize: 15, lineHeight: 20 },
  itemDesc: { color: theme.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  priceCol: { alignItems: 'flex-end', minWidth: 74 },
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
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  included: { color: theme.ok, fontSize: 13, fontWeight: '600' },
  legend: { color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 24 },
});
