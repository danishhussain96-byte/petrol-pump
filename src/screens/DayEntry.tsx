import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { COUNTER, DENOMINATIONS, carryFor, computeDay, parsePaymentKey, payBankFor, paymentKey, purchaseAmount, rateOf, type DaySummary, type PayKind } from '../calc';
import { useLookups } from '../hooks';
import { shareDayReport } from '../report';
import { useStore } from '../store';
import type { DayRecord, NozzleReading, SalesmanSettlement } from '../types';
import { BankTxnForm, txnSign, txnTitle, type TxnPrefill } from './BankTxnForm';
import {
  Btn,
  C,
  Card,
  Chip,
  ChipBar,
  Divider,
  Empty,
  Field,
  HStack,
  ListItem,
  Muted,
  NumInput,
  Row,
  Screen,
  Select,
  Stat,
  diffColor,
  diffText,
} from '../ui';
import { addDays, isValidDate, num, prettyDate, round2, todayStr, uid } from '../utils';

type Section = 'meters' | 'items' | 'stock' | 'salesmen' | 'credit' | 'expenses' | 'bank' | 'cash' | 'summary';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'meters', label: '⛽ Meters' },
  { key: 'salesmen', label: '👤 Salesmen' },
  { key: 'items', label: '🛢 Lube/Items' },
  { key: 'stock', label: '📦 Stock & Dip' },
  { key: 'credit', label: '📒 Credit' },
  { key: 'expenses', label: '💸 Expenses' },
  { key: 'bank', label: '🏦 Bank' },
  { key: 'cash', label: '💵 Cash' },
  { key: 'summary', label: '📊 Summary' },
];

export interface SectionProps {
  day: DayRecord;
  sum: DaySummary;
  set: (fn: (d: DayRecord) => DayRecord) => void;
  locked: boolean;
}

export function DayEntry({ date, setDate }: { date: string; setDate: (d: string) => void }) {
  const { data, ledger, getDay, updateDay } = useStore();
  const [section, setSection] = useState<Section>('meters');
  const [editDate, setEditDate] = useState<string | null>(null);
  const day = getDay(date);
  const sum = useMemo(() => computeDay(data, day, carryFor(data, ledger, date)), [data, ledger, day, date]);
  const set = (fn: (d: DayRecord) => DayRecord) => {
    if (day.locked) {
      Alert.alert('Day is locked', 'Unlock this day from the Summary tab to make changes.');
      return;
    }
    updateDay(date, fn);
  };
  const props: SectionProps = { day, sum, set, locked: day.locked };
  const saved = !!data.days[date];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderColor: C.border }}>
        <Btn title="‹" kind="ghost" onPress={() => setDate(addDays(date, -1))} />
        <Pressable style={{ flex: 1, alignItems: 'center' }} onPress={() => setEditDate(date)}>
          <Text style={{ fontWeight: '700', fontSize: 16, color: C.text }}>{prettyDate(date)}</Text>
          <Muted>
            {day.locked ? '🔒 Locked' : saved ? 'Saved automatically' : 'New day — not saved yet'}
            {date === todayStr() ? ' · Today' : ''}
          </Muted>
        </Pressable>
        <Btn title="›" kind="ghost" onPress={() => setDate(addDays(date, 1))} />
      </View>
      {editDate !== null ? (
        <View style={{ backgroundColor: '#fff', padding: 10, borderBottomWidth: 1, borderColor: C.border }}>
          <HStack>
            <Field label="Go to date (YYYY-MM-DD)" value={editDate} onChange={setEditDate} />
            <Btn
              title="Go"
              onPress={() => {
                if (!isValidDate(editDate)) return Alert.alert('Invalid date', 'Use format YYYY-MM-DD');
                setDate(editDate);
                setEditDate(null);
              }}
            />
            <Btn title="Today" kind="secondary" onPress={() => { setDate(todayStr()); setEditDate(null); }} />
          </HStack>
        </View>
      ) : null}
      <ChipBar items={SECTIONS} value={section} onChange={setSection} />
      <Screen>
        {section === 'meters' && <Meters {...props} />}
        {section === 'items' && <Items {...props} />}
        {section === 'stock' && <Stock {...props} />}
        {section === 'salesmen' && <Salesmen {...props} />}
        {section === 'credit' && <Credit {...props} />}
        {section === 'expenses' && <Expenses {...props} />}
        {section === 'bank' && <Bank {...props} />}
        {section === 'cash' && <Cash {...props} />}
        {section === 'summary' && <Summary {...props} />}
      </Screen>
    </View>
  );
}

// ---------------- Meters ----------------

const ALL = '*all*';

