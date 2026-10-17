# Order Tools — blouse business dashboard

Open `index.html` in a browser (needs internet for the CSV / Excel libraries).

- **Size Summary** — SKU × size counts from an orders CSV or picklist.
- **Profit & Returns** — delivered profit and customer-return rate per SKU.
- **GST TDS / TCS** — taxable amount behind the TDS / TCS credits on the GST portal, matched
  month by month with marketplace TCS reports.

`gst-extension/` packages the same dashboard as a Chrome extension that reads the TDS and TCS
Credit Received table straight off the GST portal — see `gst-extension/README.md`.
