import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/tabs';

import { colors } from '../../ui/theme';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { fontWeight: '800' } }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Routes', tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="run"
        options={{ title: 'Run', tabBarIcon: ({ color, size }) => <Ionicons name="walk-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'You', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
