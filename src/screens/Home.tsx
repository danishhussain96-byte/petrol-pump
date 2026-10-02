import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { bankBalance, carryFor, computeDay, customerLedger } from '../calc';
import { useLookups } from '../hooks';
import { useStore } from '../store';
import { Btn, C, Card, Empty, ListItem, Muted, Row, Screen, Stat, diffColor, diffText } from '../ui';
import { addDays, num, prettyDate, todayStr } from '../utils';

export function Home({ openDay, go }: { openDay: (d: string) => void; go: (tab: 'reports' | 'ledgers' | 'setup' | 'credit') => void }) {
  const { data, ledger, getDay } = useStore();
  const L = useLookups();
  const today = todayStr();
  const s = useMemo(() => computeDay(data, getDay(today), carryFor(data, ledger, today)), [data, ledger, getDay, today]);
  const recent = ledger.dates.slice(-7).reverse();
  const receivable = data.customers.reduce((a, c) => a + customerLedger(data, c.id).balance, 0);
  const lowStock = s.stock.filter((r) => {
    const p = L.product.get(r.productId);
    return p && p.minStock > 0 && r.closing < p.minStock;
  });
  const needsSetup = data.products.some((p) => p.active && p.isFuel && !p.rate) || data.salesmen.length === 0;

  return (
    <Screen>
      {needsSetup ? (
        <Card title="👋 Get started" style={{ borderColor: C.accent }}>
          <Muted>1. Setup → Products: set fuel rates and opening stock.</Muted>
          <Muted>2. Setup → Nozzles: set opening meter readings.</Muted>
          <Muted>3. Add salesmen, bank accounts and credit customers.</Muted>
          <Muted>4. Enter each day's readings, settlements and cash.</Muted>
          <Btn title="Open Setup" onPress={() => go('setup')} style={{ marginTop: 10 }} />
        </Card>
      ) : null}
      <Text style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>Today · {prettyDate(today)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Stat label="Sales today" value={`${L.cur} ${num(s.totalSales)}`} />
        <Stat label="Fuel sold" value={`${num(s.fuelLitres)} L`} />
        <Stat label="Cash in hand" value={`${L.cur} ${num(s.cash.closing)}`} />
        <Stat label="Short / excess" value={num(s.shortExcess)} color={diffColor(s.shortExcess)} />
      </View>
      <Btn title="📝 Enter today's sales" onPress={() => openDay(today)} style={{ marginBottom: 8 }} />
      <Btn title="Enter yesterday" kind="secondary" onPress={() => openDay(addDays(today, -1))} style={{ marginBottom: 12 }} />

      <Card title="Stock (book / dip)">
        {s.stock.map((r) => (
          <Row
            key={r.productId}
            label={L.productName(r.productId)}
            value={`${num(r.closing)} ${L.product.get(r.productId)?.unit ?? ''}`}
            color={lowStock.includes(r) ? C.red : undefined}
          />
        ))}
        {lowStock.length ? <Text style={{ color: C.red, marginTop: 4 }}>⚠ Low stock: {lowStock.map((r) => L.productName(r.productId)).join(', ')}</Text> : null}
      </Card>

      <Card title="Balances" right={<Btn title="Bank" small kind="secondary" onPress={() => go('ledgers')} />}>
        {data.banks.map((b) => (
          <Row key={b.id} label={`🏦 ${b.name}`} value={`${L.cur} ${num(bankBalance(data, ledger, b.id))}`} />
        ))}
        <Row label="📒 Credit receivable" value={`${L.cur} ${num(receivable)}`} />
        <Btn title="Credit customers" small kind="secondary" onPress={() => go('credit')} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
      </Card>

      <Card title="Recent days" right={<Btn title="Reports" small kind="secondary" onPress={() => go('reports')} />}>
        {recent.length === 0 ? <Empty text="No days recorded yet" /> : null}
        {recent.map((d) => {
          const x = ledger.summaries[d];
          return (
            <ListItem
              key={d}
              title={`${data.days[d].locked ? '🔒 ' : ''}${prettyDate(d)}`}
              sub={`${num(x.fuelLitres)} L · ${diffText(x.shortExcess, L.cur)}`}
              right={`${L.cur} ${num(x.totalSales)}`}
              onPress={() => openDay(d)}
            />
          );
        })}
      </Card>
    </Screen>
  );
}
