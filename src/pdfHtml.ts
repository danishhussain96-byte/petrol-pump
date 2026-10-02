// HTML page run inside a hidden WebView: PDF.js extracts positioned text from a PDF
// and posts it back as PdfItem[]. Both PDF.js parts are inlined, so it works offline;
// with the worker loaded as a plain script PDF.js runs on the page's own thread.
import { PDFJS_LIB, PDFJS_WORKER } from './generated/pdfjs';

let cached: string | null = null;

export function pdfReaderHtml(): string {
  if (cached) return cached;
  cached = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${PDFJS_WORKER}</script>
<script>${PDFJS_LIB}</script>
<script>
function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
window.__load = async function (b64, password) {
  try {
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var doc = await pdfjsLib.getDocument({ data: bytes, password: password || undefined, isEvalSupported: false, disableFontFace: true }).promise;
    var items = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      for (var k = 0; k < tc.items.length; k++) {
        var it = tc.items[k];
        if (it.str && it.str.trim()) items.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, p: p });
      }
    }
    post({ type: 'items', items: items, pages: doc.numPages });
  } catch (e) {
    var code = e && e.name === 'PasswordException' ? (e.code === 2 ? 'badpassword' : 'password') : 'error';
    post({ type: 'error', code: code, message: String((e && e.message) || e) });
  }
};
post({ type: 'ready' });
</script></body></html>`;
  return cached;
}
