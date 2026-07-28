import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MAX_SCHEDULED } from '@atlantica/shared';
import {
  DEFAULT_PREFERENCES,
  clearDeviceToken,
  fetchSchedule,
  getLocalPreferences,
  pushPreferences,
  type Preferences,
} from '../src/api';
import {
  armReminders,
  getPermissionStatus,
  listScheduled,
  requestPermission,
} from '../src/notifications';
import { syncWidgetData } from '../src/widget';
import { formatClock, theme } from '../src/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined'>(
    'undetermined',
  );
  const [scheduled, setScheduled] = useState<
    { id: string; title: string; fireAt: Date | null }[]
  >([]);
  const [dropped, setDropped] = useState(0);
  const [busy, setBusy] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setPermission(await getPermissionStatus());
    setScheduled(await listScheduled());
  }, []);

  useEffect(() => {
    void (async () => {
      setPrefs(await getLocalPreferences());
      await refreshDiagnostics();
    })();
  }, [refreshDiagnostics]);

  /** Re-arm from the current schedule and refresh what we show. */
  const rearm = useCallback(
    async (next: Preferences) => {
      setBusy(true);
      try {
        const { payload } = await fetchSchedule();
        const result = await armReminders(payload.occurrences, {
          leadMinutes: payload.leadMinutes,
          preferences: next,
        });
        setDropped(result.droppedForCapacity);
        await syncWidgetData(payload.occurrences);
        await refreshDiagnostics();
      } catch (err) {
        Alert.alert('Could not update reminders', (err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refreshDiagnostics],
  );

  async function toggle(key: keyof Preferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await pushPreferences(next);
    await rearm(next);
  }

  async function enableNotifications() {
    const granted = await requestPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) await rearm(prefs);
  }

  async function signOut() {
    await clearDeviceToken();
    router.replace('/signin');
  }

  const coversUntil = scheduled.reduce<Date | null>((latest, s) => {
    if (!s.fireAt) return latest;
    return !latest || s.fireAt > latest ? s.fireAt : latest;
  }, null);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingBottom: 48 }}>
      {permission !== 'granted' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Notifications are off</Text>
          <Text style={styles.cardBody}>
            {permission === 'denied'
              ? 'Turn them back on in Settings → Atlantica → Notifications.'
              : 'Allow notifications so reminders can reach you.'}
          </Text>
          {permission === 'undetermined' && (
            <Pressable style={styles.btn} onPress={enableNotifications}>
              <Text style={styles.btnText}>Enable notifications</Text>
            </Pressable>
          )}
        </View>
      )}

      <Text style={styles.section}>Remind me about</Text>

      <View style={styles.card}>
        <Row
          label="Evening entertainment"
          hint="Live music, DJ sets and shows"
          value={prefs.entertainment}
          onChange={(v) => toggle('entertainment', v)}
          disabled={busy}
          colour={theme.entertainment}
        />
        <View style={styles.divider} />
        <Row
          label="Daytime activities"
          hint="Yoga, aqua fitness, quizzes and games"
          value={prefs.daytime}
          onChange={(v) => toggle('daytime', v)}
          disabled={busy}
          colour={theme.daytime}
        />
      </View>

      <Text style={styles.note}>
        Daytime activities start at 09:00, so a 30-minute reminder arrives at
        08:30. Turn them off here if that is too early.
      </Text>

      <Text style={styles.section}>Scheduled on this phone</Text>

      <View style={styles.card}>
        <Text style={styles.cardBody}>
          {scheduled.length} reminder{scheduled.length === 1 ? '' : 's'} set
          {coversUntil ? `, through ${formatClock(coversUntil.toISOString())}` : ''}
          {coversUntil ? ` on ${coversUntil.toLocaleDateString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          })}` : ''}
          .
        </Text>

        {/* iOS keeps only the 64 soonest pending local notifications, so the
            app deliberately arms a rolling window rather than the whole week. */}
        {dropped > 0 && (
          <Text style={styles.cardHint}>
            {dropped} further event{dropped === 1 ? '' : 's'} beyond the{' '}
            {MAX_SCHEDULED}-reminder limit iOS allows. They are armed
            automatically as these fire — just open the app now and then.
          </Text>
        )}

        <Pressable
          style={[styles.btnQuiet, busy && styles.btnBusy]}
          onPress={() => rearm(prefs)}
          disabled={busy}
        >
          <Text style={styles.btnQuietText}>
            {busy ? 'Updating…' : 'Refresh and re-arm now'}
          </Text>
        </Pressable>
      </View>

      {scheduled.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next up</Text>
          {scheduled
            .slice()
            .sort((a, b) => (a.fireAt?.getTime() ?? 0) - (b.fireAt?.getTime() ?? 0))
            .slice(0, 5)
            .map((s) => (
              <Text key={s.id} style={styles.scheduleLine}>
                {s.fireAt ? formatClock(s.fireAt.toISOString()) : '--:--'} · {s.title}
              </Text>
            ))}
        </View>
      )}

      <Pressable style={styles.signOut} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
  disabled,
  colour,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  colour: string;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <View style={styles.rowLabelWrap}>
          <View style={[styles.dot, { backgroundColor: colour }]} />
          <Text style={styles.rowLabel}>{label}</Text>
        </View>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: theme.accent, false: theme.card2 }}
        thumbColor={theme.ink}
      />
    </View>
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
  card: {
    backgroundColor: theme.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
  },
  cardTitle: { color: theme.ink, fontSize: 16, fontWeight: '600', marginBottom: 6 },
  cardBody: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  cardHint: { color: theme.accent, fontSize: 13, lineHeight: 19, marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowText: { flex: 1, paddingRight: 12 },
  rowLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { color: theme.ink, fontSize: 16, fontWeight: '600' },
  rowHint: { color: theme.muted, fontSize: 13, marginTop: 3, marginLeft: 16 },
  divider: { height: 1, backgroundColor: theme.card2, marginVertical: 14 },
  note: { color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 12 },
  btn: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  btnText: { color: '#24180b', fontSize: 15, fontWeight: '700' },
  btnQuiet: {
    backgroundColor: theme.card2,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  btnQuietText: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  btnBusy: { opacity: 0.6 },
  scheduleLine: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  signOut: { alignItems: 'center', marginTop: 32 },
  signOutText: { color: theme.warn, fontSize: 15 },
});
