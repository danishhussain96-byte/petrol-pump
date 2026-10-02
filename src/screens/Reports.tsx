import React, { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { periodReport } from '../calc';
import { useLookups } from '../hooks';
import { dispenserReportHtml, periodReportHtml, shareHtml } from '../report';
import { useStore } from '../store';
import { Btn, C, Card, Chip, Divider, Empty, Field, HStack, ListItem, Muted, Row, Screen, Stat, diffColor, diffText } from '../ui';
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
  const [pdfFrom, setPdfFrom] = useState(today);
  const [pdfTo, setPdfTo] = useState(today);
  const pdfDates = Object.keys(data.days).filter((d) => d >= pdfFrom && d <= pdfTo).length;
  const sharePdf = () => {
    if (!isValidDate(pdfFrom) || !isValidDate(pdfTo) || pdfFrom > pdfTo) return Alert.alert('Invalid date', 'Use format YYYY-MM-DD, "From" on or before "To".');
    if (!pdfDates) return Alert.alert('Nothing saved', 'No daily entries on these dates.');
    shareHtml(dispenserReportHtml(data, ledger, pdfFrom, pdfTo), `Dispenser sales ${pdfFrom}${pdfTo !== pdfFrom ? ' to ' + pdfTo : ''}`).catch((e) => Alert.alert('Error', String(e)));
  };

  return (
    <Screen>
      <Card title="📄 Daily sales PDF — all dispensers">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
          <Chip title="Today" active={pdfFrom === today && pdfTo === today} onPress={() => { setPdfFrom(today); setPdfTo(today); }} />
          <Chip
            title="Yesterday"
            active={pdfFrom === addDays(today, -1) && pdfTo === addDays(today, -1)}
            onPress={() => { setPdfFrom(addDays(today, -1)); setPdfTo(addDays(today, -1)); }}
          />
          <Chip title="This month" active={pdfFrom === monthStart(today) && pdfTo === today} onPress={() => { setPdfFrom(monthStart(today)); setPdfTo(today); }} />
        </View>
        <HStack>
          <Field label="Date (YYYY-MM-DD)" value={pdfFrom} onChange={(t) => { setPdfFrom(t); if (pdfTo < t || pdfTo === pdfFrom) setPdfTo(t); }} />
          <Field label="To (for several days)" value={pdfTo} onChange={setPdfTo} />
        </HStack>
        <Btn title={`📄 Download / share PDF${pdfDates > 1 ? ` (${pdfDates} days)` : ''}`} onPress={sharePdf} style={{ marginTop: 8 }} />
        <Muted style={{ marginTop: 4 }}>
          One PDF with every dispenser: meter readings, sale by product, cash / online / POS / credit, credit customers with vehicles, and cash → bank. Several days = one page per day.
        </Muted>
      </Card>
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
          <Btn title="📄 Period summary PDF" onPress={() => shareHtml(periodReportHtml(data, r), 'Report').catch((e) => Alert.alert('Error', String(e)))} style={{ marginBottom: 12 }} />
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
          {r.byUnit.length ? (
            <Card title="Dispenser-wise">
              {r.byUnit.map((u) => (
                <Row key={u.unitId || 'none'} label={L.unitName(u.unitId)} value={`${num(u.litres)} L · ${L.cur} ${num(u.amount)}`} />
              ))}
            </Card>
          ) : null}
          {r.unitCash.length ? (
            <Card title="Dispenser cash → bank">
              {r.unitCash.map((u) => (
                <View key={u.unitId || 'none'} style={{ paddingVertical: 6, borderBottomWidth: 1, borderColor: '#EEF2F6' }}>
                  <Row label={u.unitId ? L.unitName(u.unitId) : 'Not tied to a dispenser'} value={`${num(u.deposited)} of ${num(u.collected)}`} bold />
                  {u.byBank.map((b) => (
                    <Row key={b.bankId} small label={`  in ${L.bankName(b.bankId)}`} value={num(b.amount)} />
                  ))}
                  {u.cross ? <Row small label="  of which cross deposits" value={num(u.cross)} color={C.accent} /> : null}
                  {Math.abs(u.pending) > 0.004 ? <Row small label="  Pending at end of period" value={num(u.pending)} color={u.pending > 0 ? C.red : C.accent} /> : null}
                </View>
              ))}
            </Card>
          ) : null}
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