function Meters({ day, sum, set }: SectionProps) {
  const { data, ledger } = useStore();
  const L = useLookups();
  const carry = carryFor(data, ledger, day.date);
  const nozzleIds = [...new Set([...day.readings.map((r) => r.nozzleId), ...data.nozzles.filter((n) => n.active).map((n) => n.id)])];
  const readingOf = (id: string): NozzleReading =>
    day.readings.find((r) => r.nozzleId === id) ?? { nozzleId: id, opening: carry.meters[id] ?? 0, closing: 0, testLitres: 0 };
  const setReading = (id: string, patch: Partial<NozzleReading>) =>
    set((d) => {
      const exists = d.readings.some((r) => r.nozzleId === id);
      const readings = exists
        ? d.readings.map((r) => (r.nozzleId === id ? { ...r, ...patch } : r))
        : [...d.readings, { ...readingOf(id), ...patch }];
      return { ...d, readings };
    });
  const fuels = data.products.filter((p) => p.isFuel && p.active);
  const [unitFilter, setUnitFilter] = useState<string>(ALL);
  // Nozzles grouped by dispensing unit, in Setup order; nozzles without a unit go last.
  const unitOrder = [...data.units.map((u) => u.id), ''];
  const groups = unitOrder
    .map((unitId) => ({ unitId, nozzleIds: nozzleIds.filter((id) => (L.nozzle.get(id)?.unitId ?? '') === unitId) }))
    .filter((g) => g.nozzleIds.length > 0);
  // Units that no longer exist in Setup still show, under "No dispenser".
  const orphans = nozzleIds.filter((id) => !unitOrder.includes(L.nozzle.get(id)?.unitId ?? ''));
  if (orphans.length) {
    const none = groups.find((g) => g.unitId === '');
    if (none) none.nozzleIds.push(...orphans);
    else groups.push({ unitId: '', nozzleIds: orphans });
  }

  return (
    <>
      <Card title="Today's rates">
        <HStack style={{ flexWrap: 'wrap' }}>
          {fuels.map((p) => (
            <NumInput
              key={p.id}
              style={{ minWidth: 100 }}
              label={`${p.name} / ${p.unit}`}
              value={rateOf(day, p)}
              onChange={(v) => set((d) => ({ ...d, rates: { ...d.rates, [p.id]: v ?? 0 } }))}
            />
          ))}
        </HStack>
        <Muted style={{ marginTop: 6 }}>Rate change for one day only. Change the default rate in Setup → Products.</Muted>
      </Card>
      {nozzleIds.length === 0 ? <Empty text="No nozzles yet. Add them in Setup → Nozzles." /> : null}
      {data.units.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <Chip title="All" active={unitFilter === ALL} onPress={() => setUnitFilter(ALL)} />
          {groups.map((g) => (
            <Chip key={g.unitId || 'none'} title={L.unitName(g.unitId)} active={unitFilter === g.unitId} onPress={() => setUnitFilter(g.unitId)} />
          ))}
        </View>
      ) : null}
      {groups
        .filter((g) => unitFilter === ALL || unitFilter === g.unitId)
        .map((g) => {
          const total = sum.units.find((u) => u.unitId === g.unitId);
          const ids = g.nozzleIds;
          const common = ids.map((id) => readingOf(id).salesmanId).every((x, _, a) => x === a[0]) ? readingOf(ids[0]).salesmanId : undefined;
          return (
            <View key={g.unitId || 'none'} style={{ marginBottom: 6 }}>
              <Card
                title={`⛽ ${L.unitName(g.unitId)}`}
                right={<Text style={{ fontWeight: '700', color: C.primary }}>{num(total?.litres ?? 0)} L · {L.cur} {num(total?.amount ?? 0)}</Text>}
                style={{ backgroundColor: C.chip, borderColor: C.chip }}
              >
                <Select
                  label="Salesman on all nozzles of this dispenser"
                  value={common}
                  options={L.opt.salesmen}
                  allowNone="— Not assigned / mixed —"
                  onChange={(v) => set((d) => {
                    let readings = d.readings.map((r) => (ids.includes(r.nozzleId) ? { ...r, salesmanId: v } : r));
                    for (const id of ids) if (!readings.some((r) => r.nozzleId === id)) readings = [...readings, { ...readingOf(id), salesmanId: v }];
                    return { ...d, readings };
                  })}
                />
              </Card>
              {ids.map((id) => {
                const nz = L.nozzle.get(id);
                const r = readingOf(id);
                const line = sum.nozzles.find((l) => l.nozzleId === id);
                const invalid = r.closing > 0 && r.closing < r.opening;
                return (
                  <Card key={id} title={`${nz?.name ?? 'Nozzle'} · ${L.productName(nz?.productId)}`} right={<Text style={{ fontWeight: '700', color: C.primary }}>{num(line?.litres ?? 0)} L</Text>}>
                    <HStack>
                      <NumInput label="Opening" value={r.opening} onChange={(v) => setReading(id, { opening: v ?? 0 })} />
                      <NumInput label="Closing" value={r.closing} onChange={(v) => setReading(id, { closing: v ?? 0 })} />
                      <NumInput label="Test" value={r.testLitres} onChange={(v) => setReading(id, { testLitres: v ?? 0 })} style={{ maxWidth: 80 }} />
                    </HStack>
                    {invalid ? <Text style={{ color: C.red, marginTop: 6 }}>Closing is less than opening.</Text> : null}
                    <Select label="Salesman" value={r.salesmanId} options={L.opt.salesmen} allowNone="— Not assigned —" onChange={(v) => setReading(id, { salesmanId: v })} />
                    <Row label="Amount" value={`${L.cur} ${num(line?.amount ?? 0)}`} bold />
                  </Card>
                );
              })}
            </View>
          );
        })}
      <Card title="Fuel total">
        {fuels.map((p) => {
          const lines = sum.nozzles.filter((l) => l.productId === p.id);
          return <Row key={p.id} label={p.name} value={`${num(lines.reduce((a, l) => a + l.litres, 0))} L · ${L.cur} ${num(lines.reduce((a, l) => a + l.amount, 0))}`} />;
        })}
        <Divider />
        <Row label="Total" value={`${num(sum.fuelLitres)} L · ${L.cur} ${num(sum.fuelAmount)}`} bold />
      </Card>
    </>
  );
}

// ---------------- Lube / items ----------------

