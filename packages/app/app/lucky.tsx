import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  barVenues,
  drinkCandidates,
  pickDrink,
  type DrinkPick,
} from '../src/dining';
import { theme } from '../src/theme';

/**
 * Picks a drink for you, with a slot-machine flourish.
 *
 * Scoped to one bar, and to drinks *included* in all-inclusive — a discounted
 * item still costs money, and the point is something you can simply walk up and
 * order. Bars that are open sort first in the picker.
 */
export default function LuckyScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ venue?: string }>();

  const bars = useMemo(() => barVenues(), []);
  const [barSlug, setBarSlug] = useState<string>(
    () => params.venue ?? bars[0]?.venue.slug ?? '',
  );
  const candidates = useMemo(() => drinkCandidates(barSlug), [barSlug]);
  const [display, setDisplay] = useState<DrinkPick | null>(null);
  const [result, setResult] = useState<DrinkPick | null>(null);
  const [spinning, setSpinning] = useState(false);

  const spin = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => clearTimer, []);

  // Switching bar invalidates whatever was showing.
  const chooseBar = (slug: string) => {
    if (slug === barSlug) return;
    clearTimer();
    setBarSlug(slug);
    setDisplay(null);
    setResult(null);
    setSpinning(false);
  };

  const start = useCallback(() => {
    if (candidates.length === 0 || spinning) return;

    clearTimer();
    setResult(null);
    setSpinning(true);

    // Continuous rotation while the names cycle.
    spin.setValue(0);
    const rotation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    rotation.start();

    // Cycle names fast, then ease off -- the deceleration is what makes it read
    // as a slot machine rather than a loading spinner.
    const total = 26;
    let step = 0;

    const tick = () => {
      setDisplay(candidates[Math.floor(Math.random() * candidates.length)]);
      step++;

      if (step >= total) {
        rotation.stop();
        const final = pickDrink(candidates);
        setDisplay(final);
        setResult(final);
        setSpinning(false);
        // A small pop on landing so the stop is felt, not just seen.
        pop.setValue(0.9);
        Animated.spring(pop, {
          toValue: 1,
          friction: 4,
          tension: 90,
          useNativeDriver: true,
        }).start();
        return;
      }

      // 45ms at the start, easing out to ~340ms at the end.
      const t = step / total;
      timer.current = setTimeout(tick, 45 + Math.pow(t, 3) * 300);
    };

    tick();
  }, [candidates, spinning, spin, pop]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const shown = display;

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + 24 }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.barScroll}
        contentContainerStyle={styles.barRow}
      >
        {bars.map(({ venue, state }) => (
          <Pressable
            key={venue.slug}
            onPress={() => chooseBar(venue.slug)}
            style={venue.slug === barSlug ? styles.barChipOn : styles.barChip}
          >
            <Text
              style={venue.slug === barSlug ? styles.barChipTextOn : styles.barChipText}
            >
              {venue.name}
            </Text>
            {state.open && <View style={styles.openDot} />}
          </Pressable>
        ))}
      </ScrollView>

      <Animated.View style={[styles.wheel, { transform: [{ rotate }] }]}>
        <Text style={styles.wheelGlyph}>◍</Text>
      </Animated.View>

      <Animated.View style={[styles.card, { transform: [{ scale: pop }] }]}>
        {shown ? (
          <>
            <Text style={styles.name} numberOfLines={2}>
              {shown.item.name}
            </Text>
            <Text style={styles.where}>
              {shown.venueName} · {shown.categoryName}
            </Text>

            {/* Price only once it has landed: flashing prices during the spin
                is noise, and half-rendered numbers look like a bug. */}
            {result && (
              <View style={styles.priceRow}>
                <Text style={styles.included}>Included in all-inclusive</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.placeholder}>
            {candidates.length > 0
              ? 'Tap below and let the bar decide.'
              : 'Nothing here is included in all-inclusive.'}
          </Text>
        )}
      </Animated.View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, spinning && styles.btnBusy]}
          onPress={start}
          disabled={spinning || candidates.length === 0}
        >
          <Text style={styles.btnText}>
            {spinning ? 'Spinning…' : result ? 'Again' : 'Spin'}
          </Text>
        </Pressable>

        {result && !spinning && (
          <Link
            href={{
              pathname: '/venue/[slug]/[cat]',
              params: {
                slug: result.venueSlug,
                cat: String(result.categoryIndex),
              },
            }}
            asChild
          >
            <Pressable style={styles.btnQuiet}>
              <Text style={styles.btnQuietText}>See the menu</Text>
            </Pressable>
          </Link>
        )}
      </View>

      <Text style={styles.footnote}>
        {candidates.length} all-inclusive drink
        {candidates.length === 1 ? '' : 's'} on this menu.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barScroll: { flexGrow: 0, marginBottom: 20, alignSelf: 'stretch' },
  barRow: { gap: 8, paddingHorizontal: 2 },
  barChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: theme.card,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  barChipOn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  barChipText: { color: theme.muted, fontSize: 13, fontWeight: '600' },
  barChipTextOn: { color: '#24180b', fontSize: 13, fontWeight: '700' },
  openDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.ok },
  wheel: { marginBottom: 24 },
  wheelGlyph: { fontSize: 56, color: theme.accent },
  card: {
    backgroundColor: theme.card,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 26,
    width: '100%',
    alignItems: 'center',
    minHeight: 150,
    justifyContent: 'center',
  },
  name: {
    color: theme.ink,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 30,
  },
  where: { color: theme.accent, fontSize: 13, marginTop: 8, textAlign: 'center' },
  placeholder: {
    color: theme.muted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginTop: 14,
  },
  price: { color: theme.ink, fontSize: 18, fontVariant: ['tabular-nums'] },
  wasPrice: {
    color: theme.muted,
    fontSize: 14,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  finalPrice: {
    color: theme.ok,
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  included: { color: theme.ok, fontSize: 14, fontWeight: '700' },
  warn: { color: theme.warn, fontSize: 13, marginTop: 14, textAlign: 'center' },
  actions: { width: '100%', marginTop: 24 },
  btn: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnBusy: { opacity: 0.6 },
  btnText: { color: '#24180b', fontSize: 16, fontWeight: '700' },
  btnQuiet: {
    backgroundColor: theme.card2,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  btnQuietText: { color: theme.ink, fontSize: 15, fontWeight: '600' },
  footnote: { color: theme.muted, fontSize: 12, marginTop: 20, textAlign: 'center' },
});
