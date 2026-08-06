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
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n/useT';
import { radius, useTheme, useThemedStyles, type Theme } from '@/theme';
import { body } from '@/theme/type';

const TABS: { name: string; key: TranslationKey; icon: IconName }[] = [
  { name: 'index', key: 'nav.groups', icon: 'tabGroups' },
  { name: 'calendar', key: 'nav.calendar', icon: 'tabCalendar' },
  { name: 'messages', key: 'nav.messages', icon: 'tabMessages' },
  { name: 'students', key: 'nav.students', icon: 'tabStudents' },
];

export default function TabsLayout() {
  const { color } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.bg },
      }}
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
  const { color } = useTheme();
  const t = useT();
  const styles = useThemedStyles(makeStyles);
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
            accessibilityLabel={t(tab.key)}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={[styles.item, focused && styles.itemActive]}>
            <Icon name={tab.icon} size={20} color={focused ? color.primary : color.mutedLight} />
            <Text
              style={[
                styles.label,
                {
                  fontFamily: focused ? body[700] : body[600],
                  color: focused ? color.primary : color.mutedLight,
                },
              ]}>
              {t(tab.key)}
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

const makeStyles = ({ color }: Theme) =>
  StyleSheet.create({
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: color.barTint,
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
