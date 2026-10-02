import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { daySummaryMessage } from '../creditMessage';
import { useLookups } from '../hooks';
import { canSendDirect, sendSmsDirect } from '../sms';
import { useStore } from '../store';
import type { DayRecord } from '../types';
import { Btn, Empty, ListItem, Muted } from '../ui';
import { num } from '../utils';
import { resendSms, smsModeOf } from './CreditForm';

type SmsStatus = 'sent' | 'opened' | 'failed';

/** One SMS per customer listing every vehicle filled on credit that day. */
export function DaySummarySms({ day }: { day: DayRecord }) {
  const { data, updateDay } = useStore();
  const L = useLookups();
  const [busy, setBusy] = useState(false);
  const ids = [...new Set(day.creditSales.map((s) => s.customerId))];
  const mark = (customerId: string) => (status: SmsStatus) =>
    updateDay(day.date, (d) => ({ ...d, summarySms: { ...(d.summarySms || {}), [customerId]: status } }));
  const direct = smsModeOf(data.settings) !== 'off' && canSendDirect();

  const sendAll = async (only: string[]) => {
    setBusy(true);
    const failed: string[] = [];
    for (const id of only) {
      const c = L.customer.get(id);
      if (!c?.phone) {
        failed.push(`${c?.name ?? '—'} (no mobile number)`);
        continue;
      }
      const r = await sendSmsDirect(c.phone, daySummaryMessage(data, id, day.date));
      const ok = r.result === 'sent' || r.result === 'unknown';
      mark(id)(ok ? 'sent' : 'failed');
      if (!ok) failed.push(`${c.name} (${r.result === 'no-permission' ? 'SMS permission not allowed' : r.error ?? r.result})`);
    }
    setBusy(false);
    Alert.alert(failed.length ? 'Some SMS not sent' : 'SMS sent', failed.length ? failed.join('\n') : `Sent to ${only.length} customer${only.length === 1 ? '' : 's'}.`);
  };

  if (ids.length === 0) return <Empty text="No credit this day" />;
  const unsent = ids.filter((id) => day.summarySms?.[id] !== 'sent');
  return (
    <View>
      {ids.map((id) => {
        const c = L.customer.get(id);
        const sales = day.creditSales.filter((s) => s.customerId === id);
        const total = sales.reduce((a, s) => a + (s.amount || 0), 0);
        const st = day.summarySms?.[id];
        return (
          <ListItem
            key={id}
            title={`${c?.name ?? '—'} · ${L.cur} ${num(total)}`}
            sub={[
              `${sales.length} fill${sales.length === 1 ? '' : 's'}`,
              [...new Set(sales.map((s) => s.vehicleNo).filter(Boolean))].join(', '),
              st === 'sent' ? '✓ SMS sent' : st === 'failed' ? '✗ SMS failed' : st === 'opened' ? 'SMS opened' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
            right="💬"
            onPress={() =>
              c?.phone
                ? resendSms(data, c.phone, c.name, daySummaryMessage(data, id, day.date), mark(id))
                : Alert.alert('No mobile number', `Add ${c?.name ?? 'the customer'}'s mobile in the Credit tab.`)
            }
          />
        );
      })}
      {direct && unsent.length ? (
        <Btn
          title={busy ? 'Sending…' : `Send to all not yet sent (${unsent.length})`}
          disabled={busy}
          style={{ marginTop: 8 }}
          onPress={() => Alert.alert('Send day summary', `Send one SMS each to ${unsent.length} customer${unsent.length === 1 ? '' : 's'}?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Send', onPress: () => sendAll(unsent) },
          ])}
        />
      ) : null}
      <Muted style={{ marginTop: 4 }}>Tap 💬 to see and send one customer's SMS: every vehicle filled this day, the day's total and the balance due.</Muted>
    </View>
  );
}
