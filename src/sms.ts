import * as SMS from 'expo-sms';
import { Alert, Linking } from 'react-native';

/** Opens the SMS app with the message filled in; the user taps Send. */
export async function sendSms(phone: string, message: string): Promise<void> {
  if (!phone.trim()) {
    Alert.alert('No mobile number', 'Add the customer\'s mobile number in Setup → Customers.');
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
    Alert.alert('No mobile number', 'Add the customer\'s mobile number in Setup → Customers.');
    return;
  }
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  await Linking.openURL(url);
}