function Items({ day, set }: SectionProps) {
  const L = useLookups();
  const [productId, setProductId] = useState<string>();
  const [qty, setQty] = useState<number>(0);
  const [salesmanId, setSalesmanId] = useState<string>();
  const add = () => {
    if (!productId || !qty) return Alert.alert('Missing', 'Select item and enter quantity.');
    set((d) => ({ ...d, itemSales: [...d.itemSales, { id: uid(), productId, qty, salesmanId }] }));
    setQty(0);
  };
  const rate = (pid: string) => {
    const p = L.product.get(pid);
    return p ? rateOf(day, p) : 0;
  };
  return (
    <>
      <Card title="Add lube / item sale">
        <Select label="Item" value={productId} options={L.opt.items} onChange={setProductId} />
        <HStack>
          <NumInput label="Quantity" value={qty} onChange={(v) => setQty(v ?? 0)} />
          <Select label="Sold by" value={salesmanId} options={L.opt.salesmen} allowNone="Counter" onChange={setSalesmanId} />
        </HStack>
        {productId ? <Muted style={{ marginTop: 6 }}>Amount: {L.cur} {num(qty * rate(productId))}</Muted> : null}
        <Btn title="Add sale" onPress={add} style={{ marginTop: 10 }} />
      </Card>
      <Card title="Item sales today">
        {day.itemSales.length === 0 ? <Empty text="No item sales" /> : null}
        {day.itemSales.map((s) => (
          <ListItem
            key={s.id}
            title={`${L.productName(s.productId)} × ${num(s.qty)}`}
            sub={L.salesmanName(s.salesmanId)}
            right={`${L.cur} ${num(s.qty * rate(s.productId))}`}
            onDelete={() => set((d) => ({ ...d, itemSales: d.itemSales.filter((x) => x.id !== s.id) }))}
          />
        ))}
      </Card>
    </>
  );
}

// ---------------- Stock, purchases and dip ----------------

