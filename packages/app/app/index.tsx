import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Occurrence, SchedulePayload } from '@atlantica/shared';
import {
  AuthError,
  fetchSchedule,
  getDeviceToken,
  getLocalPreferences,
} from '../src/api';
import { armReminders } from '../src/notifications';
import { syncWidgetData } from '../src/widget';
import {
  formatDayHeading,
  formatRelative,
  resortDateOf,
  theme,
} from '../src/theme';

export default function ScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [payload, setPayload] = useState<SchedulePayload | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!(await getDeviceToken())) {
        router.replace('/signin');
        return;
      }

      isRefresh ? setRefreshing(true) : setLoading(true);
      try {
        const result = await fetchSchedule();
        setPayload(result.payload);
        setFromCache(result.fromCache);
        setError(null);

        // Every foreground is a chance to top up the armed window, which is
        // what makes this resilient to iOS never running the background task.
        const prefs = await getLocalPreferences();
        await armReminders(result.payload.occurrences, {
          leadMinutes: result.payload.leadMinutes,
          preferences: prefs,
        });
        await syncWidgetData(result.payload.occurrences);
      } catch (err) {
        if (err instanceof AuthError) {
          router.replace('/signin');
          return;
        }
        setError((err as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Re-arm whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load(true);
    });
    return () => sub.remove();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const occurrences = payload?.occurrences ?? [];
  const now = new Date();
  const todayIso = resortDateOf(now);
  const tomorrowIso = resortDateOf(new Date(now.getTime() + 864e5));

  const byDay = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    if (!byDay.has(occ.date)) byDay.set(occ.date, []);
    byDay.get(occ.date)!.push(occ);
  }

  const hasDaytime = occurrences.some((o) => o.category === 'daytime');

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          tintColor={theme.muted}
        />
      }
    >
      <Link href="/settings" asChild>
        <Pressable style={styles.settingsRow}>
          <Text style={styles.settingsText}>Reminder settings</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </Link>

      {fromCache && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.bannerText}>
            Offline — showing the last downloaded schedule. Reminders already set
            will still fire.
          </Text>
        </View>
      )}

      {error && !fromCache && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}

      {payload?.lastScrapeError && (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Text style={styles.bannerText}>
            The resort site had a problem on the last refresh.
          </Text>
        </View>
      )}

      {occurrences.length === 0 && (
        <Text style={styles.empty}>Nothing scheduled right now.</Text>
      )}

      {[...byDay.entries()].map(([date, items]) => (
        <View key={date}>
          <Text style={styles.dayHeading}>
            {formatDayHeading(date, todayIso, tomorrowIso)}
          </Text>
          {items.map((occ) => {
            const past = new Date(occ.startsAt) < now;
            return (
              <View
                key={occ.key}
                style={[
                  styles.item,
                  {
                    borderLeftColor:
                      occ.category === 'daytime' ? theme.daytime : theme.entertainment,
                  },
                  past && styles.itemPast,
                ]}
              >
                <View style={styles.timeCol}>
                  <Text style={styles.time}>
                    {occ.endTime ? `${occ.startTime}–${occ.endTime}` : occ.startTime}
                  </Text>
                  {!past && date === todayIso && (
                    <Text style={styles.relative}>{formatRelative(occ.startsAt, now)}</Text>
                  )}
                </View>
                <View style={styles.bodyCol}>
                  <Text style={styles.title}>{occ.title}</Text>
                  {occ.venue && <Text style={styles.venue}>{occ.venue}</Text>}
                  {occ.category !== 'daytime' && occ.description && (
                    <Text style={styles.desc}>{occ.description}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ))}

      {hasDaytime && (
        <Text style={styles.footnote}>
          Daytime activities: arrive 5 minutes early at the meeting point. Yoga
          classes — bring your own towel. In poor weather, check with Reception
          for updated locations.
        </Text>
      )}
    </ScrollView>
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
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 12,
  },
  settingsText: { color: theme.ink, fontSize: 16, fontWeight: '600' },
  chevron: { color: theme.muted, fontSize: 22 },
  banner: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
    backgroundColor: theme.card2,
  },
  bannerWarn: { backgroundColor: 'rgba(240,160,160,0.15)' },
  bannerText: { color: theme.warn, fontSize: 13, lineHeight: 18 },
  empty: { color: theme.muted, marginTop: 24, fontSize: 15 },
  dayHeading: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 26,
    marginBottom: 10,
  },
  item: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: theme.card,
    borderRadius: 12,
    borderLeftWidth: 3,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  itemPast: { opacity: 0.42 },
  timeCol: { minWidth: 88 },
  time: { color: theme.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  relative: { color: theme.accent, fontSize: 12, marginTop: 2 },
  bodyCol: { flex: 1 },
  title: { color: theme.ink, fontSize: 16, fontWeight: '600', lineHeight: 21 },
  venue: { color: theme.muted, fontSize: 13, marginTop: 2 },
  desc: { color: theme.muted, fontSize: 12, marginTop: 5, lineHeight: 17 },
  footnote: {
    color: theme.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 28,
  },
});
