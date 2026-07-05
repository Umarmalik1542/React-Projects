// ==UserScript==
// @name         GVCW Center Switcher (ISB / LHR)
// @namespace    gvcw-center-switcher
// @version      1.2.0
// @description  Ek click par apna appointment center Islamabad (ISB=137) ya Lahore (LHR=138) badlo. Profile site ke apne traffic se auto-capture hoti hai (Manage Account ek dafa kholo), phir sirf vac.id badal ke PUT ho jata hai. Manual Save ki zaroorat nahi.
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
  // ==========================================================================

  const log = (...a) => console.log('%c[Center]', 'color:#0ea5e9;font-weight:bold', ...a)

  // ---- captured profile -----------------------------------------------------
  // Site khud jab profile load/save karti hai (Manage Account), us request/response
  // se poori profile object pakad lete hain. Endpoint guess nahi karna padta.
  let profile = null
  try { profile = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') } catch {}

  function looksLikeProfile(o) {
    return o && typeof o === 'object' && o.id != null &&
      ('firstname' in o || 'lastname' in o || 'vac' in o) && !Array.isArray(o)
  }
  function digProfile(j) {
    if (!j || typeof j !== 'object') return null
    if (looksLikeProfile(j)) return j
    const inner = j.returnobject || j.data || j.user || j.profile
    if (looksLikeProfile(inner)) return inner
    return null
  }
  function capture(raw) {
    try {
      const j = typeof raw === 'string' ? JSON.parse(raw) : raw
      const p = digProfile(j)
      if (p) {
        profile = p
        localStorage.setItem(CACHE_KEY, JSON.stringify(p))
        setCaptured(true)
        log('profile captured (vac=' + (p.vac && p.vac.id) + ')')
      }
    } catch {}
  }

  // ---- hook fetch (request body + response body) ---------------------------
  const origFetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/v1/user') && init && init.body) capture(init.body)  // PUT/POST body
    const p = origFetch.apply(this, arguments)
    if (url.includes('/api/v1/user')) {
      p.then((res) => { try { res.clone().json().then(capture).catch(() => {}) } catch {} }).catch(() => {})
    }
    return p
  }

  // ---- hook XHR (request body + response) -----------------------------------
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u || ''; return XO.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (String(this.__u).includes('/api/v1/user')) {
        if (body) capture(body)
        this.addEventListener('load', function () {
          try { if (this.responseText) capture(this.responseText) } catch {}
        })
      }
    } catch {}
    return XS.apply(this, arguments)
  }

  // ---- switch center --------------------------------------------------------
  let busy = false
  async function switchTo(key) {
    if (busy) return
    const target = CENTERS[key]
    if (!target) return
    if (!profile) {
      toast('⚠️ Pehle "Manage Account" ek dafa kholo (profile capture hogi)', '#f59e0b')
      return
    }
    busy = true
    toast('⏳ ' + target.label + ' set kar rahe…', '#f59e0b')
    try {
      const currentVac = profile.vac && profile.vac.id != null ? String(profile.vac.id) : null
      // sirf vac.id badlo — baaqi profile jaisa capture hui waisi hi
      const body = { ...profile, vac: { ...(profile.vac || {}), id: target.id } }
      const res = await origFetch(USER_API, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest',
          accept: 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      let j = null
      try { j = await res.json() } catch {}
      const ok = res.ok && (!j || j.code === 'SUCCESS' || j.code == null)
      if (ok) {
        profile = body                                  // local cache update
        localStorage.setItem(CACHE_KEY, JSON.stringify(body))
        markActive(key)
        log('switched to', target.label, j)
        if (currentVac === target.id) {
          toast('✅ Center → ' + target.label + ' (already)', '#16a34a')
        } else {
          // site UI purana center dikhati hai jab tak reload na ho -> khud reload
          toast('✅ ' + target.label + ' — reloading…', '#16a34a')
          setTimeout(() => location.reload(), 900)
        }
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

  // ---- UI: panel with two buttons + toast ----------------------------------
  let panel = null, toastEl = null, capBadge = null
  const btns = {}
  function toast(text, color = '#0ea5e9') {
    if (!panel) return
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.style.cssText =
        'margin-top:8px;font:600 12px system-ui,sans-serif;color:#fff;padding:6px 10px;border-radius:8px;text-align:center;transition:background .3s'
      panel.appendChild(toastEl)
    }
    toastEl.textContent = text
    toastEl.style.background = color
  }
  function setCaptured(ok) {
    if (capBadge) { capBadge.textContent = ok ? '● profile ready' : '○ profile not captured'; capBadge.style.color = ok ? '#22c55e' : '#f59e0b' }
  }
  function markActive(key) {
    for (const k of Object.keys(btns)) {
      const on = k === key
      btns[k].style.background = on ? '#16a34a' : '#334155'
      btns[k].style.outline = on ? '2px solid #4ade80' : 'none'
    }
  }
  function buildPanel() {
    panel = document.createElement('div')
    panel.style.cssText =
      'position:fixed;top:12px;left:12px;z-index:2147483647;width:210px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:12px;font:13px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)'
    const title = document.createElement('div')
    title.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px'
    title.innerHTML = '<b style="font-size:13px">🏢 Appointment Center</b>'
    capBadge = document.createElement('span')
    capBadge.style.cssText = 'margin-left:auto;font-size:10px'
    title.appendChild(capBadge)
    panel.appendChild(title)

    for (const key of Object.keys(CENTERS)) {
      const b = document.createElement('button')
      b.textContent = CENTERS[key].label
      b.style.cssText =
        'display:block;width:100%;margin:4px 0;padding:9px;border:0;border-radius:8px;background:#334155;color:#fff;font-weight:600;cursor:pointer'
      b.onclick = () => switchTo(key)
      panel.appendChild(b)
      btns[key] = b
    }
    document.body.appendChild(panel)
    setCaptured(!!profile)
    if (profile) {
      const cur = profile.vac && profile.vac.id != null ? String(profile.vac.id) : null
      for (const key of Object.keys(CENTERS)) if (CENTERS[key].id === cur) markActive(key)
    }
  }

  if (document.body) buildPanel()
  else window.addEventListener('DOMContentLoaded', buildPanel)
  log('loaded on', location.host)
})()