function Stock({ day, sum, set }: SectionProps) {
  const L = useLookups();
  const blank = { invoiceQty: 0, qty: 0, qtyEdited: false, amount: 0, invoiceNo: '' };
  const [f, setF] = useState({
    productId: undefined as string | undefined,
    ...blank,
    supplier: '',
    payMode: 'credit' as 'cash' | 'bank' | 'credit',
    bankId: undefined as string | undefined,
  });
  const unit = (f.productId && L.product.get(f.productId)?.unit) || 'L';
  const perUnit = f.qty > 0 ? f.amount / f.qty : 0;
  const short = f.invoiceQty > 0 ? round2(f.invoiceQty - f.qty) : 0;
  const add = () => {
    if (!f.productId || !f.qty) return Alert.alert('Missing', 'Select product and enter quantity received.');
    if (!f.amount) return Alert.alert('Missing', 'Enter the total amount of this tanker / purchase.');
    if (f.payMode === 'bank' && !f.bankId) return Alert.alert('Missing', 'Select the bank account used for payment.');
    const { productId, qty, invoiceQty, amount, supplier, invoiceNo, payMode, bankId } = f;
    set((d) => ({
      ...d,
      purchases: [
        ...d.purchases,
        { id: uid(), productId, qty, invoiceQty: invoiceQty || undefined, amount, rate: round2(perUnit), supplier, invoiceNo, payMode, bankId },
      ],
    }));
    setF({ ...f, ...blank });
  };
  return (
    <>
      <Card title="Stock position">
        {sum.stock.map((r) => {
          const p = L.product.get(r.productId);
          const low = p && p.minStock > 0 && r.closing < p.minStock;
          return (
            <View key={r.productId} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#EEF2F6' }}>
              <Text style={{ fontWeight: '700', color: C.text }}>
                {p?.name} {low ? <Text style={{ color: C.red }}> · LOW STOCK</Text> : null}
              </Text>
              <Row small label="Opening" value={num(r.opening)} />
              <Row small label="+ Received" value={num(r.received)} />
              <Row small label="− Sold" value={num(r.sold)} />
              <Row small label="= Book closing" value={num(r.book)} bold />
              <Row small label="Average cost" value={r.costRate > 0 ? `${L.cur} ${num(r.costRate)} / ${p?.unit ?? 'L'}` : 'not known yet'} />
              <HStack>
                <NumInput
                  label={p?.isFuel ? 'Dip / physical stock (optional)' : 'Physical count (optional)'}
                  allowEmpty
                  value={r.dip}
                  onChange={(v) => set((d) => ({ ...d, dips: { ...d.dips, [r.productId]: v } }))}
                />
              </HStack>
              {r.dip !== undefined ? (
                <Row small label="Gain / loss" value={`${r.variance > 0 ? '+' : ''}${num(r.variance)} ${p?.unit ?? ''}`} color={r.variance < 0 ? C.red : C.green} />
              ) : null}
            </View>
          );
        })}
      </Card>
      <Card title="Receive tanker / stock">
        <Select label="Product" value={f.productId} options={L.opt.products} onChange={(v) => setF({ ...f, productId: v })} />
        <HStack>
          <NumInput
            label={`${unit} on invoice / bilty`}
            value={f.invoiceQty}
            onChange={(v) => setF({ ...f, invoiceQty: v ?? 0, qty: f.qtyEdited ? f.qty : v ?? 0 })}
          />
          <NumInput label={`${unit} received (dip)`} value={f.qty} onChange={(v) => setF({ ...f, qty: v ?? 0, qtyEdited: true })} />
        </HStack>
        <NumInput label={`Total amount of this ${unit === 'L' ? 'tanker' : 'purchase'}`} value={f.amount} onChange={(v) => setF({ ...f, amount: v ?? 0 })} />
        {f.qty > 0 && f.amount > 0 ? (
          <Row small label={`Cost per ${unit}`} value={`${L.cur} ${num(perUnit, 4)}`} bold />
        ) : null}
        {short > 0 ? <Row small label="Short received" value={`${num(short)} ${unit}`} color={C.red} /> : null}
        {short < 0 ? <Row small label="Extra received" value={`${num(-short)} ${unit}`} color={C.green} /> : null}
        <HStack>
          <Field label="Supplier" value={f.supplier} onChange={(t) => setF({ ...f, supplier: t })} />
          <Field label="Invoice / Bilty #" value={f.invoiceNo} onChange={(t) => setF({ ...f, invoiceNo: t })} />
        </HStack>
        <HStack>
          <Select
            label="Payment"
            value={f.payMode}
            options={[
              { value: 'credit', label: 'On credit / advance' },
              { value: 'cash', label: 'Cash' },
              { value: 'bank', label: 'Bank' },
            ]}
            onChange={(v) => setF({ ...f, payMode: (v as typeof f.payMode) || 'credit' })}
          />
          {f.payMode === 'bank' ? <Select label="Bank" value={f.bankId} options={L.opt.banks} onChange={(v) => setF({ ...f, bankId: v })} /> : null}
        </HStack>
        <Btn title="Add stock received" onPress={add} style={{ marginTop: 10 }} />
      </Card>
      <Card title="Received today">
        {day.purchases.length === 0 ? <Empty text="No stock received" /> : null}
        {day.purchases.map((p) => (
          <ListItem
            key={p.id}
            title={`${L.productName(p.productId)} · ${num(p.qty)} ${L.product.get(p.productId)?.unit ?? ''}`}
            sub={[
              p.qty ? `@ ${num(purchaseAmount(p) / p.qty, 4)}` : '',
              p.invoiceQty && p.invoiceQty !== p.qty ? `invoice ${num(p.invoiceQty)}` : '',
              p.supplier,
              p.invoiceNo,
              p.payMode === 'bank' ? `Bank: ${L.bankName(p.bankId)}` : p.payMode,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={`${L.cur} ${num(purchaseAmount(p))}`}
            onDelete={() => set((d) => ({ ...d, purchases: d.purchases.filter((x) => x.id !== p.id) }))}
          />
        ))}
      </Card>
    </>
  );
}

// ---------------- Salesmen settlement ----------------

interface PayBucket {
  key: string;
  kind: PayKind;
  bankId: string;
  units: string[];
}

function Salesmen({ day, sum, set }: SectionProps) {
  const L = useLookups();
  const { data } = useStore();
  const ids = [...new Set([...sum.salesmen.map((r) => r.salesmanId), ...day.settlements.map((s) => s.salesmanId)])];
  const legacyKey = { card: paymentKey('card', data.settings.cardBankId), digital: paymentKey('digital', data.settings.digitalBankId) };

  /** One card and one digital box per bank account behind the dispensers this salesman worked. */
  const bucketsFor = (salesmanId: string): PayBucket[] => {
    const map = new Map<string, PayBucket>();
    const add = (kind: PayKind, bankId: string, unitId?: string) => {
      const key = paymentKey(kind, bankId);
      const b = map.get(key) || { key, kind, bankId, units: [] };
      if (unitId !== undefined) {
        const name = L.unitName(unitId);
        if (!b.units.includes(name)) b.units.push(name);
      }
      map.set(key, b);
    };
    const lines = sum.nozzles.filter((l) => l.salesmanId === salesmanId);
    for (const kind of ['card', 'digital'] as const) {
      if (lines.length === 0) add(kind, payBankFor(data, kind, undefined));
      for (const l of lines) add(kind, payBankFor(data, kind, l.nozzleId), l.unitId);
    }
    const st = day.settlements.find((x) => x.salesmanId === salesmanId);
    for (const [key, amount] of Object.entries(st?.payments || {})) if (amount) {
      const { kind, bankId } = parsePaymentKey(key);
      add(kind, bankId);
    }
    if (st?.cardSales) add('card', data.settings.cardBankId || '');
    if (st?.digitalSales) add('digital', data.settings.digitalBankId || '');
    return [...map.values()].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'card' ? -1 : 1));
  };
  const payValue = (salesmanId: string, b: PayBucket) => {
    const st = day.settlements.find((x) => x.salesmanId === salesmanId);
    let v = st?.payments?.[b.key] || 0;
    if (b.key === legacyKey.card) v += st?.cardSales || 0;
    if (b.key === legacyKey.digital) v += st?.digitalSales || 0;
    return v;
  };
  const setPay = (salesmanId: string, b: PayBucket, amount: number) =>
    set((d) => {
      const upd = (x: SalesmanSettlement): SalesmanSettlement => {
        const y = { ...x, payments: { ...(x.payments || {}), [b.key]: amount } };
        // Fold the older single-account amount into the per-bank entry it belonged to.
        if (b.key === legacyKey.card) y.cardSales = 0;
        if (b.key === legacyKey.digital) y.digitalSales = 0;
        return y;
      };
      const exists = d.settlements.some((x) => x.salesmanId === salesmanId);
      const settlements = exists
        ? d.settlements.map((x) => (x.salesmanId === salesmanId ? upd(x) : x))
        : [...d.settlements, upd({ salesmanId, cardSales: 0, digitalSales: 0, cashReceived: 0 })];
      return { ...d, settlements };
    });
  const payLabel = (b: PayBucket) =>
    `− ${b.kind === 'card' ? 'Card' : 'Digital'} · ${b.bankId ? L.bankName(b.bankId) : 'no bank'}${b.units.length ? ` (${b.units.join(', ')})` : ''}`;

  const setS = (salesmanId: string, patch: Partial<{ cardSales: number; digitalSales: number; cashReceived: number }>) =>
    set((d) => {
      const exists = d.settlements.some((s) => s.salesmanId === salesmanId);
      const settlements = exists
        ? d.settlements.map((s) => (s.salesmanId === salesmanId ? { ...s, ...patch } : s))
        : [...d.settlements, { salesmanId, cardSales: 0, digitalSales: 0, cashReceived: 0, ...patch }];
      return { ...d, settlements };
    });
  const [addId, setAddId] = useState<string>();
  return (
    <>
      {ids.length === 0 ? <Empty text="Assign salesmen to nozzles in the Meters tab, or add one below." /> : null}
      {ids.map((id) => {
        const r = sum.salesmen.find((x) => x.salesmanId === id);
        const st = day.settlements.find((x) => x.salesmanId === id);
        if (!r) return null;
        return (
          <Card key={id || 'counter'} title={L.salesmanName(id)} right={<Text style={{ color: diffColor(r.diff), fontWeight: '700' }}>{diffText(r.diff, L.cur)}</Text>}>
            <Row small label="Fuel sold" value={`${num(r.litres)} L · ${L.cur} ${num(r.fuelAmount)}`} />
            {r.itemAmount ? <Row small label="Lube / items" value={`${L.cur} ${num(r.itemAmount)}`} /> : null}
            <Row small label="Total sale" value={`${L.cur} ${num(r.saleAmount)}`} bold />
            <Row small label="− Credit sales (from Credit tab)" value={`${L.cur} ${num(r.credit)}`} />
            {bucketsFor(id).map((b) => (
              <NumInput key={b.key} label={payLabel(b)} value={payValue(id, b)} onChange={(v) => setPay(id, b, v ?? 0)} />
            ))}
            <Row label="= Cash due" value={`${L.cur} ${num(r.cashDue)}`} bold />
            <HStack>
              <NumInput label="Cash received from salesman" value={st?.cashReceived ?? 0} onChange={(v) => setS(id, { cashReceived: v ?? 0 })} />
              <Btn title="= Due" kind="secondary" small onPress={() => setS(id, { cashReceived: round2(r.cashDue) })} style={{ marginBottom: 6 }} />
            </HStack>
          </Card>
        );
      })}
      <Card title="Add salesman to today's settlement">
        <HStack>
          <Select value={addId} options={L.opt.salesmen.filter((o) => !ids.includes(o.value))} onChange={setAddId} />
          <Btn title="Add" onPress={() => addId && (setS(addId, {}), setAddId(undefined))} />
        </HStack>
      </Card>
      <Card title="Total">
        <Row label="Sales" value={`${L.cur} ${num(sum.totalSales)}`} />
        <Row label="Credit" value={`${L.cur} ${num(sum.credit)}`} />
        <Row label="Card" value={`${L.cur} ${num(sum.card)}`} />
        <Row label="Digital" value={`${L.cur} ${num(sum.digital)}`} />
        <Row label="Cash received" value={`${L.cur} ${num(sum.cash.salesCash)}`} bold />
        <Row label="Short / excess" value={diffText(sum.shortExcess, L.cur)} color={diffColor(sum.shortExcess)} bold />
      </Card>
    </>
  );
}

