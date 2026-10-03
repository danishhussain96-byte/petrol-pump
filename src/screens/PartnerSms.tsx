import React, { useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { partnerDayMessage } from '../creditMessage';
import { canSendDirect, sendSmsDirect, sendSmsMany } from '../sms';
import { useStore } from '../store';
import type { DayRecord } from '../types';
import { Btn, C, HStack, Muted } from '../ui';
import { smsModeOf } from './CreditForm';

/** End-of-day credit report for the station's partners: preview, send by SMS, or share (WhatsApp group). */
export function PartnerSms({ day }: { day: DayRecord }) {
  const { data, updateDay } = useStore();
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const partners = data.settings.partners ?? [];
  const msg = partnerDayMessage(data, day.date);
  const direct = smsModeOf(data.settings) !== 'off' && canSendDirect();
  const sent = day.partnerSms;

  const send = async () => {
    if (!partners.length) return Alert.alert('No partners', 'Add partners and their mobile numbers in Setup → Settings & backup.');
    if (!direct) {
      await sendSmsMany(partners.map((p) => p.phone), msg).catch((e) => Alert.alert('Error', String(e)));
      return;
    }
    setBusy(true);
    const failed: string[] = [];
    for (const p of partners) {
      const r = await sendSmsDirect(p.phone, msg);
      if (r.result !== 'sent' && r.result !== 'unknown') failed.push(`${p.name} (${r.result === 'no-permission' ? 'SMS permission not allowed' : r.error ?? r.result})`);
    }
    setBusy(false);
    updateDay(day.date, (d) => ({ ...d, partnerSms: { at: new Date().toISOString(), sent: partners.length - failed.length, failed: failed.length } }));
    Alert.alert(failed.length ? 'Some SMS not sent' : 'Report sent', failed.length ? failed.join('\n') : `Sent to ${partners.length} partner${partners.length === 1 ? '' : 's'}.`);
  };

  return (
    <View>
      <Muted>
        {partners.length
          ? `To: ${partners.map((p) => p.name).join(', ')}`
          : 'No partners yet. Add them in Setup → Settings & backup → Partners.'}
      </Muted>
      {sent ? (
        <Text style={{ color: sent.failed ? C.red : C.green, marginTop: 4 }}>
          {sent.failed ? `✗ ${sent.failed} not sent, ${sent.sent} sent` : `✓ Sent to ${sent.sent}`} at {new Date(sent.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      ) : null}
      <HStack style={{ marginTop: 8 }}>
        <Btn
          title={busy ? 'Sending…' : sent ? 'Send again' : `Send SMS${partners.length ? ` (${partners.length})` : ''}`}
          disabled={busy}
          style={{ flex: 1 }}
          onPress={() =>
            Alert.alert('Send day report to partners?', msg, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Send', onPress: send },
            ])
          }
        />
        <Btn title="Share / WhatsApp" kind="secondary" onPress={() => Share.share({ message: msg }).catch(() => {})} />
      </HStack>
      <Btn title={show ? 'Hide message' : 'See message'} kind="ghost" small onPress={() => setShow(!show)} style={{ marginTop: 4, alignSelf: 'flex-start' }} />
      {show ? (
        <Text selectable style={{ backgroundColor: '#F7FAFD', padding: 8, borderRadius: 8, color: C.text, fontSize: 13 }}>
          {msg}
        </Text>
      ) : null}
    </View>
  );
}
