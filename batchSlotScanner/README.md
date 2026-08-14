# GVCW Batch Slot Scanner

Scan multiple appointment dates at once and see all availability in one panel.

- Reuses the site's own `PUT /api/v1/periodslot/slots` API.
- Captures the request params (type/vac/members…) automatically from a normal
  search on the page — no hardcoding.
- Fires all dates in parallel (small concurrency) and renders the combined
  result together (no trickle).
- **Phase 1 = read-only** (scanner). Booking is Phase 2.

## Install
Tampermonkey → new script → paste `scanner.user.js` → save. Open the
appointment page.

## Use
1. Do **one normal date search** on the page once (so params get captured —
   the panel shows "params captured").
2. In the panel (top-right): enter dates (`dd/mm/yyyy`, comma separated) or use
   "Fill range" (from/to day + month + year).
3. **Scan** → each date shows: 🟢 available (with times) / 🔴 booked / ⚪ not open.
4. Optional: "auto 30s" to re-scan automatically.

## Status meaning
- `slots: []` → not open
- slots all `isavailable:false` → booked (red)
- slot `isavailable:true && isselectable:true && id` → available
