# OTP Auto-fill System (multi-client)

Phone par OTP aate hi wo **sahi browser** ke OTP field mein khud bhar jaata hai —
chahe ek waqt mein kai browser, kai alag number kaam kar rahe hon.

## 3 hisse
1. **`server/`** — Routing server (yeh repo). Phone se OTP le kar sahi browser ko bhejta hai.
2. **`extension/`** — Browser extension / Tampermonkey (aane wala — Phase 2).
3. **`app/`** — Android app (aane wala — Phase 3).

## Matching kaise hoti hai
- Chaabi = **phone number** (normalize: aakhri 10 digits).
- **1 number = 1 browser** → kabhi mix-up nahi.
- Har "Send OTP" click = ek short-lived **wait** (5 min TTL), OTP aate hi consume.
- OTP pehle aa jaye to thori der (90s) hold hota hai, taake browser late register kare to bhi mil jaye.

---

## Phase 1 — Server chalana

```bash
cd otpAutofillSystem/server
npm install
npm start
```
Output: `OTP Routing Server listening on http://0.0.0.0:5000`

### Test (bina phone/browser ke)
Server chalu rakh kar, doosre terminal mein:

```bash
# 1) health check
curl http://localhost:5000/health

# 2) OTP simulate karo (phone ki jagah)
curl "http://localhost:5000/otp?number=03001234567&text=Your%20code%20is%20558931"
```
`delivered:false` aayega kyunki abhi koi browser wait nahi kar raha — yeh normal hai.
Asli auto-fill Phase 2 (extension) ke baad dikhega.

## API (reference)
| Kis ke liye | Endpoint | Data |
|-------------|----------|------|
| Phone app | `POST /otp` | `{ number, otp }` (otp poora SMS text bhi ho sakta hai) |
| Browser | WebSocket `/ws` | `{ type:"wait", number, field }` → push `{ type:"otp", otp }` |
| Debug | `GET /health` | waiting/orphan counts |

## Security
- Sirf apne **trusted local network** par chalao. OTP server par store nahi hota.
- Internet par expose **mat** karo (HTTPS + auth ke baghair).
