# GST TDS / TCS Calculator — Chrome extension

Calculates the taxable amount behind the TDS and TCS credits on the GST portal **right on the
page**: open **TDS and TCS Credit Received** and a panel shows the net taxable value, the credit,
the inter / intra-state split and the estimated GST payable within a second, and recalculates by
itself when you change the month or tab. It adds up every page and month you open (or reads all
pages of the table for you) under **All collected**. It can also match the figures with your marketplace TCS
reports (e.g. Meesho's GST report ZIP) in the full Order Tools calculator (`index.html`).

## Install (Chrome or Edge)

1. Download this repository (Code › Download ZIP) and unzip it.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and switch on **Developer mode**.
3. Click **Load unpacked** and choose the `gst-extension` folder.
4. Pin the ₹ icon to the toolbar.

## Use

1. Log in to the GST portal and open **Services › Returns › TDS and TCS Credit Received**.
2. Pick the financial year and month and open the **TCS** (or **TDS**) tab. A panel with the
   calculation appears at the bottom right of the page and updates whenever the table changes.
   Use **–** to shrink it to a one-line total, **×** to close it.
3. **Several pages or months:** every page of the table and every month you open is remembered.
   Switch the panel to **All collected** for the combined total (one line per operator and month).
   If the table is split into pages, **Read all pages** goes to page 1 and clicks through them for
   you (it only uses the table's own page buttons, never the portal's NEXT / PROCEED). The same
   credit seen twice — on another visit, or on another screen such as GSTR-2A — is counted once.
   **Clear** starts again from the page on screen; a collection untouched for 12 hours starts afresh.
4. **Copy results** puts the figures of the view you are on on the clipboard, ready to paste into
   Excel or Google Sheets.
5. **Match with reports** opens the full calculator with this page or everything collected; drop
   Meesho's GST report ZIP (or `tcs_sales.xlsx` / `tcs_sales_return.xlsx`) there and click
   **Calculate & match**.
6. Clicking the ₹ toolbar icon shows the same calculation for the current tab instantly — on the
   portal or any other page with the credit table — with the same **This page / All collected**
   views. Set your GST rate there (default 5%); the panel follows it. **Show live panel on the
   page** brings the panel back after closing it.

The month comes from the table's tax-period column, or else from the year and period picked on
the page when the table was shown. If neither can be read, rows say "No month" and their TCS rate
is not checked. The extension reads the GST portal pages and the tab where you click it, and sends
nothing anywhere — everything is calculated and stored inside your browser.

## Updating

`calculator.html`, `dashboard.js` and `gst-core.js` are generated from `../index.html` (extension
pages cannot run inline or CDN scripts, and the popup and panel reuse the GST page's calculation). After changing `index.html`, run:

```
node gst-extension/build.js
```

then press the reload button on the extension in `chrome://extensions`. Open GST portal tabs get
the updated panel straight away.

`vendor/` holds PapaParse 5.4.1 and SheetJS 0.18.5 (the latest SheetJS on npm). SheetJS 0.18.5
has known issues with deliberately malformed spreadsheets, so only open files from the GST
portal or your marketplace; to use the newer build, replace `vendor/xlsx.full.min.js` with
`xlsx.full.min.js` from https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/.
