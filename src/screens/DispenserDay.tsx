import React, { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { carryFor, creditStatus, rateOf } from '../calc';
import { creditMessage } from '../creditMessage';
import { useLookups } from '../hooks';
import { useStore } from '../store';
import type { NozzleReading, UnitSettlement } from '../types';
import { Btn, C, Card, Divider, Empty, HStack, ListItem, Muted, NumInput, Row, Select, confirm, diffColor, diffText } from '../ui';
import { num, round2, todayStr } from '../utils';
import { BankTxnForm } from './BankTxnForm';
import { CreditForm, resendSms } from './CreditForm';
import { ReceivePayment } from './ReceivePayment';
import type { SectionProps } from './DayEntry';

/** Everything about one dispenser for the day on one page: nozzles, sale, receipts, credit, deposit. */
export function DispenserDay({ unitId, day, sum, set }: SectionProps & { unitId: string }) {
  const { data, ledger, update, updateDay } = useStore();
  const L = useLookups();
  const [showCredit, setShowCredit] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const unit = L.unit.get(unitId);
  const carry = carryFor(data, ledger, day.date);
  const nozzleIds = [
    ...new Set([
      ...data.nozzles.filter((n) => n.unitId === unitId && n.active).map((n) => n.id),
      ...day.readings.filter((r) => L.nozzle.get(r.nozzleId)?.unitId === unitId).map((r) => r.nozzleId),
    ]),
  ];
  const readingOf = (id: string): NozzleReading =>
    day.readings.find((r) => r.nozzleId === id) ?? {
      nozzleId: id,
      productId: L.nozzle.get(id)?.productId,
      opening: carry.meters[id] ?? L.nozzle.get(id)?.openingReading ?? 0,
      closing: 0,
      testLitres: 0,
    };
  const setReading = (id: string, patch: Partial<NozzleReading>) =>
    set((d) => {
      const exists = d.readings.some((r) => r.nozzleId === id);
      return {
        ...d,
        readings: exists ? d.readings.map((r) => (r.nozzleId === id ? { ...r, ...patch } : r)) : [...d.readings, { ...readingOf(id), ...patch }],
      };
    });
  const salesmanId = nozzleIds.map((id) => readingOf(id).salesmanId).find(Boolean);
  const setSalesman = (v?: string) =>
    set((d) => {
      let readings = d.readings.map((r) => (nozzleIds.includes(r.nozzleId) ? { ...r, salesmanId: v } : r));
      for (const id of nozzleIds) if (!readings.some((r) => r.nozzleId === id)) readings = [...readings, { ...readingOf(id), salesmanId: v }];
      return { ...d, readings };
    });
  const us: UnitSettlement = day.unitSettlements?.[unitId] ?? { cash: 0, online: 0, pos: 0 };
  const setUs = (patch: Partial<UnitSettlement>) => set((d) => ({ ...d, unitSettlements: { ...(d.unitSettlements || {}), [unitId]: { ...us, ...patch } } }));
  const sheet = sum.unitSales.find((u) => u.unitId === unitId);
  // Active fuels, plus any product a nozzle is set to today even if switched off in Setup.
  const usedToday = new Set(nozzleIds.map((id) => readingOf(id).productId));
  const fuels = data.products.filter((p) => p.isFuel && (p.active || usedToday.has(p.id)));
  const credits = day.creditSales.filter((c) => c.unitId === unitId);
  const receipts = day.creditReceipts.filter((r) => r.unitId === unitId);
  const asOf = day.date > todayStr() ? day.date : todayStr();
  const cash = sum.unitCash.find((u) => u.unitId === unitId);

  const changeProduct = (nozzleId: string, productId: string) => {
    if (readingOf(nozzleId).productId === productId) return;
    Alert.alert(
      'Change product?',
      `${L.nozzle.get(nozzleId)?.name} will sell ${L.productName(productId)} from this day on. Earlier days are not changed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change',
          onPress: () => {
            setReading(nozzleId, { productId });
            update((d) => ({ ...d, nozzles: d.nozzles.map((n) => (n.id === nozzleId ? { ...n, productId } : n)) }));
          },
        },
      ],
    );
  };

  if (!unit) return <Empty text="Dispenser not found" />;
  return (
    <>
      <Card title={`⛽ ${unit.name}`} right={<Text style={{ fontWeight: '700', color: C.primary }}>{L.cur} {num(sheet?.fuelAmount ?? 0)}</Text>}>
        <Select label="Salesman" value={salesmanId} options={L.opt.salesmen} allowNone="— Not assigned —" onChange={setSalesman} />
        <HStack style={{ flexWrap: 'wrap', marginTop: 4 }}>
          {[...new Set(nozzleIds.map((id) => readingOf(id).productId).filter(Boolean))].map((pid) => {
            const p = L.product.get(pid!);
            if (!p) return null;
            return (
              <NumInput
                key={pid}
                style={{ minWidth: 100 }}
                label={`${p.name} rate`}
                value={rateOf(day, p)}
                onChange={(v) => set((d) => ({ ...d, rates: { ...d.rates, [p.id]: v ?? 0 } }))}
              />
            );
          })}
        </HStack>
      </Card>

      <Card title="Nozzles (meter readings)">
        {nozzleIds.length === 0 ? <Empty text="No nozzles on this dispenser. Add them in Setup → Nozzles." /> : null}
        {nozzleIds.map((id) => {
          const r = readingOf(id);
          const line = sum.nozzles.find((l) => l.nozzleId === id);
          const invalid = r.closing > 0 && r.closing < r.opening;
          return (
            <View key={id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: '#EEF2F6' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                <Text style={{ fontWeight: '700', color: C.text, minWidth: 54 }}>{L.nozzle.get(id)?.name}</Text>
                <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                  {fuels.map((p) => {
                    const on = r.productId === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => changeProduct(id, p.id)}
                        style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: on ? C.primary : C.chip }}
                      >
                        <Text style={{ color: on ? '#fff' : C.primaryDark, fontSize: 12, fontWeight: '600' }}>{p.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={{ fontWeight: '700', color: C.primary }}>{num(line?.litres ?? 0)} L</Text>
              </View>
              <HStack>
                <NumInput label="Opening" value={r.opening} onChange={(v) => setReading(id, { opening: v ?? 0 })} />
                <NumInput label="Closing" value={r.closing} onChange={(v) => setReading(id, { closing: v ?? 0 })} />
                <NumInput label="Test" value={r.testLitres} onChange={(v) => setReading(id, { testLitres: v ?? 0 })} style={{ maxWidth: 74 }} />
              </HStack>
              {invalid ? <Text style={{ color: C.red, marginTop: 4 }}>Closing is less than opening.</Text> : null}
            </View>
          );
        })}
      </Card>

      <Card title="Sale">
        {(sheet?.byProduct ?? []).map((b) => (
          <View key={b.productId} style={{ paddingVertical: 4 }}>
            <Row label={L.productName(b.productId)} value={`${L.cur} ${num(b.amount)}`} bold />
            <Muted>
              {num(b.litres + b.testLitres)} L{b.testLitres ? ` − ${num(b.testLitres)} test` : ''} = {num(b.litres)} L × {num(b.rate)}
            </Muted>
          </View>
        ))}
        <Divider />
        <Row label={`Total sale · ${num(sheet?.litres ?? 0)} L`} value={`${L.cur} ${num(sheet?.fuelAmount ?? 0)}`} bold />
      </Card>

      <Card title="Money received">
        <HStack>
          <NumInput label="Cash" value={us.cash} onChange={(v) => setUs({ cash: v ?? 0 })} />
          <NumInput label="Online / UPI" value={us.online} onChange={(v) => setUs({ online: v ?? 0 })} />
        </HStack>
        <HStack>
          <NumInput label="POS (card)" value={us.pos} onChange={(v) => setUs({ pos: v ?? 0 })} />
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Muted>Credit (from list below)</Muted>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, paddingVertical: 10 }}>{num(sheet?.credit ?? 0)}</Text>
          </View>
        </HStack>
        <Btn
          title="Cash = sale − online − POS − credit"
          kind="secondary"
          small
          style={{ marginTop: 8, alignSelf: 'flex-start' }}
          onPress={() => setUs({ cash: round2((sheet?.fuelAmount ?? 0) - us.online - us.pos - (sheet?.credit ?? 0)) })}
        />
        <Divider />
        <Row label="Total received" value={`${L.cur} ${num(sheet?.received ?? 0)}`} bold />
        <Row label="Sale" value={`${L.cur} ${num(sheet?.fuelAmount ?? 0)}`} />
        <Row label="Short / excess" value={diffText(sheet?.diff ?? 0, L.cur)} color={diffColor(sheet?.diff ?? 0)} bold />
        {unit.bankId || unit.cardBankId ? (
          <Muted style={{ marginTop: 4 }}>
            POS → {L.bankName(unit.cardBankId || unit.bankId)} · Online → {L.bankName(unit.digitalBankId || unit.bankId)} (posted automatically)
          </Muted>
        ) : null}
      </Card>

      <Card
        title={`Credit (${credits.length})`}
        right={
          <HStack>
            <Btn
              title={showPay ? 'Close' : 'Receive'}
              small
              kind="secondary"
              onPress={() => {
                setShowPay(!showPay);
                setShowCredit(false);
              }}
            />
            <Btn
              title={showCredit ? 'Close' : '+ Credit'}
              small
              kind={showCredit ? 'secondary' : 'primary'}
              onPress={() => {
                setShowCredit(!showCredit);
                setShowPay(false);
              }}
            />
          </HStack>
        }
      >
        {showCredit ? (
          <View style={{ backgroundColor: '#F7FAFD', padding: 8, borderRadius: 8, marginBottom: 8 }}>
            <CreditForm day={day} set={set} unitId={unitId} />
          </View>
        ) : null}
        {showPay ? (
          <View style={{ backgroundColor: '#F2FAF5', padding: 8, borderRadius: 8, marginBottom: 8 }}>
            <Text style={{ fontWeight: '700', color: C.text }}>Payment from credit customer</Text>
            <ReceivePayment date={day.date} unitId={unitId} onDone={() => setShowPay(false)} />
          </View>
        ) : null}
        {credits.length === 0 ? <Empty text="No credit on this dispenser" /> : null}
        {credits.map((c) => {
          const cust = L.customer.get(c.customerId);
          const due = creditStatus(data, c.customerId, asOf).balance;
          return (
            <ListItem
              key={c.id}
              title={`${cust?.name ?? '—'} · ${L.cur} ${num(c.amount)}`}
              sub={[
                c.nozzleId && L.nozzle.get(c.nozzleId)?.name,
                c.productId && `${L.productName(c.productId)} ${num(c.qty)} L`,
                c.vehicleNo,
                c.slipNo && `Slip ${c.slipNo}`,
                `due now ${num(due)}`,
                c.sms === 'sent' ? '✓ SMS sent' : c.sms === 'failed' ? '✗ SMS failed' : c.sms === 'opened' ? 'SMS opened' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              right="💬"
              onPress={() =>
                cust &&
                resendSms(data, cust.phone, cust.name, creditMessage(data, c.customerId, day.date, c), (status) =>
                  updateDay(day.date, (d) => ({ ...d, creditSales: d.creditSales.map((x) => (x.id === c.id ? { ...x, sms: status } : x)) })),
                )
              }
              onDelete={() => set((d) => ({ ...d, creditSales: d.creditSales.filter((x) => x.id !== c.id) }))}
            />
          );
        })}
        {credits.length ? <Muted style={{ marginTop: 4 }}>Tap 💬 to send that customer an SMS again.</Muted> : null}
        {receipts.length ? (
          <>
            <Divider />
            <Text style={{ fontWeight: '700', color: C.text, marginBottom: 2 }}>Payments received here</Text>
            {receipts.map((r) => (
              <ListItem
                key={r.id}
                title={`${L.customerName(r.customerId)} · ${L.cur} ${num(r.amount)}`}
                sub={[
                  r.mode === 'bank' ? `Bank: ${L.bankName(r.bankId)}` : 'Cash',
                  `due now ${num(creditStatus(data, r.customerId, asOf).balance)}`,
                  r.sms === 'sent' ? '✓ SMS sent' : r.sms === 'failed' ? '✗ SMS failed' : '',
                  r.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onDelete={() => set((d) => ({ ...d, creditReceipts: d.creditReceipts.filter((x) => x.id !== r.id) }))}
              />
            ))}
            <Muted style={{ marginTop: 4 }}>Payments are customer recoveries, kept out of this dispenser's sale cash (shown in Station → Credit).</Muted>
          </>
        ) : null}
      </Card>

      <Card
        title="Cash → bank"
        right={<Btn title={showDeposit ? 'Close' : 'Deposit'} small kind="secondary" onPress={() => setShowDeposit(!showDeposit)} />}
      >
        <Row label="Pending from earlier" value={num(cash?.opening ?? 0)} small />
        <Row label="+ Cash today" value={num(cash?.collected ?? 0)} small />
        {(cash?.deposits ?? []).map((d) => {
          const today = day.bankTxns.some((x) => x.id === d.txnId);
          return (
            <View key={d.txnId} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Row small label={`− Deposited in ${L.bankName(d.bankId)}${d.cross ? ' ⇄ cross' : ''}`} value={num(d.amount)} color={d.cross ? C.accent : undefined} />
              </View>
              {today ? (
                <Pressable
                  hitSlop={10}
                  onPress={() => confirm(`Delete this deposit of ${num(d.amount)}?`, () => set((x) => ({ ...x, bankTxns: x.bankTxns.filter((t) => t.id !== d.txnId) })))}
                >
                  <Text style={{ color: C.red, fontSize: 16, paddingLeft: 8 }}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Row label="Still to deposit" value={num(cash?.closing ?? 0)} color={(cash?.closing ?? 0) > 0.004 ? C.red : C.green} bold />
        {showDeposit ? (
          <View style={{ backgroundColor: '#F7FAFD', padding: 8, borderRadius: 8, marginTop: 8 }}>
            <BankTxnForm
              date={day.date}
              prefill={{ nonce: 1, type: 'deposit', unitId, amount: Math.max(0, cash?.closing ?? 0) }}
              onAdd={(_, txn) => {
                set((d) => ({ ...d, bankTxns: [...d.bankTxns, txn] }));
                setShowDeposit(false);
              }}
            />
          </View>
        ) : null}
      </Card>
    </>
  );
}
