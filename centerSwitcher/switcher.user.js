// ==UserScript==
// @name         GVCW Center Switcher (ISB / LHR)
// @namespace    gvcw-center-switcher
// @version      2.1.0
// @description  Ek click par apna appointment center Islamabad (ISB=137) ya Lahore (LHR=138) badlo. Profile browser storage se khud-ba-khud milti hai — Manage Account kholne ki zaroorat nahi. Draggable panel, no page reload.
// @match        https://pk-gr-services.gvcworld.eu/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict'

  // ====== CONFIG ============================================================
  const USER_API = '/api/v1/user'      // PUT updated profile yahan jata hai
  const CENTERS = {
    ISB: { id: '137', label: 'Islamabad (ISB)' },
    LHR: { id: '138', label: 'Lahore (LHR)' },
  }
  const CACHE_KEY = 'gvcw_profile_cache'
  const POS_KEY = 'gvcw_panel_pos'
  // ==========================================================================

  const log = (...a) => console.log('%c[Center]', 'color:#0ea5e9;font-weight:bold', ...a)

  // ---- profile --------------------------------------------------------------
  let profile = null
  try { profile = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') } catch {}

  function looksLikeProfile(o) {
    return o && typeof o === 'object' && !Array.isArray(o) && o.id != null &&
      ('firstname' in o || 'lastname' in o || 'vac' in o)
  }
  // stricter: storage me galat object na uthaye — asli profile me id + naam + (vac|email|number)
  function isFullProfile(o) {
    return looksLikeProfile(o) && o.firstname &&
      (o.vac || o.email || o.phonenumber || o.phonenumberprefix)
  }
  function digProfile(j, strict) {
    if (!j || typeof j !== 'object') return null
    const test = strict ? isFullProfile : looksLikeProfile
    if (test(j)) return j
    const inner = j.returnobject || j.data || j.user || j.profile || j.currentUser
    if (test(inner)) return inner
    return null
  }
  function setProfile(p) {
    if (!p) return false
    profile = p
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)) } catch {}
    setCaptured(true)
    highlightCurrent()
    return true
  }

  // 1) browser storage se profile dhoondo (Manage Account ki zaroorat nahi)
  function scanStorage() {
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        let v
        try { v = store.getItem(store.key(i)) } catch { continue }
        if (!v || (v[0] !== '{' && v[0] !== '[')) continue
        try {
          const p = digProfile(JSON.parse(v), true)
          if (p) return p
        } catch {}
      }
    }
    return null
  }

  // 2) JWT se userId + POST /api/v1/user/{id} (Manage Account jaisa) se fresh profile
  function decodeJwt(t) {
    const parts = String(t).split('.')
    if (parts.length !== 3) return null
    try { return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) } catch { return null }
  }
  // current session ka auth token (Bearer) storage se dhoondo — taake request
  // MOJOODA logged-in account ke naam par jaye (chahe cache purani ho).
  const isJwt = (s) => typeof s === 'string' && s.split('.').length === 3 && !!decodeJwt(s)
  function getAuthToken() {
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        let v
        try { v = store.getItem(store.key(i)) } catch { continue }
        if (!v) continue
        if (isJwt(v)) return v
        if (v[0] === '{') {
          try {
            const o = JSON.parse(v)
            for (const f of ['access_token', 'accessToken', 'token', 'id_token', 'idToken', 'jwt', 'authToken']) {
              if (o && o[f] && isJwt(o[f])) return o[f]
            }
          } catch {}
        }
      }
    }
    return null
  }
  function tokenUserId(tok) {
    const j = decodeJwt(tok || getAuthToken())
    const id = j && (j.id || j.userId || j.userid || j.uid || j.sub)
    return id != null && /^\d+$/.test(String(id)) ? String(id) : null
  }
  function authHeaders() {
    const h = { 'content-type': 'application/json; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' }
    const t = getAuthToken()
    if (t) h['Authorization'] = 'Bearer ' + t
    return h
  }
  async function fetchById(id) {
    const attempts = [
      { m: 'POST', u: USER_API + '/' + id, body: '{}' },
      { m: 'POST', u: USER_API + '/' + id, body: undefined },
      { m: 'GET', u: USER_API + '/' + id, body: undefined },
    ]
    for (const a of attempts) {
      try {
        const res = await origFetch(a.u, { method: a.m, headers: authHeaders(), credentials: 'include', body: a.body })
        if (!res.ok) continue
        const j = await res.json()
        const p = digProfile(j, true)
        if (p) return p
      } catch {}
    }
    return null
  }

  // profile pakka karo — hamesha MOJOODA session se match karti profile do:
  //  purani cache agar doosre account ki ho to discard; storage/id-fetch se current lo.
  async function ensureProfile() {
    const tid = tokenUserId()                                  // current logged-in id
    if (profile && tid && String(profile.id) !== tid) profile = null   // cross-account cache -> hatao
    if (!profile) { const s = scanStorage(); if (s && (!tid || String(s.id) === tid)) setProfile(s) }
    if (!profile && tid) { const p = await fetchById(tid); if (p) setProfile(p) }
    if (!profile) { const s = scanStorage(); if (s) setProfile(s) }   // last resort (no token)
    return profile
  }

  // ---- hook fetch/XHR (always-on updater) ----------------------------------
  const origFetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/v1/user') && init && init.body) { const p = digProfile(safeJson(init.body)); if (p) setProfile(p) }
    const pr = origFetch.apply(this, arguments)
    if (url.includes('/api/v1/user')) {
      pr.then((res) => { try { res.clone().json().then((j) => { const p = digProfile(j); if (p) setProfile(p) }).catch(() => {}) } catch {} }).catch(() => {})
    }
    return pr
  }
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u || ''; return XO.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (String(this.__u).includes('/api/v1/user')) {
        if (body) { const p = digProfile(safeJson(body)); if (p) setProfile(p) }
        this.addEventListener('load', function () {
          try { const p = digProfile(safeJson(this.responseText)); if (p) setProfile(p) } catch {}
        })
      }
    } catch {}
    return XS.apply(this, arguments)
  }
  function safeJson(x) { try { return typeof x === 'string' ? JSON.parse(x) : x } catch { return null } }

  // ---- switch center --------------------------------------------------------
  let busy = false
  async function switchTo(key) {
    if (busy) return
    const target = CENTERS[key]
    if (!target) return
    busy = true
    toast('⏳ ' + target.label + ' set kar rahe…', '#f59e0b')
    try {
      await ensureProfile()
      if (!profile) {
        toast('⚠️ Profile nahi mili — ek dafa "Manage Account" kholo', '#f59e0b')
        return
      }
      // safety: jis account me logged-in ho usi ka profile PUT ho (warna PERMISSION)
      const tid = tokenUserId()
      if (tid && String(profile.id) !== tid) {
        toast('❌ Account badla hua — page refresh karke dobara try karo', '#ef4444')
        profile = null
        return
      }
      const currentVac = profile.vac && profile.vac.id != null ? String(profile.vac.id) : null
      const body = { ...profile, vac: { ...(profile.vac || {}), id: target.id } }  // sirf vac.id
      const res = await origFetch(USER_API, {
        method: 'PUT',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
      })
      let j = null
      try { j = await res.json() } catch {}
      const ok = res.ok && (!j || j.code === 'SUCCESS' || j.code == null)
      if (ok) {
        setProfile(body)
        markActive(key)
        toast('✅ Center → ' + target.label + (currentVac === target.id ? ' (already)' : ''), '#16a34a')
        log('switched to', target.label, j)
      } else {
        const msg = (j && (j.message || j.error)) || ('HTTP ' + res.status)
        toast('❌ ' + msg, '#ef4444')
        log('switch failed', res.status, j)
      }
    } catch (e) {
      toast('❌ ' + (e.message || e), '#ef4444')
      log('error', e)
    } finally {
      busy = false
    }
  }

  // ---- UI (draggable panel) -------------------------------------------------
  let panel = null, toastEl = null, capBadge = null
  const btns = {}
  function toast(text, color = '#0ea5e9') {
    if (!panel) return
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.style.cssText = 'margin-top:8px;font:600 12px system-ui,sans-serif;color:#fff;padding:6px 10px;border-radius:8px;text-align:center;transition:background .3s'
      panel.appendChild(toastEl)
    }
    toastEl.textContent = text
    toastEl.style.background = color
  }
  function setCaptured(ok) {
    if (capBadge) { capBadge.textContent = ok ? '● profile ready' : '○ finding profile…'; capBadge.style.color = ok ? '#22c55e' : '#f59e0b' }
  }
  function markActive(key) {
    for (const k of Object.keys(btns)) {
      const on = k === key
      btns[k].style.background = on ? '#16a34a' : '#334155'
      btns[k].style.outline = on ? '2px solid #4ade80' : 'none'
    }
  }
  function highlightCurrent() {
    if (!profile) return
    const cur = profile.vac && profile.vac.id != null ? String(profile.vac.id) : null
    for (const key of Object.keys(CENTERS)) if (CENTERS[key].id === cur) markActive(key)
  }
  function makeDraggable(handle) {
    handle.style.cursor = 'move'
    let drag = false, sx = 0, sy = 0, ox = 0, oy = 0
    handle.addEventListener('mousedown', (e) => {
      drag = true; sx = e.clientX; sy = e.clientY
      const r = panel.getBoundingClientRect(); ox = r.left; oy = r.top
      panel.style.right = 'auto'; e.preventDefault()
    })
    window.addEventListener('mousemove', (e) => {
      if (!drag) return
      panel.style.left = Math.max(0, ox + e.clientX - sx) + 'px'
      panel.style.top = Math.max(0, oy + e.clientY - sy) + 'px'
    })
    window.addEventListener('mouseup', () => {
      if (!drag) return
      drag = false
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: panel.style.left, top: panel.style.top })) } catch {}
    })
  }
  function buildPanel() {
    panel = document.createElement('div')
    panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;width:210px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:12px;font:13px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)'
    try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); if (p && p.left) { panel.style.left = p.left; panel.style.top = p.top; panel.style.right = 'auto' } } catch {}

    const title = document.createElement('div')
    title.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;user-select:none'
    title.innerHTML = '<b style="font-size:13px">⠿ 🏢 Center</b>'
    capBadge = document.createElement('span')
    capBadge.style.cssText = 'margin-left:auto;font-size:10px'
    title.appendChild(capBadge)
    panel.appendChild(title)

    for (const key of Object.keys(CENTERS)) {
      const b = document.createElement('button')
      b.textContent = CENTERS[key].label
      b.style.cssText = 'display:block;width:100%;margin:4px 0;padding:9px;border:0;border-radius:8px;background:#334155;color:#fff;font-weight:600;cursor:pointer'
      b.onclick = () => switchTo(key)
      panel.appendChild(b)
      btns[key] = b
    }
    document.body.appendChild(panel)
    makeDraggable(title)

    setCaptured(!!profile)
    highlightCurrent()
    // load par hi profile auto-dhoondo
    ensureProfile().then(() => { setCaptured(!!profile); highlightCurrent() })
  }

  if (document.body) buildPanel()
  else window.addEventListener('DOMContentLoaded', buildPanel)
  log('loaded on', location.host)
})()
