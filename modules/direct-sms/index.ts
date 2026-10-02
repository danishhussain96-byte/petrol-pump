import { requireOptionalNativeModule } from 'expo';

interface DirectSmsNative {
  isAvailable(): boolean;
  hasPermission(): boolean;
  send(phone: string, message: string): Promise<'sent' | 'unknown'>;
}

/** Android-only native module that sends SMS from the SIM without opening the SMS app. Null elsewhere. */
export const DirectSms = requireOptionalNativeModule<DirectSmsNative>('DirectSms');