// ---------------- Credit ----------------

function Credit({ day, set }: SectionProps) {
  const L = useLookups();
  const [cs, setCs] = useState({ customerId: undefined as string | undefined, salesmanId: undefined as string | undefined, productId: undefined as string | undefined, qty: 0, amount: 0, vehicleNo: '', slipNo: '' });
  const [rc, setRc] = useState({ customerId: undefined as string | undefined, amount: 0, mode: 'cash' as 'cash' | 'bank', bankId: undefined as string | undefined, note: '' });
  const rate = (pid?: string) => {
    const p = pid ? L.product.get(pid) : undefined;
    return p ? rateOf(day, p) : 0;
  };
  const addSale = () => {
    if (!cs.customerId || !cs.amount) return Alert.alert('Missing', 'Select customer and enter amount.');
    const { customerId } = cs;
    set((d) => ({ ...d, creditSales: [...d.creditSales, { id: uid(), ...cs, customerId }] }));
    setCs({ ...cs, qty: 0, amount: 0, vehicleNo: '', slipNo: '' });
  };
  const addReceipt = () => {
    if (!rc.customerId || !rc.amount) return Alert.alert('Missing', 'Select customer and enter amount.');
    if (rc.mode === 'bank' && !rc.bankId) return Alert.alert('Missing', 'Select bank account.');
    const { customerId } = rc;
    set((d) => ({ ...d, creditReceipts: [...d.creditReceipts, { id: uid(), ...rc, customerId }] }));
    setRc({ ...rc, amount: 0, note: '' });
  };
  return (
    <>
      <Card title="Credit sale (udhaar)">
        <Select label="Customer" value={cs.customerId} options={L.opt.customers} onChange={(v) => setCs({ ...cs, customerId: v, vehicleNo: (v && L.customer.get(v)?.vehicleNo) || cs.vehicleNo })} />
        <HStack>
          <Select label="Product" value={cs.productId} options={L.opt.products} allowNone="— Any —" onChange={(v) => setCs({ ...cs, productId: v, amount: round2(cs.qty * rate(v)) })} />
          <NumInput label="Qty" value={cs.qty} onChange={(v) => setCs({ ...cs, qty: v ?? 0, amount: cs.productId ? round2((v ?? 0) * rate(cs.productId)) : cs.amount })} />
        </HStack>
        <HStack>
          <NumInput label="Amount" value={cs.amount} onChange={(v) => setCs({ ...cs, amount: v ?? 0 })} />
          <Select label="Salesman" value={cs.salesmanId} options={L.opt.salesmen} allowNone="Counter" onChange={(v) => setCs({ ...cs, salesmanId: v })} />
        </HStack>
        <HStack>
          <Field label="Vehicle #" value={cs.vehicleNo} onChange={(t) => setCs({ ...cs, vehicleNo: t })} />
          <Field label="Slip #" value={cs.slipNo} onChange={(t) => setCs({ ...cs, slipNo: t })} />
        </HStack>
        <Btn title="Add credit sale" onPress={addSale} style={{ marginTop: 10 }} />
      </Card>
      <Card title="Credit sales today">
        {day.creditSales.length === 0 ? <Empty text="None" /> : null}
        {day.creditSales.map((c) => (
          <ListItem
            key={c.id}
            title={L.customerName(c.customerId)}
            sub={[c.productId && `${L.productName(c.productId)} ${num(c.qty)}`, c.vehicleNo, L.salesmanName(c.salesmanId)].filter(Boolean).join(' · ')}
            right={`${L.cur} ${num(c.amount)}`}
            onDelete={() => set((d) => ({ ...d, creditSales: d.creditSales.filter((x) => x.id !== c.id) }))}
          />
        ))}
      </Card>
      <Card title="Recovery (payment received from customer)">
        <Select label="Customer" value={rc.customerId} options={L.opt.customers} onChange={(v) => setRc({ ...rc, customerId: v })} />
        <HStack>
          <NumInput label="Amount" value={rc.amount} onChange={(v) => setRc({ ...rc, amount: v ?? 0 })} />
          <Select label="Received in" value={rc.mode} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank / cheque' }]} onChange={(v) => setRc({ ...rc, mode: (v as 'cash' | 'bank') || 'cash' })} />
        </HStack>
        {rc.mode === 'bank' ? <Select label="Bank" value={rc.bankId} options={L.opt.banks} onChange={(v) => setRc({ ...rc, bankId: v })} /> : null}
        <Field label="Note / cheque #" value={rc.note} onChange={(t) => setRc({ ...rc, note: t })} />
        <Btn title="Add recovery" onPress={addReceipt} style={{ marginTop: 10 }} />
      </Card>
      <Card title="Recoveries today">
        {day.creditReceipts.length === 0 ? <Empty text="None" /> : null}
        {day.creditReceipts.map((r) => (
          <ListItem
            key={r.id}
            title={L.customerName(r.customerId)}
            sub={[r.mode === 'bank' ? `Bank: ${L.bankName(r.bankId)}` : 'Cash', r.note].filter(Boolean).join(' · ')}
            right={`${L.cur} ${num(r.amount)}`}
            onDelete={() => set((d) => ({ ...d, creditReceipts: d.creditReceipts.filter((x) => x.id !== r.id) }))}
          />
        ))}
      </Card>
    </>
  );
}

