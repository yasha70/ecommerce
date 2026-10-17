# GST TDS / TCS Calculator — Chrome extension

Reads the **TDS and TCS Credit Received** table straight off the GST portal, works out the
taxable amount behind every credit, and matches it month by month with your marketplace TCS
reports (e.g. Meesho's GST report ZIP). It opens the same Order Tools dashboard as
`index.html`, on the GST TDS / TCS page.

## Install (Chrome or Edge)

1. Download this repository (Code › Download ZIP) and unzip it.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and switch on **Developer mode**.
3. Click **Load unpacked** and choose the `gst-extension` folder.
4. Pin the ₹ icon to the toolbar.

## Use

1. Log in to the GST portal and open **Services › Returns › TDS and TCS Credit Received**.
2. Pick the financial year and month, and open the **TCS** tab (or **TDS**).
3. Click the ₹ icon › **Capture table from this page**. The calculator opens with the table
   loaded; the month is taken from the page's dropdowns (you can change it next to the row).
4. Repeat for each month or tab you need — captures go into the calculator that is already open.
5. Optionally drop Meesho's GST report ZIP (or `tcs_sales.xlsx` / `tcs_sales_return.xlsx`)
   under **Marketplace TCS reports**, then click **Calculate & match**.

Only the table that is visible on screen is read, so if the portal splits the list into pages,
capture each page. The extension only runs on the tab where you click it and sends nothing
anywhere — everything is calculated inside your browser.

## Updating

`calculator.html` and `dashboard.js` are generated from `../index.html` (extension pages cannot
run inline or CDN scripts). After changing `index.html`, run:

```
node gst-extension/build.js
```

then press the reload button on the extension in `chrome://extensions`.

`vendor/` holds PapaParse 5.4.1 and SheetJS 0.18.5 (the latest SheetJS on npm). SheetJS 0.18.5
has known issues with deliberately malformed spreadsheets, so only open files from the GST
portal or your marketplace; to use the newer build, replace `vendor/xlsx.full.min.js` with
`xlsx.full.min.js` from https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/.
