// ==UserScript==
// @name         GVCW Center Switcher (ISB / LHR)
// @namespace    gvcw-center-switcher
// @version      1.0.0
// @description  Ek click par apna appointment center Islamabad (ISB=137) ya Lahore (LHR=138) badlo — profile GET karke sirf vac.id change karke PUT kar deta hai. Manage-Account/Save ki zaroorat nahi.
// @match        https://pk-gr-services.gvcworld.eu/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict'

  // ====== CONFIG ============================================================
  const USER_API = '/api/v1/user'      // GET current profile + PUT updated profile
  const CENTERS = {
    ISB: { id: '137', label: 'Islamabad (ISB)' },
    LHR: { id: '138', label: 'Lahore (LHR)' },
  }
  // ==========================================================================

  const log = (...a) => console.log('%c[Center]', 'color:#0ea5e9;font-weight:bold', ...a)

  // ---- fetch current profile ------------------------------------------------
  // GET /api/v1/user should return the logged-in user's full profile. Different
  // deployments wrap it differently, so we dig out the profile object defensively.
  async function fetchProfile() {
    const res = await fetch(USER_API, {
      method: 'GET',
      headers: { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) throw new Error('GET profile ' + res.status)
    const j = await res.json()
    // shapes seen in the wild: {returnobject:{...}} | {data:{...}} | {...profile}
    const p = (j && (j.returnobject || j.data || j.user)) || j
    if (!p || typeof p !== 'object' || p.id == null) throw new Error('Profile shape unexpected')
    return p
  }

  // ---- switch center --------------------------------------------------------
  let busy = false
  async function switchTo(key) {
    if (busy) return
    const target = CENTERS[key]
    if (!target) return
    busy = true
    toast('⏳ ' + target.label + ' set kar rahe…', '#f59e0b')
    try {
      const profile = await fetchProfile()
      const currentVac = profile.vac && profile.vac.id != null ? String(profile.vac.id) : null
      if (currentVac === target.id) {
        toast('✅ Pehle se ' + target.label, '#16a34a')
        markActive(key)
        return
      }
      // sirf vac.id badlo — baaqi profile jaisa hai waisa hi PUT karo
      const body = { ...profile, vac: { ...(profile.vac || {}), id: target.id } }
      const res = await fetch(USER_API, {
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
        toast('✅ Center → ' + target.label, '#16a34a')
        markActive(key)
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

  // ---- UI: panel with two buttons + toast ----------------------------------
  let toastEl = null
  function toast(text, color = '#0ea5e9') {
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.style.cssText =
        'margin-top:8px;font:600 12px system-ui,sans-serif;color:#fff;padding:6px 10px;border-radius:8px;text-align:center;transition:background .3s'
      panel.appendChild(toastEl)
    }
    toastEl.textContent = text
    toastEl.style.background = color
  }

  let panel = null
  const btns = {}
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
      'position:fixed;top:12px;left:12px;z-index:2147483647;width:200px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:12px;font:13px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4)'
    const title = document.createElement('div')
    title.textContent = '🏢 Appointment Center'
    title.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:8px'
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

    // load current center to highlight the active one
    fetchProfile()
      .then((p) => {
        const cur = p.vac && p.vac.id != null ? String(p.vac.id) : null
        for (const key of Object.keys(CENTERS)) if (CENTERS[key].id === cur) markActive(key)
      })
      .catch(() => {})
  }

  if (document.body) buildPanel()
  else window.addEventListener('DOMContentLoaded', buildPanel)
  log('loaded on', location.host)
})()
