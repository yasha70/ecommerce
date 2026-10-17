# Order Tools — blouse business dashboard

Open `index.html` in a browser (needs internet for the CSV / Excel libraries).

- **Size Summary** — SKU × size counts from an orders CSV or picklist.
- **Profit & Returns** — delivered profit and customer-return rate per SKU.
- **GST TDS / TCS** — taxable amount behind the TDS / TCS credits on the GST portal, matched
  month by month with marketplace TCS reports.
- **Return Filing** — GSTR-1 (Table 7 B2CS, Table 12 HSN, Table 14) and GSTR-3B (3.1, 3.2, tax
  payment after ITC and TCS credit) figures for a month from the same reports, due dates for
  monthly and QRMP filers, late fee and interest. Click any amount to copy it.

`gst-extension/` is a Chrome extension that shows the TDS / TCS calculation live on the GST
portal's TDS and TCS Credit Received page, adds up several pages and months, and packages this
dashboard for matching — see `gst-extension/README.md`.