// ---------------- Expenses & other income ----------------

const EXPENSE_HEADS = ['Salaries', 'Electricity', 'Generator fuel', 'Food / tea', 'Repair & maintenance', 'Rent', 'Taxes', 'Stationery', 'Transport', 'Owner drawing', 'Misc'];

function Expenses({ day, set }: SectionProps) {
  const L = useLookups();
  const [e, setE] = useState({ head: 'Misc', amount: 0, mode: 'cash' as 'cash' | 'bank', bankId: undefined as string | undefined, note: '' });
  const [inc, setInc] = useState({ head: '', amount: 0, note: '' });
  const add = () => {
    if (!e.amount) return Alert.alert('Missing', 'Enter amount.');
    if (e.mode === 'bank' && !e.bankId) return Alert.alert('Missing', 'Select bank account.');
    set((d) => ({ ...d, expenses: [...d.expenses, { id: uid(), ...e }] }));
    setE({ ...e, amount: 0, note: '' });
  };
  return (
    <>
      <Card title="Add expense">
        <Select label="Expense head" value={e.head} options={EXPENSE_HEADS.map((h) => ({ value: h, label: h }))} onChange={(v) => setE({ ...e, head: v || 'Misc' })} />
        <HStack>
          <NumInput label="Amount" value={e.amount} onChange={(v) => setE({ ...e, amount: v ?? 0 })} />
          <Select label="Paid from" value={e.mode} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }]} onChange={(v) => setE({ ...e, mode: (v as 'cash' | 'bank') || 'cash' })} />
        </HStack>
        {e.mode === 'bank' ? <Select label="Bank" value={e.bankId} options={L.opt.banks} onChange={(v) => setE({ ...e, bankId: v })} /> : null}
        <Field label="Note" value={e.note} onChange={(t) => setE({ ...e, note: t })} />
        <Btn title="Add expense" onPress={add} style={{ marginTop: 10 }} />
      </Card>
      <Card title="Expenses today" right={<Text style={{ fontWeight: '700' }}>{L.cur} {num(day.expenses.reduce((a, x) => a + x.amount, 0))}</Text>}>
        {day.expenses.length === 0 ? <Empty text="No expenses" /> : null}
        {day.expenses.map((x) => (
          <ListItem
            key={x.id}
            title={x.head}
            sub={[x.mode === 'bank' ? `Bank: ${L.bankName(x.bankId)}` : 'Cash', x.note].filter(Boolean).join(' · ')}
            right={`${L.cur} ${num(x.amount)}`}
            onDelete={() => set((d) => ({ ...d, expenses: d.expenses.filter((y) => y.id !== x.id) }))}
          />
        ))}
      </Card>
      <Card title="Other cash income">
        <HStack>
          <Field label="Head (e.g. shop rent, tuck shop)" value={inc.head} onChange={(t) => setInc({ ...inc, head: t })} />
          <NumInput label="Amount" value={inc.amount} onChange={(v) => setInc({ ...inc, amount: v ?? 0 })} style={{ maxWidth: 120 }} />
        </HStack>
        <Btn
          title="Add income"
          kind="secondary"
          style={{ marginTop: 10 }}
          onPress={() => {
            if (!inc.amount) return;
            set((d) => ({ ...d, otherIncome: [...d.otherIncome, { id: uid(), ...inc, head: inc.head || 'Other income' }] }));
            setInc({ head: '', amount: 0, note: '' });
          }}
        />
        {day.otherIncome.map((x) => (
          <ListItem key={x.id} title={x.head} right={`${L.cur} ${num(x.amount)}`} onDelete={() => set((d) => ({ ...d, otherIncome: d.otherIncome.filter((y) => y.id !== x.id) }))} />
        ))}
      </Card>
    </>
  );
}

