import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { periodReport } from '../calc';
import { useLookups } from '../hooks';
import { periodReportHtml, shareHtml } from '../report';
import { useStore } from '../store';
import { Btn, Card, Chip, Divider, Empty, Field, HStack, ListItem, Row, Screen, Stat, diffColor, diffText } from '../ui';
import { addDays, isValidDate, monthStart, num, prettyDate, todayStr } from '../utils';

export function Reports({ openDay }: { openDay: (d: string) => void }) {
  const { data, ledger } = useStore();
  const L = useLookups();
  const today = todayStr();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const valid = isValidDate(from) && isValidDate(to) && from <= to;
  const r = useMemo(() => (valid ? periodReport(data, ledger, from, to) : null), [data, ledger, from, to, valid]);
  const preset = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
  };
  const lastMonthEnd = addDays(monthStart(today), -1);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <Chip title="Today" onPress={() => preset(today, today)} active={from === today && to === today} />
        <Chip title="Last 7 days" onPress={() => preset(addDays(today, -6), today)} />
        <Chip title="This month" onPress={() => preset(monthStart(today), today)} />
        <Chip title="Last month" onPress={() => preset(monthStart(lastMonthEnd), lastMonthEnd)} />
      </View>
      <HStack style={{ marginBottom: 12 }}>
        <Field label="From (YYYY-MM-DD)" value={from} onChange={setFrom} />
        <Field label="To" value={to} onChange={setTo} />
      </HStack>
      {!r ? <Empty text="Enter a valid date range" /> : null}
      {r ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <Stat label="Total sales" value={`${L.cur} ${num(r.totalSales)}`} />
            <Stat label="Fuel sold" value={`${num(r.fuelLitres)} L`} />
            <Stat label="Net profit (est.)" value={`${L.cur} ${num(r.netProfit)}`} color={diffColor(r.netProfit >= 0 ? 0 : -1)} />
            <Stat label="Short / excess" value={num(r.shortExcess)} color={diffColor(r.shortExcess)} />
          </View>
          <Btn title="📄 Share / print PDF" onPress={() => shareHtml(periodReportHtml(data, r), 'Report').catch((e) => Alert.alert('Error', String(e)))} style={{ marginBottom: 12 }} />
          <Card title="Summary">
            <Row label="Days recorded" value={String(r.days)} />
            <Row label="Fuel sales" value={num(r.fuelAmount)} />
            <Row label="Lube / items" value={num(r.itemAmount)} />
            <Row label="Credit sales" value={num(r.credit)} />
            <Row label="Card" value={num(r.card)} />
            <Row label="Digital" value={num(r.digital)} />
            <Row label="Credit recovery" value={num(r.creditRecovery)} />
            <Row label="Purchases" value={num(r.purchasesAmount)} />
            <Row label="Expenses" value={num(r.expenses)} />
            <Divider />
            <Row label="Gross margin" value={num(r.grossMargin)} />
            <Row label="Stock gain / loss" value={num(r.stockGainLossValue)} />
            <Row label="Net profit (estimate)" value={num(r.netProfit)} bold />
          </Card>
          <Card title="Product-wise">
            {r.byProduct.length === 0 ? <Empty text="No data" /> : null}
            {r.byProduct.map((p) => (
              <ListItem
                key={p.productId}
                title={L.productName(p.productId)}
                sub={`Sold ${num(p.sold)} · Received ${num(p.received)} · Gain/loss ${num(p.variance)}`}
                right={num(p.amount)}
              />
            ))}
          </Card>
          <Card title="Salesman-wise">
            {r.bySalesman.length === 0 ? <Empty text="No data" /> : null}
            {r.bySalesman.map((x) => (
              <ListItem
                key={x.salesmanId || 'counter'}
                title={L.salesmanName(x.salesmanId)}
                sub={`${num(x.litres)} L · Sale ${num(x.saleAmount)} · ${diffText(x.diff, L.cur)}`}
                right={num(x.cashReceived)}
              />
            ))}
          </Card>
          <Card title="Expenses by head">
            {r.expenseHeads.length === 0 ? <Empty text="No expenses" /> : null}
            {r.expenseHeads.map((e) => (
              <Row key={e.head} label={e.head} value={num(e.amount)} />
            ))}
          </Card>
          <Card title="Day-wise">
            {r.daily.map((d) => (
              <ListItem key={d.date} title={prettyDate(d.date)} sub={`${num(d.fuelLitres)} L · ${diffText(d.shortExcess, L.cur)}`} right={num(d.totalSales)} onPress={() => openDay(d.date)} />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
