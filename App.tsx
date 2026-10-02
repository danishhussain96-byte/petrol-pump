import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Customers } from './src/screens/Customers';
import { DayEntry } from './src/screens/DayEntry';
import { Home } from './src/screens/Home';
import { Ledgers } from './src/screens/Ledgers';
import { Reports } from './src/screens/Reports';
import { Setup } from './src/screens/Setup';
import { StoreProvider, useStore } from './src/store';
import { C, Header, PortalHost, s } from './src/ui';
import { todayStr } from './src/utils';

type Tab = 'home' | 'day' | 'credit' | 'reports' | 'ledgers' | 'setup';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'home', icon: '🏠', label: 'Home' },
  { key: 'day', icon: '📝', label: 'Daily' },
  { key: 'credit', icon: '📒', label: 'Credit' },
  { key: 'ledgers', icon: '🏦', label: 'Bank' },
  { key: 'reports', icon: '📊', label: 'Reports' },
  { key: 'setup', icon: '⚙️', label: 'Setup' },
];

const TITLES: Record<Tab, string> = {
  home: '',
  day: 'Daily Sales Entry',
  reports: 'Reports',
  credit: 'Credit Customers',
  ledgers: 'Bank',
  setup: 'Setup',
};

function Main() {
  const { data, loaded } = useStore();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('home');
  const [date, setDate] = useState(todayStr());
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [tab]);

  if (!loaded)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );

  if (data.settings.pin && !unlocked) return <PinGate pin={data.settings.pin} onUnlock={() => setUnlocked(true)} />;

  const openDay = (d: string) => {
    setDate(d);
    setTab('day');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Header title={tab === 'home' ? data.settings.stationName || 'Petrol Pump' : TITLES[tab]} subtitle={tab === 'home' ? 'Daily sales · stock · cash · bank' : undefined} />
      <View style={{ flex: 1 }}>
        {tab === 'home' && <Home openDay={openDay} go={setTab} />}
        {tab === 'day' && <DayEntry date={date} setDate={setDate} />}
        {tab === 'reports' && <Reports openDay={openDay} />}
        {tab === 'credit' && <Customers />}
        {tab === 'ledgers' && <Ledgers />}
        {tab === 'setup' && <Setup />}
      </View>
      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.border, paddingBottom: insets.bottom }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
            <Text style={{ fontSize: 20, opacity: tab === t.key ? 1 : 0.5 }}>{t.icon}</Text>
            <Text style={{ fontSize: 11, color: tab === t.key ? C.primary : C.muted, fontWeight: tab === t.key ? '700' : '400' }}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PinGate({ pin, onUnlock }: { pin: string; onUnlock: () => void }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ fontSize: 48 }}>⛽</Text>
      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginVertical: 16 }}>Enter PIN</Text>
      <TextInput
        style={[s.input, { width: 180, textAlign: 'center', fontSize: 24, letterSpacing: 8 }]}
        value={v}
        autoFocus
        secureTextEntry
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={(t) => {
          setV(t);
          setErr(false);
          if (t === pin) onUnlock();
          else if (t.length >= pin.length) setErr(true);
        }}
      />
      {err ? <Text style={{ color: '#FFD5D5', marginTop: 12 }}>Wrong PIN</Text> : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="light" />
        <PortalHost>
          <Main />
        </PortalHost>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
