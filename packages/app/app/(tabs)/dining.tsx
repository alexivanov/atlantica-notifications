import { useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  formatPeriod,
  themeTonight,
  upcomingSpecialEvents,
  venueStatuses,
  type VenueStatus,
} from '../../src/dining';
import { theme } from '../../src/theme';

/**
 * "What is open now" — the question actually asked at a resort.
 *
 * All data is bundled, so this screen works with no network.
 */
export default function DiningScreen() {
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());

  // Re-evaluate on foreground and every minute, so a venue closing at 18:00
  // does not sit there claiming to be open.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setNow(new Date());
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, []);

  const statuses = venueStatuses(now);
  const theme_ = themeTonight(now);
  const events = upcomingSpecialEvents(now);

  const groups: { key: VenueStatus['group']; title: string }[] = [
    { key: 'open', title: 'Open now' },
    { key: 'later', title: 'Opens later today' },
    { key: 'closed', title: 'Closed' },
  ];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
    >
      {theme_ && (
        <View style={styles.themeCard}>
          <Text style={styles.themeLabel}>TONIGHT AT AGORA</Text>
          <Text style={styles.themeName}>{theme_}</Text>
        </View>
      )}


      {groups.map(({ key, title }) => {
        const items = statuses.filter((s) => s.group === key);
        if (items.length === 0) return null;
        return (
          <View key={key}>
            <Text style={styles.section}>{title}</Text>
            {items.map(({ venue, state }) => (
              <Link
                key={venue.slug}
                href={{ pathname: '/venue/[slug]', params: { slug: venue.slug } }}
                asChild
              >
                <Pressable
                  // Flattened deliberately: expo-router's Link with asChild
                  // rejects a style ARRAY on its child, so the conditional has
                  // to be resolved here rather than left for RN to merge.
                  style={StyleSheet.flatten([
                    styles.row,
                    key !== 'open' && styles.rowDim,
                  ])}
                  accessibilityRole="button"
                  accessibilityLabel={`${venue.name}, ${
                    state.open ? 'open now' : 'closed'
                  }`}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.venueName}>{venue.name}</Text>
                    <Text style={styles.venueHours}>
                      {state.open && state.current
                        ? formatPeriod(state.current)
                        : state.next
                          ? `Opens ${state.next.from}`
                          : venue.periods.length > 0
                            ? // It has hours, they have just finished for today.
                              // Saying "not published" here was simply untrue.
                              `${formatPeriod(venue.periods[0])} · done for today`
                            : (venue.hoursNote ?? 'Hours not published')}
                    </Text>
                    {(venue.extraCharge || venue.restriction) && (
                      <Text style={styles.venueFlags}>
                        {[
                          venue.extraCharge ? 'Extra charge' : null,
                          venue.reservationRequired ? 'Reservation required' : null,
                          venue.restriction,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    )}
                  </View>
                  {state.open && <View style={styles.openDot} />}
                  <Text style={styles.chevron}>›</Text>
                </Pressable>
              </Link>
            ))}
          </View>
        );
      })}

      {events.length > 0 && (
        <Text style={styles.section}>Special dinners</Text>
      )}

      {events.map((e) => (
        <View key={e.name} style={styles.eventCard}>
          <Text style={styles.eventLabel}>
            {new Date(`${e.date}T12:00:00Z`).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </Text>
          <Text style={styles.eventName}>{e.chef ?? e.name}</Text>
          <Text style={styles.eventMeta}>
            {[e.accolade, e.venue, e.price].filter(Boolean).join(' · ')}
          </Text>
          {e.description && <Text style={styles.eventDesc}>{e.description}</Text>}
          <Text style={styles.eventBook}>Book at the Reception Desk.</Text>
        </View>
      ))}

      <Text style={styles.section}>Good to know</Text>
      <Link href="/dining-info" asChild>
        <Pressable style={styles.row}>
          <View style={styles.rowBody}>
            <Text style={styles.venueName}>Dress code, allergies & more</Text>
            <Text style={styles.venueHours}>
              All-inclusive, snack packs, early breakfast
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </Link>

      <Text style={styles.footnote}>
        Hours are as published by the resort and can change. Some outlets operate
        weather permitting.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
  section: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 26,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  rowDim: { opacity: 0.55 },
  rowBody: { flex: 1 },
  venueName: { color: theme.ink, fontSize: 16, fontWeight: '600' },
  venueHours: { color: theme.muted, fontSize: 13, marginTop: 3 },
  venueFlags: { color: theme.accent, fontSize: 12, marginTop: 4 },
  openDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.ok,
    marginRight: 10,
  },
  chevron: { color: theme.muted, fontSize: 20 },
  themeCard: {
    backgroundColor: theme.card2,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: theme.entertainment,
  },
  themeLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  themeName: { color: theme.ink, fontSize: 19, fontWeight: '600', marginTop: 4 },
  eventCard: {
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: theme.accent,
  },
  eventLabel: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  eventName: { color: theme.ink, fontSize: 17, fontWeight: '600', marginTop: 4 },
  eventMeta: { color: theme.muted, fontSize: 13, marginTop: 3 },
  eventDesc: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  eventBook: { color: theme.ink, fontSize: 13, marginTop: 8 },
  footnote: { color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 26 },
});
