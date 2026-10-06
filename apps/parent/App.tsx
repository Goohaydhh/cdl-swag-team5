import { color, space, statusColor } from '@swag/design-tokens';
import {
  type ChildStatus,
  type ClientToServerEvents,
  RT_NAMESPACE,
  type ServerToClientEvents,
} from '@swag/protocol';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { io, type Socket } from 'socket.io-client';

// Sprint 0 family overview: proves the API -> parent phone round trip.
// Sprint 1 adds login and pairing; Sprint 2 adds GET /family/overview, the widget and FCM.

// Android emulator reaches the PC's localhost at 10.0.2.2; a real phone needs the PC's LAN IP.
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3100';
const familyId =
  process.env.EXPO_PUBLIC_DEV_FAMILY_ID ?? '00000000-0000-4000-8000-000000000001';
const parentId =
  process.env.EXPO_PUBLIC_DEV_PARENT_ID ?? '00000000-0000-4000-8000-000000000003';

const statusLabel: Record<ChildStatus, string> = {
  at_home: 'At home',
  left_home: 'Left home',
  at_friend: "At a friend's",
};

interface ChildRow {
  childId: string;
  status: ChildStatus;
  occurredAt: string;
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [children, setChildren] = useState<Record<string, ChildRow>>({});

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
      `${apiUrl}${RT_NAMESPACE}`,
      { auth: { token: `dev:${familyId}:parent:${parentId}` } },
    );
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('status_updated', ({ data }) =>
      setChildren((prev) => ({
        ...prev,
        [data.child_id]: { childId: data.child_id, status: data.status, occurredAt: data.occurred_at },
      })),
    );
    return () => {
      socket.close();
    };
  }, []);

  const rows = Object.values(children);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Family</Text>
        <Text style={[styles.badge, { color: connected ? statusColor.at_home : color.danger }]}>
          {connected ? 'Live' : 'Offline'}
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.childId}
        ListEmptyComponent={
          <Text style={styles.empty}>No status yet. Tap a button on the tablet.</Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, { borderLeftColor: statusColor[item.status] }]}>
            <Text style={styles.cardTitle}>{statusLabel[item.status]}</Text>
            <Text style={styles.cardMeta}>
              Child {item.childId.slice(0, 8)} ·{' '}
              {new Date(item.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
      />
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.background, paddingTop: 64, paddingHorizontal: space.md },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  title: { fontSize: 32, fontWeight: '700', color: color.textPrimary },
  badge: { fontSize: 16, fontWeight: '600' },
  empty: { fontSize: 16, color: color.textSecondary },
  card: {
    backgroundColor: color.surface,
    borderRadius: 16,
    borderLeftWidth: 8,
    padding: space.md,
    marginBottom: space.sm,
  },
  cardTitle: { fontSize: 22, fontWeight: '700', color: color.textPrimary },
  cardMeta: { fontSize: 14, color: color.textSecondary, marginTop: space.xs },
});
