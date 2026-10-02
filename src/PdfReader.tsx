import React, { useMemo, useRef } from 'react';
import { WebView } from 'react-native-webview';
import { pdfReaderHtml } from './pdfHtml';
import type { PdfItem } from './statement';

export interface PdfResult {
  items?: PdfItem[];
  /** password: file is locked; badpassword: wrong password; error: unreadable. */
  error?: 'password' | 'badpassword' | 'error' | 'unsupported';
  message?: string;
}

/** Invisible PDF text extractor. Mount it with a file; it reports once via onDone. Remount (new key) to retry. */
export function PdfReader({ base64, password, onDone }: { base64: string; password?: string; onDone: (r: PdfResult) => void }) {
  const ref = useRef<WebView>(null);
  const html = useMemo(() => pdfReaderHtml(), []);
  return (
    <WebView
      ref={ref}
      source={{ html }}
      originWhitelist={['*']}
      javaScriptEnabled
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
      onMessage={(e) => {
        let msg: { type: string; items?: PdfItem[]; code?: PdfResult['error']; message?: string };
        try {
          msg = JSON.parse(e.nativeEvent.data);
        } catch {
          return;
        }
        if (msg.type === 'ready') ref.current?.injectJavaScript(`window.__load(${JSON.stringify(base64)}, ${JSON.stringify(password ?? '')}); true;`);
        else if (msg.type === 'items') onDone({ items: msg.items ?? [] });
        else if (msg.type === 'error') onDone({ error: msg.code ?? 'error', message: msg.message });
      }}
      onError={(e) => onDone({ error: 'error', message: e.nativeEvent.description })}
    />
  );
}
