# OTP Auto-fill (Phone → Desktop)

Aapke phone par OTP aate hi wo **automatically** aapke desktop ke OTP input
field mein bhar jaata hai — manually type karne ki zaroorat nahi.

> **Note:** SMS auto-read sirf **Android** par possible hai. iPhone apps ko
> doosri apps ke OTP SMS parhne nahi deta, isliye full automation Android-only hai.

---

## System kaise kaam karta hai

```
 ┌─────────────┐   SMS aaya     ┌──────────────┐   WebSocket    ┌──────────────┐
 │   Android   │  OTP nikaala   │    Server    │  realtime push │   Desktop    │
 │   phone     │ ─────POST────▶ │ (Node + ws)  │ ─────────────▶ │  React app   │
 │             │  /otp?session  │              │                │  auto-fill   │
 └─────────────┘                └──────────────┘                └──────────────┘
```

1. **Desktop** browser ek **pairing code** (jaise `K7P2Q9`) banata hai aur
   server se WebSocket par connect ho jaata hai.
2. **Phone** par OTP wala SMS aata hai. Ek SMS-forwarder app us message ko
   server ke `/otp` endpoint par bhej deta hai (usi pairing code ke saath).
3. **Server** message se OTP digits nikaalta hai aur turant us pairing code se
   judey desktop par push kar deta hai.
4. Desktop par OTP boxes **khud bhar jaate hain**. ✅

In-memory relay hai — koi database ya account nahi. Sab kuch aapke local
network par chalta hai.

---

## 1) Server chalao

```bash
cd otpAutofillProject/server
npm install
npm start
```

Output: `OTP relay server listening on http://0.0.0.0:4000`

> Apne computer ka **local IP** note kar lo (phone ko isi par bhejna hoga):
> - Windows: `ipconfig` → IPv4 Address (jaise `192.168.1.10`)
> - Mac/Linux: `ifconfig` ya `ip addr`
>
> Phone aur computer **same Wi-Fi** par hone chahiye.

## 2) Desktop app chalao

```bash
cd otpAutofillProject/client
npm install
npm run dev
```

Browser mein app khulega. Wahan:
- Ek **pairing code** dikhega (jaise `K7P2Q9`).
- **Server address** field mein apna IP daalo, jaise `192.168.1.10:4000`
  (agar app usi computer par khol rahe ho to `localhost:4000` theek hai).
- Status green ho jaye to matlab connected hai.

## 3) Phone setup (Android)

Bina koding ke sabse aasaan tareeka — ek free **SMS forwarding** app:

1. Play Store se ek app install karo, jaise **"SMS to URL Forwarder"** ya
   **MacroDroid / Tasker** (jisme aap aaram ho).
2. Use SMS parhne ki permission do.
3. Forward URL set karo (desktop app ke **"Phone forwarding URL"** section se
   copy kar sakte ho):

   ```
   http://192.168.1.10:4000/otp?session=K7P2Q9&text={message}
   ```

   - `192.168.1.10:4000` → aapke computer ka IP
   - `K7P2Q9` → desktop par dikh raha pairing code
   - `{message}` → app khud isko SMS ke text se replace kar dega
     (alag apps mein placeholder ka naam alag ho sakta hai, jaise
     `%message%`, `[message]`, `{{body}}` — app ki settings dekho)
4. Bas. Ab jab bhi OTP SMS aayega, wo apne aap desktop par bhar jayega.

---

## Bina phone ke test karo (curl)

Server aur desktop app chalu hone ke baad, terminal se OTP "simulate" karo
(pairing code apne app wala daalo):

```bash
curl "http://localhost:4000/otp?session=K7P2Q9&text=Your%20verification%20code%20is%20482913"
```

Desktop par OTP boxes turant `4 8 2 9 1 3` se bhar jaane chahiye.

---

## Files

| Path | Kaam |
|------|------|
| `server/index.js` | HTTP `/otp` endpoint + WebSocket relay |
| `client/src/App.jsx` | OTP auto-fill UI, pairing code, WebSocket client |

## Security notes

- Sirf apne **trusted local network** par chalao. `/otp` endpoint khula hai,
  jo bhi pairing code jaanta ho wo OTP bhej sakta hai.
- Pairing code chhota guess-able hai, isliye ise internet par expose **mat**
  karo. Public deployment ke liye HTTPS + proper auth zaroori hoga.
- OTP server par store nahi hota — sirf realtime push hota hai aur bhool jaata hai.

## Aage kya (optional upgrades)

- Native Android app jo **SMS Retriever API** use kare (zyada secure, manual
  permission ki zaroorat nahi) — taake forwarder app par depend na karna pade.
- Server par per-session token/auth.
- Public deployment ke liye HTTPS (`wss://`) + ek hosting provider.
