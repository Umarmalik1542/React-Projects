// ==UserScript==
// @name         GVCW Error Watcher
// @namespace    gvcw-error-watcher
// @version      1.0.0
// @description  Network aur console ke errors (403, 429, 500, JS errors, console.error/warn) ek chhote draggable box me live dikhata hai. Sirf monitoring — kuch change nahi karta.
// @match        https://pk-gr-services.gvcworld.eu/*
// @match        https://in-gr-services.gvcworld.eu/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict'

  // ====== CONFIG ============================================================
  const MAX_ROWS = 60          // box me itni recent entries rakho
  const POS_KEY = 'gvcw_ew_pos'
  const MIN_KEY = 'gvcw_ew_min'
  // ==========================================================================

  // ---- color per type/status -----------------------------------------------
  function colorFor(kind, status) {
    if (status === 429) return '#f97316'                       // rate limit -> orange
    if (status === 403) return '#ef4444'                       // blocked   -> red
    if (status && status >= 500) return '#ef4444'              // server err
    if (status && status >= 400) return '#eab308'              // client err
    if (kind === 'js' || kind === 'error') return '#ef4444'
    if (kind === 'warn') return '#eab308'
    if (kind === 'reject') return '#f97316'
    return '#94a3b8'
  }

  const rows = []             // {t, kind, status, method, url, msg}
  let listEl = null, countEl = null

  function short(u) {
    try { const x = new URL(u, location.href); return x.pathname + (x.search ? x.search.slice(0, 40) : '') }
    catch { return String(u || '').slice(0, 80) }
  }
  function add(entry) {
    entry.t = new Date()
    rows.unshift(entry)
    if (rows.length > MAX_ROWS) rows.length = MAX_ROWS
    render()
  }
  function render() {
    if (!listEl) return
    if (countEl) countEl.textContent = rows.length ? String(rows.length) : ''
    listEl.innerHTML = rows.map((r) => {
      const c = colorFor(r.kind, r.status)
      const time = r.t.toTimeString().slice(0, 8)
      const tag = r.status ? r.status : r.kind.toUpperCase()
      const head = r.method ? `${r.method} ${short(r.url)}` : (r.msg || '')
      const sub = r.method && r.msg ? `<div style="color:#94a3b8;font-size:11px;margin-top:1px">${esc(r.msg)}</div>` : ''
      return `<div style="padding:6px 8px;border-bottom:1px solid #1e293b">` +
        `<div style="display:flex;gap:6px;align-items:baseline">` +
        `<span style="color:#64748b;font-size:10px;min-width:52px">${time}</span>` +
        `<span style="background:${c};color:#0b1220;font-weight:700;font-size:10px;padding:1px 5px;border-radius:5px">${tag}</span>` +
        `<span style="color:#e2e8f0;word-break:break-all">${esc(head)}</span></div>${sub}</div>`
    }).join('') || `<div style="padding:14px;color:#64748b;text-align:center">Abhi koi error nahi ✅</div>`
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }

  // ---- hook fetch -----------------------------------------------------------
  const origFetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
    let pr
    try { pr = origFetch.apply(this, arguments) } catch (e) { add({ kind: 'js', msg: 'fetch threw: ' + (e.message || e), method, url }); throw e }
    pr.then((res) => {
      if (res && res.status >= 400) add({ kind: 'net', status: res.status, method, url, msg: res.statusText || '' })
    }).catch((e) => {
      add({ kind: 'net', method, url, msg: 'network fail: ' + (e && (e.message || e)) })
    })
    return pr
  }

  // ---- hook XHR -------------------------------------------------------------
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = (m || 'GET').toUpperCase(); this.__u = u || ''; return XO.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function () {
    const self = this
    this.addEventListener('load', function () {
      if (self.status >= 400) add({ kind: 'net', status: self.status, method: self.__m, url: self.__u, msg: self.statusText || '' })
    })
    this.addEventListener('error', function () { add({ kind: 'net', method: self.__m, url: self.__u, msg: 'network error' }) })
    this.addEventListener('timeout', function () { add({ kind: 'net', method: self.__m, url: self.__u, msg: 'timeout' }) })
    return XS.apply(this, arguments)
  }

  // ---- hook console.error / warn -------------------------------------------
  const oErr = console.error, oWarn = console.warn
  console.error = function () { try { add({ kind: 'error', msg: fmt(arguments) }) } catch {} return oErr.apply(this, arguments) }
  console.warn = function () { try { add({ kind: 'warn', msg: fmt(arguments) }) } catch {} return oWarn.apply(this, arguments) }
  function fmt(args) { return Array.from(args).map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a) } catch { return String(a) } }).join(' ').slice(0, 300) }

  // ---- window errors --------------------------------------------------------
  window.addEventListener('error', (e) => {
    add({ kind: 'js', msg: (e.message || 'Script error') + (e.filename ? ' @ ' + short(e.filename) + ':' + e.lineno : '') })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    add({ kind: 'reject', msg: 'Unhandled: ' + (r && (r.message || r.stack || r) || 'promise rejected') })
  })

  // ---- UI (draggable box) ---------------------------------------------------
  let box = null
  function build() {
    box = document.createElement('div')
    box.style.cssText = 'position:fixed;bottom:14px;left:14px;z-index:2147483647;width:340px;max-width:92vw;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:12px;font:12px system-ui,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.5);overflow:hidden'
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (p && p.left) { box.style.left = p.left; box.style.top = p.top; box.style.bottom = 'auto' } } catch {}

    const head = document.createElement('div')
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:#111c31;user-select:none;cursor:move'
    head.innerHTML = '<b style="font-size:12px">⠿ 🐞 Error Watcher</b>'
    const cnt = document.createElement('span')
    cnt.style.cssText = 'background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:0 6px;border-radius:9px;min-width:14px;text-align:center'
    countEl = cnt
    const spacer = document.createElement('span'); spacer.style.flex = '1'
    const clearBtn = mkBtn('clear', () => { rows.length = 0; render() })
    const minBtn = mkBtn('–', toggleMin)
    head.appendChild(cnt); head.appendChild(spacer); head.appendChild(clearBtn); head.appendChild(minBtn)

    const body = document.createElement('div')
    body.style.cssText = 'max-height:300px;overflow:auto'
    listEl = document.createElement('div'); body.appendChild(listEl)
    box.__body = body

    box.appendChild(head); box.appendChild(body)
    document.body.appendChild(box)
    render()
    makeDraggable(head)
    if (localStorage.getItem(MIN_KEY) === '1') toggleMin(true)
  }
  function mkBtn(txt, fn) {
    const b = document.createElement('button')
    b.textContent = txt
    b.style.cssText = 'background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:6px;font-size:11px;padding:2px 8px;cursor:pointer'
    b.onclick = (e) => { e.stopPropagation(); fn() }
    return b
  }
  let minimized = false
  function toggleMin(force) {
    minimized = typeof force === 'boolean' ? force : !minimized
    if (box && box.__body) box.__body.style.display = minimized ? 'none' : 'block'
    try { localStorage.setItem(MIN_KEY, minimized ? '1' : '0') } catch {}
  }
  function makeDraggable(handle) {
    let drag = false, sx = 0, sy = 0, ox = 0, oy = 0
    handle.addEventListener('mousedown', (e) => {
      drag = true; sx = e.clientX; sy = e.clientY
      const r = box.getBoundingClientRect(); ox = r.left; oy = r.top
      box.style.bottom = 'auto'; e.preventDefault()
    })
    window.addEventListener('mousemove', (e) => {
      if (!drag) return
      box.style.left = Math.max(0, ox + e.clientX - sx) + 'px'
      box.style.top = Math.max(0, oy + e.clientY - sy) + 'px'
    })
    window.addEventListener('mouseup', () => {
      if (!drag) return
      drag = false
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: box.style.left, top: box.style.top })) } catch {}
    })
  }

  if (document.body) build()
  else window.addEventListener('DOMContentLoaded', build)
})()