// ---------------- Bank ----------------

function Bank({ day, sum, set }: SectionProps) {
  const L = useLookups();
  const { data } = useStore();
  const [prefill, setPrefill] = useState<TxnPrefill>();
  if (data.banks.length === 0) return <Empty text="Add a bank account in Setup → Bank accounts first." />;
  return (
    <>
      {sum.unitCash.length ? (
        <Card title="Dispenser cash → bank">
          <Muted style={{ marginBottom: 6 }}>
            Cash received from salesmen, split by their sales on each dispenser, and what has been deposited. Pending carries to the next day.
          </Muted>
          {sum.unitCash.map((u) => {
            const own = u.unitId ? L.unit.get(u.unitId)?.bankId : undefined;
            return (
              <View key={u.unitId || 'none'} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: '#EEF2F6' }}>
                <Text style={{ fontWeight: '700', color: C.text }}>
                  {u.unitId ? L.unitName(u.unitId) : 'Not tied to a dispenser'}
                  {own ? <Text style={{ fontWeight: '400', color: C.muted }}> → {L.bankName(own)}</Text> : null}
                </Text>
                {u.opening ? <Row small label="Pending from earlier" value={num(u.opening)} /> : null}
                <Row small label="+ Cash collected today" value={num(u.collected)} />
                {u.deposits.map((d, i) => (
                  <Row
                    key={i}
                    small
                    label={`− Deposited in ${L.bankName(d.bankId)}${d.cross ? ' ⇄ cross' : ''}`}
                    value={num(d.amount)}
                    color={d.cross ? C.accent : undefined}
                  />
                ))}
                <HStack style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Row label={u.closing > 0 ? 'Still to deposit' : u.closing < 0 ? 'Deposited more than collected' : 'All deposited ✓'} value={num(u.closing)} color={u.closing > 0.004 ? C.red : C.green} bold />
                </HStack>
                {u.closing > 0.004 ? (
                  <Btn
                    title={`Deposit ${L.cur} ${num(u.closing)}${own ? ' in ' + L.bankName(own) : ''}`}
                    kind="secondary"
                    small
                    onPress={() => setPrefill({ nonce: Date.now(), type: 'deposit', unitId: u.unitId || undefined, amount: u.closing })}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}
      <Card title="Add bank transaction">
        <BankTxnForm date={day.date} prefill={prefill} onAdd={(_, txn) => set((d) => ({ ...d, bankTxns: [...d.bankTxns, txn] }))} />
      </Card>
      <Card title="Bank transactions entered">
        {day.bankTxns.length === 0 ? <Empty text="None" /> : null}
        {day.bankTxns.map((x) => (
          <ListItem
            key={x.id}
            title={txnTitle(x, L)}
            sub={[L.bankName(x.bankId), x.note].filter(Boolean).join(' · ')}
            right={`${txnSign(x)}${num(x.amount)}`}
            onDelete={() => set((d) => ({ ...d, bankTxns: d.bankTxns.filter((y) => y.id !== x.id) }))}
          />
        ))}
      </Card>
      <Card title="All bank movements today">
        <Muted style={{ marginBottom: 6 }}>Also includes card/digital sales (to each dispenser's bank), bank recoveries, bank expenses and bank-paid purchases.</Muted>
        {sum.bankMoves.length === 0 ? <Empty text="No bank movements" /> : null}
        {sum.bankMoves.map((m, i) => (
          <ListItem key={i} title={m.description} sub={L.bankName(m.bankId)} right={m.credit ? `+${num(m.credit)}` : `−${num(m.debit)}`} />
        ))}
      </Card>
    </>
  );
}

// ---------------- Cash ----------------

function Cash({ day, sum, set }: SectionProps) {
  const L = useLookups();
  const c = sum.cash;
  return (
    <>
      <Card title="Cash calculation">
        <Row label="Opening cash in hand" value={num(c.opening)} />
        <Row label="+ Cash from salesmen" value={num(c.salesCash)} />
        <Row label="+ Credit recovery (cash)" value={num(c.creditRecovery)} />
        <Row label="+ Other income" value={num(c.otherIncome)} />
        <Row label="+ Bank withdrawals" value={num(c.bankWithdrawals)} />
        <Row label="− Expenses (cash)" value={num(c.expenses)} />
        <Row label="− Purchases paid in cash" value={num(c.purchases)} />
        <Row label="− Deposited in bank" value={num(c.bankDeposits)} />
        <Divider />
        <Row label="Expected cash in hand" value={`${L.cur} ${num(c.expected)}`} bold />
        {c.hasCount ? (
          <>
            <Row label="Counted cash" value={`${L.cur} ${num(c.counted)}`} bold />
            <Row label="Difference" value={diffText(c.difference, L.cur)} color={diffColor(c.difference)} bold />
          </>
        ) : null}
      </Card>
      <Card title="Cash count (denominations)" right={<Btn title="Clear" small kind="secondary" onPress={() => set((d) => ({ ...d, cashCount: {}, looseCash: 0 }))} />}>
        {DENOMINATIONS.map((den) => {
          const n = day.cashCount[String(den)] || 0;
          return (
            <HStack key={den} style={{ alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ width: 70, fontWeight: '600', color: C.text }}>{num(den)} ×</Text>
              <NumInput value={n} onChange={(v) => set((d) => ({ ...d, cashCount: { ...d.cashCount, [String(den)]: v ?? 0 } }))} />
              <Text style={{ width: 110, textAlign: 'right', color: C.text }}>{num(den * n)}</Text>
            </HStack>
          );
        })}
        <HStack style={{ alignItems: 'center' }}>
          <Text style={{ width: 70, fontWeight: '600', color: C.text }}>Loose</Text>
          <NumInput value={day.looseCash} onChange={(v) => set((d) => ({ ...d, looseCash: v ?? 0 }))} />
          <Text style={{ width: 110 }} />
        </HStack>
        <Divider />
        <Row label="Total counted" value={`${L.cur} ${num(c.counted)}`} bold />
      </Card>
      <Muted>Closing cash carried to next day: {L.cur} {num(c.closing)} ({c.hasCount ? 'counted' : 'expected'})</Muted>
    </>
  );
}

// ---------------- Summary ----------------

function Summary({ day, sum, set }: SectionProps) {
  const L = useLookups();
  const { data, updateDay, update } = useStore();
  const deleteDay = () =>
    update((d) => {
      const days = { ...d.days };
      delete days[day.date];
      return { ...d, days };
    });
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Stat label="Total sales" value={`${L.cur} ${num(sum.totalSales)}`} />
        <Stat label="Fuel sold" value={`${num(sum.fuelLitres)} L`} />
        <Stat label="Short / excess" value={num(sum.shortExcess)} color={diffColor(sum.shortExcess)} />
        <Stat label="Cash in hand" value={`${L.cur} ${num(sum.cash.closing)}`} />
      </View>
      <Card title="Sales breakdown">
        <Row label="Fuel" value={num(sum.fuelAmount)} />
        <Row label="Lube / items" value={num(sum.itemAmount)} />
        <Row label="Total sales" value={num(sum.totalSales)} bold />
        <Divider />
        <Row label="Credit sales" value={num(sum.credit)} />
        <Row label="Card" value={num(sum.card)} />
        <Row label="Digital" value={num(sum.digital)} />
        <Row label="Cash from salesmen" value={num(sum.cash.salesCash)} />
      </Card>
      <Card title="Profit (estimate)">
        <Row label="Gross margin (sale − average cost)" value={num(sum.grossMargin)} />
        <Row label="Stock gain / loss (at cost)" value={num(sum.stockGainLossValue)} />
        <Row label="Other income" value={num(sum.otherIncome)} />
        <Row label="Expenses" value={`−${num(sum.expenses)}`} />
        <Row label="Net profit" value={`${L.cur} ${num(sum.netProfit)}`} bold color={sum.netProfit < 0 ? C.red : C.green} />
        {sum.costUnknown.length ? (
          <Muted style={{ marginTop: 4 }}>
            Cost not known yet for {sum.costUnknown.map((id) => L.productName(id)).join(', ')}, so it is left out of profit. Enter a tanker under Stock & Dip.
          </Muted>
        ) : null}
      </Card>
      <Card title="Notes">
        <Field value={day.notes} onChange={(t) => set((d) => ({ ...d, notes: t }))} multiline placeholder="Any remarks for the day…" />
      </Card>
      <HStack style={{ marginBottom: 12 }}>
        <Btn title="📄 Share / print report" onPress={() => shareDayReport(data, sum).catch((e) => Alert.alert('Error', String(e)))} style={{ flex: 1 }} />
      </HStack>
      <Btn
        title={day.locked ? '🔓 Unlock day' : '🔒 Close & lock day'}
        kind={day.locked ? 'secondary' : 'primary'}
        onPress={() => updateDay(day.date, (d) => ({ ...d, locked: !d.locked }))}
      />
      {data.days[day.date] && !day.locked ? (
        <Btn
          title="Delete this day"
          kind="ghost"
          style={{ marginTop: 16 }}
          onPress={() =>
            Alert.alert('Delete day?', 'All entries for this date will be removed.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: deleteDay },
            ])
          }
        />
      ) : null}
    </>
  );
}
