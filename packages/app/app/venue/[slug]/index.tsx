import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isOpenAt, timeOf, weekdayOf } from '@atlantica/shared';
import { VENUES, formatPeriod, menuFor } from '../../../src/dining';
import { RESORT_TZ, theme } from '../../../src/theme';

/**
 * A venue: whether it is open, what it costs, and its menu *sections*.
 *
 * Items live one level down. A bar menu runs to 165 items across 29 categories,
 * which is an unreadable wall on one screen -- listing sections first makes it
 * navigable.
 */
export default function VenueScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const insets = useSafeAreaInsets();

  const venue = VENUES.find((v) => v.slug === slug);
  const menu = venue ? menuFor(venue) : null;

  const now = new Date();
  const state = venue
    ? isOpenAt(venue, weekdayOf(now, RESORT_TZ), timeOf(now, RESORT_TZ))
    : null;

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

  return (
    <>
      <Stack.Screen options={{ title: venue.name }} />
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        {state && (
          <View
            style={[styles.card, styles.statusCard, state.open && styles.statusOpen]}
          >
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

        {venue.kind === 'bar' && (
          <Link
            href={{ pathname: '/lucky', params: { venue: venue.slug } }}
            asChild
          >
            <Pressable style={styles.luckyBtn}>
              <Text style={styles.luckyIcon}>◍</Text>
              <Text style={styles.luckyText}>Feeling lucky — pick me a drink</Text>
            </Pressable>
          </Link>
        )}

        {menu && menu.categories.length > 0 && (
          <>
            <Text style={styles.section}>Menu</Text>

            {menu.note && (
              <View style={[styles.card, styles.noteCard]}>
                <Text style={styles.noteText}>{menu.note}</Text>
              </View>
            )}

            {menu.categories.map((cat, i) => {
              const included = cat.items.filter(
                (it) => it.allInclusive !== 'none',
              ).length;
              return (
                <Link
                  key={cat.name}
                  // Indexed, not named: category names contain commas,
                  // ampersands and slashes that do not belong in a URL segment.
                  href={{
                    pathname: '/venue/[slug]/[cat]',
                    params: { slug: venue.slug, cat: String(i) },
                  }}
                  asChild
                >
                  <Pressable style={styles.catRow}>
                    <View style={styles.flex}>
                      <Text style={styles.catName}>{cat.name}</Text>
                      <Text style={styles.catMeta}>
                        {cat.items.length} item{cat.items.length === 1 ? '' : 's'}
                        {included > 0 &&
                          ` · ${
                            included === cat.items.length ? 'all' : included
                          } all-inclusive`}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                </Link>
              );
            })}
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
  noteCard: { backgroundColor: 'rgba(242,184,128,0.12)' },
  noteText: { color: theme.accent, fontSize: 13, lineHeight: 19 },

  luckyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: theme.card2,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 12,
  },
  luckyIcon: { color: theme.accent, fontSize: 16 },
  luckyText: { color: theme.ink, fontSize: 14, fontWeight: '600' },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 8,
    gap: 12,
  },
  catName: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  catMeta: { color: theme.muted, fontSize: 12, marginTop: 3 },
  chevron: { color: theme.muted, fontSize: 20 },
});
