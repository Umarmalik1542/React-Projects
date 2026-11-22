# OTP Forwarder (Android app)

Lightweight app each client installs. It reads incoming OTP SMS and forwards
`{ number, text }` to the routing server (`greeceserver.com/otp-send`). Only
messages containing a 4-8 digit code are sent — other SMS are ignored.

## How a client uses it
1. Install the APK (sideload — sent via WhatsApp).
2. Open the app, type the phone number that receives the OTP, press **Save**.
3. Allow the **SMS** permission.
4. Done. The app works in the background; it need not stay open.

> Server URL + `SEND_KEY` are baked into `Config.java`. Only the number is
> entered by the user.

## How the APK is built (no Android Studio needed)
A GitHub Actions workflow builds it in the cloud:
`.github/workflows/build-otp-apk.yml`

- Runs on every push that touches `otpAutofillSystem/app/**`, or manually
  (Actions tab → **Build OTP Forwarder APK** → Run workflow).
- Download the APK from the run's **Artifacts** → `OtpForwarder-apk`.

## Project layout
```
app/
  settings.gradle, build.gradle, gradle.properties
  app/
    build.gradle
    src/main/AndroidManifest.xml
    src/main/java/com/greeceserver/otpforwarder/
      Config.java         # server URL + key + prefs keys
      MainActivity.java   # one-time number setup + SMS permission
      SmsReceiver.java    # reads SMS, extracts OTP, forwards to server
    src/main/res/...      # layout, strings, theme, icon
```

## Notes
- Min Android 5.0 (API 21). No AndroidX — only the framework, so the build is
  small and fast.
- For best reliability, the client should exclude the app from battery
  optimization (Settings → Battery) so SMS are delivered promptly.
- To rotate the key: change `SEND_KEY` here and on the server, rebuild, redistribute.
