// ==UserScript==
// @name         GVCW Batch Slot Scanner
// @namespace    gvcw-batch-scanner
// @version      2.0.0
// @description  Scan multiple dates via periodslot/slots at a rate-limit-safe pace (auto backoff on 429) and show all availability together. Read-only (Phase 1).
// @match        https://pk-gr-services.gvcworld.eu/*
// @match        https://in-gr-services.gvcworld.eu/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict'
  const SLOTS_API = '/api/v1/periodslot/slots'
  const TEMPLATE_KEY = 'gvcw_slot_template'
  const COOLDOWN_MS = 45000      // 429 aaye to itna wait
  const MAX_429_RETRY = 3        // ek date par itni dafa dobara

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  let template = null
  try { template = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || 'null') } catch {}
  function saveTemplate(body) {
    try {
      const o = typeof body === 'string' ? JSON.parse(body) : body
      if (o && o.vac && ('type' in o) && !Array.isArray(o.datefrom)) {
        template = o; localStorage.setItem(TEMPLATE_KEY, JSON.stringify(o)); setCaptured(true)
      }
    } catch {}
  }
  const origFetch = window.fetch
  window.fetch = function (input, init) {
    try { const u = typeof input === 'string' ? input : (input && input.url) || ''; if (u.includes('periodslot/slots') && init && init.body) saveTemplate(init.body) } catch {}
    return origFetch.apply(this, arguments)
  }
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return XO.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function (body) {
    try { if (this.__u && String(this.__u).includes('periodslot/slots') && body) saveTemplate(body) } catch {}
    return XS.apply(this, arguments)
  }

  async function scanDate(date) {
    if (!template) return { date, status: 'no-template' }
    try {
      const body = { ...template, datefrom: date }
      const res = await origFetch(SLOTS_API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' },
        credentials: 'include', body: JSON.stringify(body),
      })
      if (res.status === 429) return { date, status: 'rate', http: 429 }
      if (!res.ok) return { date, status: 'error', http: res.status }
      const j = await res.json()
      const slots = (j.returnobject && j.returnobject.slots) || []
      const available = slots.filter((s) => s.isavailable && s.isselectable && s.id != null).map((s) => ({ id: s.id, time: s.starttime }))
      if (slots.length === 0) return { date, status: 'closed', total: 0, available: [] }
      if (available.length === 0) return { date, status: 'booked', total: slots.length, available: [] }
      return { date, status: 'open', total: slots.length, available }
    } catch (e) {
      return { date, status: 'error', error: String(e.message || e) }
    }
  }

  // Sequential with a user gap; on 429, pause (cooldown) and retry, widening the gap.
  let stopFlag = false
  async function scanAll(dates, gap, onProgress) {
    const results = []
    let curGap = gap
    for (let k = 0; k < dates.length; k++) {
      if (stopFlag) break
      let r = await scanDate(dates[k])
      let tries = 0
      while (r.status === 'rate' && tries < MAX_429_RETRY && !stopFlag) {
        tries++
        curGap = Math.min(curGap * 2, 20000)
        for (let s = COOLDOWN_MS / 1000; s > 0 && !stopFlag; s--) {
          onProgress(k, dates.length, `⏳ rate-limited — waiting ${s}s (gap→${curGap}ms)`) ; await sleep(1000)
        }
        r = await scanDate(dates[k])
      }
      results.push(r)
      onProgress(k + 1, dates.length, '')
      if (k < dates.length - 1 && !stopFlag) await sleep(curGap)
    }
    return results
  }

  const pad = (n) => String(n).padStart(2, '0')
  const parseDates = (t) => [...new Set(String(t).split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^\d{2}\/\d{2}\/\d{4}$/.test(s)))]
  const rangeDates = (f, t, m, y) => { const o = []; for (let d = f; d <= t; d++) o.push(`${pad(d)}/${pad(m)}/${y}`); return o }

  let panel, capBadge, resultsEl, autoTimer = null
  function setCaptured(ok) { if (capBadge) { capBadge.textContent = ok ? '● params captured' : '○ params NOT captured'; capBadge.style.color = ok ? '#22c55e' : '#f59e0b' } }
  function statusCell(r) {
    if (r.status === 'open') return `<span style="color:#22c55e;font-weight:600">🟢 AVAILABLE (${r.available.length})</span><div style="color:#86efac;font-size:12px;margin-top:2px">${r.available.map((a) => a.time).join(', ')}</div>`
    if (r.status === 'booked') return `<span style="color:#ef4444">🔴 booked (${r.total})</span>`
    if (r.status === 'closed') return `<span style="color:#94a3b8">⚪ not open</span>`
    if (r.status === 'rate') return `<span style="color:#f97316">⛔ 429 (rate limit)</span>`
    if (r.status === 'no-template') return `<span style="color:#f59e0b">params nahi</span>`
    return `<span style="color:#f59e0b">error ${r.http || ''} ${r.error || ''}</span>`
  }
  function render(results) {
    const open = results.filter((r) => r.status === 'open').length
    const rows = results.slice().sort((a, b) => a.date.localeCompare(b.date)).map((r) =>
      `<tr><td style="padding:6px 8px;border-bottom:1px solid #334155">${r.date}</td><td style="padding:6px 8px;border-bottom:1px solid #334155">${statusCell(r)}</td></tr>`).join('')
    resultsEl.innerHTML = `<div style="margin:6px 0;color:#e2e8f0">${open} available · ${results.length} scanned · ${new Date().toLocaleTimeString()}</div>` +
      `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr><th style="text-align:left;padding:6px 8px;color:#94a3b8">Date</th><th style="text-align:left;padding:6px 8px;color:#94a3b8">Status</th></tr>${rows}</table>`
  }
  async function doScan(text, gap) {
    const dates = parseDates(text)
    if (!dates.length) { resultsEl.innerHTML = '<div style="color:#f59e0b">Koi valid date nahi (dd/mm/yyyy)</div>'; return }
    if (!template) { resultsEl.innerHTML = '<div style="color:#f59e0b">Params capture nahi — pehle ek normal search karein.</div>'; return }
    stopFlag = false
    const results = await scanAll(dates, gap, (done, total, msg) => {
      resultsEl.innerHTML = `<div style="color:#94a3b8">Scanning ${done}/${total}… ${msg || ''}</div>`
    })
    render(results)
  }

  function buildPanel() {
    panel = document.createElement('div')
    panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:350px;max-width:92vw;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:12px;font:13px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)'
    panel.innerHTML =
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><b style="font-size:14px">📅 Batch Slot Scanner</b><span id="bss-cap" style="margin-left:auto;font-size:11px"></span></div>` +
      `<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap"><input id="bss-from" type="number" placeholder="from" style="width:48px"/><input id="bss-to" type="number" placeholder="to" style="width:48px"/><input id="bss-mon" type="number" placeholder="mm" style="width:42px"/><input id="bss-year" type="number" placeholder="yyyy" style="width:60px"/><button id="bss-fill">Fill</button></div>` +
      `<textarea id="bss-dates" rows="3" placeholder="04/07/2026, 06/07/2026" style="width:100%;box-sizing:border-box;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px"></textarea>` +
      `<div style="display:flex;align-items:center;gap:8px;margin:8px 0"><button id="bss-scan" style="flex:1;padding:8px;background:#6366f1;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer">Scan</button>` +
      `<button id="bss-stop" style="padding:8px 10px;background:#7f1d1d;color:#fff;border:0;border-radius:8px;cursor:pointer">Stop</button>` +
      `<label style="font-size:12px">gap<input id="bss-gap" type="number" value="3000" style="width:56px;margin-left:4px"/></label></div>` +
      `<label style="font-size:12px;display:flex;align-items:center;gap:4px;margin-bottom:6px"><input id="bss-auto" type="checkbox"> auto every <input id="bss-int" type="number" value="120" style="width:48px"/> s</label>` +
      `<div id="bss-results"></div>`
    document.body.appendChild(panel)
    capBadge = panel.querySelector('#bss-cap'); resultsEl = panel.querySelector('#bss-results'); setCaptured(!!template)
    panel.querySelectorAll('input[type=number]').forEach((el) => { el.style.cssText += ';background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:4px' })
    panel.querySelector('#bss-fill').style.cssText += ';background:#334155;color:#e2e8f0;border:0;border-radius:6px;padding:5px 8px;cursor:pointer'
    const dt = () => panel.querySelector('#bss-dates').value
    const gap = () => Math.max(500, +panel.querySelector('#bss-gap').value || 3000)
    panel.querySelector('#bss-fill').onclick = () => { const f = +panel.querySelector('#bss-from').value, t = +panel.querySelector('#bss-to').value, m = +panel.querySelector('#bss-mon').value, y = +panel.querySelector('#bss-year').value; if (f && t && m && y && t >= f) panel.querySelector('#bss-dates').value = rangeDates(f, t, m, y).join(', ') }
    panel.querySelector('#bss-scan').onclick = () => doScan(dt(), gap())
    panel.querySelector('#bss-stop').onclick = () => { stopFlag = true }
    panel.querySelector('#bss-auto').onchange = (e) => {
      clearInterval(autoTimer); autoTimer = null
      if (e.target.checked) { const sec = Math.max(60, +panel.querySelector('#bss-int').value || 120); autoTimer = setInterval(() => doScan(dt(), gap()), sec * 1000) }
    }
  }
  if (document.body) buildPanel(); else window.addEventListener('DOMContentLoaded', buildPanel)
})()
