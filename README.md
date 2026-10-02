# Petrol Pump Manager

A mobile app for **Android (APK)** and **iPhone** to run a petrol pump's daily books:
daily sales, stock, salesman sales and settlements, cash calculation, and bank statements.
It is built with Expo (React Native), so one codebase runs on both platforms. All data is
stored on the phone, and the app works without internet.

## Features

| Area | What it does |
|---|---|
| **Dispenser page** | Daily screen has one page per dispenser, like the sale sheet: its 4 nozzles (tap Petrol / Diesel / Power per nozzle), opening / closing / test, sale per product (litres × rate), money received as **Cash, Online / UPI, POS and Credit**, short / excess, credit entries (per nozzle) and cash still to deposit. Everything else is under **🏪 Station** |
| **Credit customers** | Own tab. Add customers (also quickly while entering credit) with mobile, vehicles, **credit days** and limit. After each credit sale the app **sends an SMS automatically** on Android (from the phone's SIM, after allowing SMS permission once; iPhone opens the SMS app instead) with: today's credit, total due, cheque in clearing, balance to pay, days used and days left. **Cheques** stay "in clearing" and reduce the balance only when you mark them cleared (or bounced). Day-by-day account |
| **Dispensers & nozzles** | Starts with 3 dispensing units × 4 nozzles (2 petrol + 2 diesel each), all editable. Each dispenser has its **own bank account** for its cash, and card (POS) / digital accounts (default: the same bank) |
| **Dispenser cash → bank** | Cash from salesmen is split by their sales on each dispenser. Each dispenser shows collected, deposited and **still to deposit** (carried day to day), with one-tap deposit. Depositing one dispenser's cash into another's bank is marked as a **cross deposit**; **transfers** between your own accounts post to both banks |
| **Meter readings** | Grouped by dispenser. Opening and closing reading for each nozzle (opening carries forward from the previous day), test/return litres, one salesman for a whole dispenser or per nozzle, and per-day rate overrides |
| **Salesman sales** | Litres and amount per salesman, minus credit, card (POS) and digital sales (entered per bank account of the dispensers they worked), gives **cash due**. Enter the cash received and the app shows **Short / Excess** |
| **Lube / items** | Counter sales of engine oil, filters and other items, tracked per salesman |
| **Stock** | Opening + received − sold = book stock. Enter a dip or physical count to see the **gain / loss**, with low-stock alerts |
| **Tankers / purchases** | Enter each tanker's litres (invoice and received by dip) and its **total amount**. The app works out the cost per litre, shows any shortage, and keeps a **running average cost** so changing tanker prices are handled automatically. Paid by cash, bank or on credit |
| **Credit (udhaar)** | Credit sales per customer and vehicle, recoveries in cash or bank, customer ledgers with credit limits |
| **Expenses / income** | Expense heads paid from cash or bank, plus other cash income |
| **Bank** | Cash deposits, withdrawals, transfers, cheques and charges. Card/digital sales, bank recoveries, bank expenses and bank-paid purchases post **automatically** |
| **Upload bank statement** | Upload the statement from your bank as **PDF** (including password-protected e-statements), **Excel** or **CSV**. The app reads every line, totals **deposits** and withdrawals, compares day by day with your entries, matches each line (same amount, ±3 days), and lets you add missing lines to the app in one tap. Scanned photos can't be read |
| **Bank statement** | Statement for any date range with running balance, totals, **reconciliation** against the real bank balance, and PDF export |
| **Cash calculation** | Opening + cash from salesmen + recoveries + income + withdrawals − expenses − cash purchases − deposits = **expected cash**. A denomination counter (5000…1) gives the counted cash and the difference |
| **Reports** | Daily and date-range reports: product-wise, salesman-wise, expenses by head, day-wise, and estimated profit (sale rate − average cost). Share or print as PDF (WhatsApp, email, printer) |
| **Other** | Lock / unlock a closed day, PIN lock for the app, JSON backup and restore |

## Getting the APK (Android)

Every push runs the GitHub Actions workflow **Build Android APK** (`.github/workflows/build-apk.yml`):

1. On GitHub, open **Actions → Build Android APK → latest run**.
2. Download the **PetrolPumpManager-apk** artifact (a zip containing `PetrolPumpManager.apk`).
3. Copy it to the phone, open it, and allow "Install unknown apps".

To publish a downloadable release, push a tag, e.g. `git tag v1.0.0 && git push origin v1.0.0`.
The APK is then attached to a GitHub Release.

> The workflow APK is signed with the debug key, so it installs fine but cannot go on the Play Store.
> For the Play Store, build with EAS: `npx eas-cli build -p android --profile production`.

## iPhone

Apple only lets you install apps through the App Store / TestFlight, or through a registered
developer device. Options:

* **Try it right away:** install **Expo Go** from the App Store, run `npx expo start` on a computer, and scan the QR code.
* **Install as a real app:** you need an Apple Developer account. Then run
  `npx eas-cli build -p ios --profile preview` (ad-hoc install) or
  `npx eas-cli build -p ios --profile production` followed by `npx eas-cli submit -p ios` (TestFlight / App Store).

## Development

```bash
npm install
npm start          # Expo dev server (scan with Expo Go)
npm run web        # run in a browser
npm test           # calculation tests
npm run typecheck
npm run build:apk  # local APK build (needs the Android SDK and JDK 17)
```

Code layout:

* `src/types.ts`: data model
* `src/calc.ts`: all calculations (sales, settlement, stock, cash, bank statement, ledgers, reports); tested in `__tests__/`
* `src/store.tsx`: state and on-device storage (AsyncStorage)
* `src/screens/`: Home, Daily entry, Reports, Ledgers, Setup
* `src/report.ts`: PDF / print report generation
* `modules/direct-sms`: small Android native module that sends SMS via `SmsManager` (SEND_SMS permission)
* `src/statement.ts`: bank statement reading (columns, dates, amounts, PDF text layout) and reconciliation; `src/statementFile.ts` (Excel / CSV) and `src/PdfReader.tsx` + `src/pdfHtml.ts` (PDF.js in a hidden WebView, embedded by `scripts/gen-pdfjs.js` on install)

## First-time setup in the app

1. **Setup → Products & rates**: sale rate and opening stock for each product (cost of opening stock is optional).
2. **Setup → Dispensers**: pick the bank account each dispenser's POS machine and wallet pay into.
3. **Setup → Nozzles**: check each nozzle's product and enter its current meter reading.
4. **Setup → Salesmen / Bank accounts / Customers**: add with opening balances.
5. **Setup → Settings**: station name, opening cash in hand, default card/digital bank (for dispensers without their own), and an optional PIN.
6. Each day, open **Daily** and fill Meters → Salesmen → Stock → Credit → Expenses → Bank → Cash, then lock the day from **Summary**.
