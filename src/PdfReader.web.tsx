import { useEffect } from 'react';
import type { PdfResult } from './PdfReader';

export type { PdfResult } from './PdfReader';

/** The browser preview has no WebView; PDF statements are read in the Android / iPhone app. */
export function PdfReader({ onDone }: { base64: string; password?: string; onDone: (r: PdfResult) => void }) {
  useEffect(() => onDone({ error: 'unsupported', message: 'PDF reading works in the phone app. Use Excel or CSV here.' }), [onDone]);
  return null;
}
