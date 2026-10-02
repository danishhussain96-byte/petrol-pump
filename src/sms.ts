import * as SMS from 'expo-sms';
import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { DirectSms } from '../modules/direct-sms';

/** Opens the SMS app with the message filled in; the user taps Send. */
export async function sendSms(phone: string, message: string): Promise<void> {
  if (!phone.trim()) {
    Alert.alert('No mobile number', 'Add the customer\'s mobile number in the Credit tab.');
    return;
  }
  if (await SMS.isAvailableAsync()) {
    await SMS.sendSMSAsync([phone.trim()], message);
  } else {
    await Linking.openURL(`sms:${encodeURIComponent(phone.trim())}?body=${encodeURIComponent(message)}`);
  }
}

/** Opens WhatsApp chat with the message. Numbers without a country code are left as typed. */
export async function sendWhatsApp(phone: string, message: string): Promise<void> {
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) {
    Alert.alert('No mobile number', 'Add the customer\'s mobile number in the Credit tab.');
    return;
  }
  await Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
}

/** Whether this phone can send SMS by itself (Android with a SIM). iPhone never allows it. */
export function canSendDirect(): boolean {
  try {
    return Platform.OS === 'android' && !!DirectSms && DirectSms.isAvailable();
  } catch {
    return false;
  }
}

async function ensurePermission(): Promise<boolean> {
  if (!DirectSms) return false;
  if (DirectSms.hasPermission()) return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
    title: 'Allow sending SMS',
    message: 'So credit customers get their balance by SMS automatically, without you tapping Send.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export type DirectResult = 'sent' | 'unknown' | 'no-permission' | 'unavailable' | 'failed' | 'no-number';

/**
 * Sends the SMS straight from the phone's SIM (Android). Uses normal SMS charges of the SIM.
 * Never throws; the caller can fall back to the SMS app when it doesn't return 'sent' / 'unknown'.
 */
export async function sendSmsDirect(phone: string, message: string): Promise<{ result: DirectResult; error?: string }> {
  if (!phone.trim()) return { result: 'no-number' };
  if (!canSendDirect()) return { result: 'unavailable' };
  try {
    if (!(await ensurePermission())) return { result: 'no-permission' };
    const r = await DirectSms!.send(phone.trim(), message);
    return { result: r };
  } catch (e) {
    return { result: 'failed', error: String((e as Error)?.message ?? e) };
  }
}
