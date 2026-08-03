import { Tabs } from 'expo-router';
// SDK 57 vendors React Navigation inside expo-router rather than shipping
// `@react-navigation/bottom-tabs` as a separate package, so the tab bar prop
// type comes from there.
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { Press } from '@/components/ui';
import { useUnreadReplies } from '@/data/store';
import { color, radius } from '@/theme/tokens';
import { body } from '@/theme/type';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'index', label: 'Groups', icon: 'tabGroups' },
  { name: 'calendar', label: 'Calendar', icon: 'tabCalendar' },
  { name: 'messages', label: 'Messages', icon: 'tabMessages' },
  { name: 'students', label: 'Students', icon: 'tabStudents' },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
      tabBar={(props) => <ClassCareTabBar {...props} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}

/**
 * Custom bar rather than the stock one: the design floats a translucent pill
 * bar over the scrolling content, with the active item on a blue tint chip.
 */
function ClassCareTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const unread = useUnreadReplies();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
      {state.routes.map((route, i) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === i;

        return (
          <Press
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={tab.label}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={[styles.item, focused && styles.itemActive]}>
            <Icon
              name={tab.icon}
              size={20}
              color={focused ? color.primary : color.mutedLight}
            />
            <Text
              style={[
                styles.label,
                {
                  fontFamily: focused ? body[700] : body[600],
                  color: focused ? color.primary : color.mutedLight,
                },
              ]}>
              {tab.label}
            </Text>
            {tab.name === 'messages' && unread > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread}</Text>
              </View>
            ) : null}
          </Press>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: color.border,
    paddingHorizontal: 12,
    paddingTop: 9,
  },
  item: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.field,
  },
  itemActive: { backgroundColor: color.primaryTint },
  label: { fontSize: 10.5 },
  badge: {
    position: 'absolute',
    top: 4,
    right: 9,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: color.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: body[700], fontSize: 9.5, color: '#fff' },
});
