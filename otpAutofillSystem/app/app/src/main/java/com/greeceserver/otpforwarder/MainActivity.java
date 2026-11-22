package com.greeceserver.otpforwarder;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

/**
 * One-time setup: user enters the phone number that receives the OTP and allows
 * the SMS permission (popup appears automatically on open). After that the
 * SmsReceiver forwards OTPs in the background.
 */
public class MainActivity extends Activity {

    private EditText nameInput;
    private EditText numberInput;
    private TextView status;
    private boolean askedOnce = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        nameInput = findViewById(R.id.nameInput);
        numberInput = findViewById(R.id.numberInput);
        status = findViewById(R.id.status);
        Button saveBtn = findViewById(R.id.saveBtn);
        Button permBtn = findViewById(R.id.permBtn);
        Button battBtn = findViewById(R.id.battBtn);
        Button updateBtn = findViewById(R.id.updateBtn);

        final SharedPreferences prefs = getSharedPreferences(Config.PREFS, MODE_PRIVATE);
        nameInput.setText(prefs.getString(Config.KEY_NAME, ""));
        numberInput.setText(prefs.getString(Config.KEY_NUMBER, ""));

        saveBtn.setOnClickListener(v -> {
            String num = numberInput.getText().toString().trim();
            String nm = nameInput.getText().toString().trim();
            if (num.isEmpty()) {
                Toast.makeText(this, "Please enter your number", Toast.LENGTH_SHORT).show();
                return;
            }
            if (nm.isEmpty()) {
                Toast.makeText(this, "Please enter your name", Toast.LENGTH_SHORT).show();
                return;
            }
            prefs.edit().putString(Config.KEY_NUMBER, num).putString(Config.KEY_NAME, nm).apply();
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
            ensurePermission();
            registerNow(num);
            ForwarderService.start(this);   // number set hote hi service on
            updateStatus();
        });

        permBtn.setOnClickListener(v -> {
            if (smsGranted()) {
                Toast.makeText(this, "SMS permission is already enabled ✓", Toast.LENGTH_SHORT).show();
                return;
            }
            // permanently denied (rationale false + pehle maang chuke) -> settings kholo
            if (Build.VERSION.SDK_INT >= 23 && askedOnce
                    && !shouldShowRequestPermissionRationale(Manifest.permission.RECEIVE_SMS)) {
                openAppSettings();
            } else {
                requestSms();
            }
        });

        battBtn.setOnClickListener(v -> askBattery());

        updateBtn.setOnClickListener(v -> Updater.checkAsync(this, true));

        // App khulte hi permission popup + register + heartbeat + service + update check
        ensurePermission();
        askNotificationPermission();
        String saved = prefs.getString(Config.KEY_NUMBER, "");
        if (!saved.isEmpty()) registerNow(saved);
        HeartbeatReceiver.schedule(this);
        ForwarderService.start(this);        // foreground service — app zinda + online heartbeat
        Updater.checkAsync(this, false);
        updateStatus();
    }

    private void askNotificationPermission() {
        // Android 13+ par foreground-service notification dikhane ke liye
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            try { requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2); } catch (Exception ignored) {}
        }
    }

    private void registerNow(String number) {
        new Thread(() -> {
            try { Net.register(this, number); }
            catch (Exception ignored) {}
        }).start();
    }

    /** One-tap: ask the OS to exempt this app from battery optimization. */
    private void askBattery() {
        if (Readiness.battery(this)) {
            Toast.makeText(this, "Battery already unrestricted ✓", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) {
            // kuch phones ye direct intent block karte hain -> general list kholo
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
            catch (Exception ignored) {}
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!smsGranted()) ensurePermission();
        updateStatus();
    }

    private boolean smsGranted() {
        return Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensurePermission() {
        if (!smsGranted()) requestSms();
    }

    private void requestSms() {
        if (Build.VERSION.SDK_INT >= 23) {
            askedOnce = true;
            requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, 1);
        }
    }

    private void openAppSettings() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        i.setData(Uri.fromParts("package", getPackageName(), null));
        startActivity(i);
        Toast.makeText(this, "Tap Allow for SMS", Toast.LENGTH_LONG).show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        updateStatus();
    }

    private void updateStatus() {
        boolean numOk = Readiness.number(this);
        boolean smsOk = Readiness.sms(this);
        boolean notifOk = Readiness.notif(this);
        boolean battOk = Readiness.battery(this);

        StringBuilder s = new StringBuilder();
        s.append(numOk   ? "✓ Number set\n"                 : "✗ Enter your number (Save above)\n");
        s.append(smsOk   ? "✓ SMS permission\n"             : "✗ SMS permission (tap the button)\n");
        s.append(notifOk ? "✓ Notification\n"               : "✗ Allow notifications\n");
        s.append(battOk  ? "✓ Battery: No restrictions\n"   : "✗ Disable battery restriction (button)\n");

        s.append("\n");
        String appr = Readiness.approval(this);
        if ("rejected".equals(appr)) {
            s.append("🚫 Account REJECTED — contact the admin.\n");
        } else if ("pending".equals(appr)) {
            s.append("⏳ Approval PENDING — waiting for the admin to approve.\n");
        } else if ("approved".equals(appr)) {
            s.append("✅ APPROVED by admin.\n");
        }
        if (numOk && smsOk) {
            s.append("✅ READY — you are all set. You can close the app now;\nOTPs will keep forwarding in the background for days.");
            if (!battOk) s.append("\n(For better reliability, tap the Battery button too.)");
        } else {
            s.append("⚠ Complete the ✗ items above — only then the app goes ONLINE.");
        }
        s.append("\n\n(On Xiaomi/Infinix/Realme/Oppo: also enable 'Autostart'.)");
        s.append("\nApp version: ").append(Config.APP_VERSION);
        status.setText(s.toString());
    }
}
