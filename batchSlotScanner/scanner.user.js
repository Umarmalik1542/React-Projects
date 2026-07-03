// ==UserScript==
// @name         GVCW Batch Slot Scanner
// @namespace    gvcw-batch-scanner
// @version      1.0.0
// @description  Scan multiple dates at once via the periodslot/slots API and show all availability in one panel (read-only). Booking is Phase 2.
// @match        https://pk-gr-services.gvcworld.eu/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict'

  const SLOTS_API = '/api/v1/periodslot/slots'
  const TEMPLATE_KEY = 'gvcw_slot_template'
  const DELAY_MS = 500 // requests ke beech gap (WAF/block se bachne ke liye)

  // ---- Params template (captured from the site's own request) --------------
  let template = null
  try { template = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || 'null') } catch {}

  function saveTemplate(body) {
    try {
      const obj = typeof body === 'string' ? JSON.parse(body) : body
      if (obj && obj.vac && ('type' in obj)) {   // looks like a slots request body
        template = obj
        localStorage.setItem(TEMPLATE_KEY, JSON.stringify(obj))
        setCaptured(true)
      }
    } catch {}
  }

  // Hook fetch
  const origFetch = window.fetch
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      if (url.includes('periodslot/slots') && init && init.body) saveTemplate(init.body)
    } catch {}
    return origFetch.apply(this, arguments)
  }
  // Hook XHR (jQuery ajax uses this)
  const XO = XMLHttpRequest.prototype.open
  const XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return XO.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function (body) {
    try { if (this.__u && String(this.__u).includes('periodslot/slots') && body) saveTemplate(body) } catch {}
    return XS.apply(this, arguments)
  }

  // ---- Scan one date -------------------------------------------------------
  async function scanDate(date) {
    if (!template) return { date, status: 'no-template' }
    try {
      const body = { ...template, datefrom: date }
      const res = await fetch(SLOTS_API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!res.ok) return { date, status: 'error', http: res.status }
      const j = await res.json()
      const slots = (j.returnobject && j.returnobject.slots) || []
      const available = slots
        .filter((s) => s.isavailable && s.isselectable && s.id != null)
        .map((s) => ({ id: s.id, time: s.starttime }))
      if (slots.length === 0) return { date, status: 'closed', total: 0, available: [] }
      if (available.length === 0) return { date, status: 'booked', total: slots.length, available: [] }
      return { date, status: 'open', total: slots.length, available }
    } catch (e) {
      return { date, status: 'error', error: String(e.message || e) }
    }
  }

  // Sequential with a small gap (gentle on the WAF); render together at the end.
  async function scanAll(dates, onProgress) {
    const results = []
    for (let k = 0; k < dates.length; k++) {
      results.push(await scanDate(dates[k]))
      if (onProgress) onProgress(k + 1, dates.length)
      if (k < dates.length - 1) await new Promise((r) => setTimeout(r, DELAY_MS))
    }
    return results
  }

  // ---- Date helpers --------------------------------------------------------
  const pad = (n) => String(n).padStart(2, '0')
  function parseDates(text) {
    return [...new Set(
      String(text).split(/[\s,]+/).map((s) => s.trim())
        .filter((s) => /^\d{2}\/\d{2}\/\d{4}$/.test(s))
    )]
  }
  function rangeDates(fromD, toD, month, year) {
    const out = []
    for (let d = fromD; d <= toD; d++) out.push(`${pad(d)}/${pad(month)}/${year}`)
    return out
  }

  // ---- UI ------------------------------------------------------------------
  let panel, capBadge, resultsEl, autoTimer = null

  function setCaptured(ok) {
    if (capBadge) {
      capBadge.textContent = ok ? '● params captured' : '○ params NOT captured — ek normal search karein'
      capBadge.style.color = ok ? '#22c55e' : '#f59e0b'
    }
  }

  function statusCell(r) {
    if (r.status === 'open')
      return `<span style="color:#22c55e;font-weight:600">🟢 AVAILABLE (${r.available.length})</span>` +
        `<div style="color:#86efac;font-size:12px;margin-top:2px">${r.available.map((a) => a.time).join(', ')}</div>`
    if (r.status === 'booked') return `<span style="color:#ef4444">🔴 booked (${r.total})</span>`
    if (r.status === 'closed') return `<span style="color:#94a3b8">⚪ not open</span>`
    if (r.status === 'no-template') return `<span style="color:#f59e0b">params nahi — ek normal search karein</span>`
    return `<span style="color:#f59e0b">error ${r.http || ''} ${r.error || ''}</span>`
  }

  function render(results) {
    const openCount = results.filter((r) => r.status === 'open').length
    const rows = results
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #334155">${r.date}</td>` +
        `<td style="padding:6px 8px;border-bottom:1px solid #334155">${statusCell(r)}</td></tr>`).join('')
    resultsEl.innerHTML =
      `<div style="margin:6px 0;color:#e2e8f0">${openCount} date(s) available · ${results.length} scanned · ${new Date().toLocaleTimeString()}</div>` +
      `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr>` +
      `<th style="text-align:left;padding:6px 8px;color:#94a3b8">Date</th>` +
      `<th style="text-align:left;padding:6px 8px;color:#94a3b8">Status</th></tr>${rows}</table>`
  }

  async function doScan(datesText) {
    const dates = parseDates(datesText)
    if (!dates.length) { resultsEl.innerHTML = '<div style="color:#f59e0b">Koi valid date nahi (format: dd/mm/yyyy)</div>'; return }
    if (!template) { resultsEl.innerHTML = '<div style="color:#f59e0b">Params capture nahi — pehle site par ek normal date search karein, phir Scan.</div>'; return }
    resultsEl.innerHTML = '<div style="color:#94a3b8">Scanning 0/' + dates.length + '…</div>'
    const results = await scanAll(dates, (done, total) => {
      resultsEl.innerHTML = '<div style="color:#94a3b8">Scanning ' + done + '/' + total + '…</div>'
    })
    render(results)
  }

  function buildPanel() {
    panel = document.createElement('div')
    panel.style.cssText =
      'position:fixed;top:12px;right:12px;z-index:2147483647;width:340px;max-width:92vw;' +
      'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:12px;' +
      'font:13px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)'
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <b style="font-size:14px">📅 Batch Slot Scanner</b>
        <span id="bss-cap" style="margin-left:auto;font-size:11px"></span>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">
        <input id="bss-from" type="number" placeholder="from" style="width:52px" />
        <input id="bss-to" type="number" placeholder="to" style="width:52px" />
        <input id="bss-mon" type="number" placeholder="mm" style="width:44px" />
        <input id="bss-year" type="number" placeholder="yyyy" style="width:64px" />
        <button id="bss-fill" style="cursor:pointer">Fill range</button>
      </div>
      <textarea id="bss-dates" rows="3" placeholder="04/07/2026, 06/07/2026, 08/07/2026"
        style="width:100%;box-sizing:border-box;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px"></textarea>
      <div style="display:flex;align-items:center;gap:10px;margin:8px 0">
        <button id="bss-scan" style="flex:1;padding:8px;background:#6366f1;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer">Scan</button>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px"><input id="bss-auto" type="checkbox"> auto 30s</label>
      </div>
      <div id="bss-results"></div>
    `
    document.body.appendChild(panel)
    capBadge = panel.querySelector('#bss-cap')
    resultsEl = panel.querySelector('#bss-results')
    setCaptured(!!template)

    // inputs styling
    panel.querySelectorAll('input[type=number]').forEach((el) => {
      el.style.cssText += ';background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:5px'
    })
    panel.querySelector('#bss-fill').style.cssText += ';background:#334155;color:#e2e8f0;border:0;border-radius:6px;padding:5px 8px'

    panel.querySelector('#bss-fill').onclick = () => {
      const f = +panel.querySelector('#bss-from').value
      const t = +panel.querySelector('#bss-to').value
      const m = +panel.querySelector('#bss-mon').value
      const y = +panel.querySelector('#bss-year').value
      if (f && t && m && y && t >= f) panel.querySelector('#bss-dates').value = rangeDates(f, t, m, y).join(', ')
    }
    panel.querySelector('#bss-scan').onclick = () => doScan(panel.querySelector('#bss-dates').value)
    panel.querySelector('#bss-auto').onchange = (e) => {
      clearInterval(autoTimer); autoTimer = null
      if (e.target.checked) autoTimer = setInterval(() => doScan(panel.querySelector('#bss-dates').value), 30000)
    }
  }

  if (document.body) buildPanel()
  else window.addEventListener('DOMContentLoaded', buildPanel)
})()
