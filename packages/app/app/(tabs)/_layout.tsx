import { Tabs } from 'expo-router';
import { Platform, StyleSheet, Text } from 'react-native';
import { theme } from '../../src/theme';

/**
 * The two things you actually want at a resort: what's on, and what's open.
 *
 * Settings, venue detail and the reference pages live outside the tabs, in the
 * root stack, so they push over the whole screen rather than nesting.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.ink,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: theme.bg },
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.card2,
          // Without this the labels sit too close to the home indicator.
          height: Platform.OS === 'ios' ? 84 : 64,
          paddingTop: 6,
        },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Activities',
          headerTitle: 'Atlantica',
          tabBarIcon: ({ color }) => (
            <Text style={[styles.icon, { color }]}>◈</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="dining"
        options={{
          title: 'Dining',
          headerTitle: 'Dining',
          tabBarIcon: ({ color }) => (
            <Text style={[styles.icon, { color }]}>◍</Text>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { fontSize: 20, lineHeight: 24 },
});
