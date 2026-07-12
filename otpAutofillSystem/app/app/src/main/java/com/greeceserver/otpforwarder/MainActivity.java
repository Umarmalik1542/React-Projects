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

    private EditText numberInput;
    private TextView status;
    private boolean askedOnce = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        numberInput = findViewById(R.id.numberInput);
        status = findViewById(R.id.status);
        Button saveBtn = findViewById(R.id.saveBtn);
        Button permBtn = findViewById(R.id.permBtn);
        Button updateBtn = findViewById(R.id.updateBtn);

        final SharedPreferences prefs = getSharedPreferences(Config.PREFS, MODE_PRIVATE);
        numberInput.setText(prefs.getString(Config.KEY_NUMBER, ""));

        saveBtn.setOnClickListener(v -> {
            String num = numberInput.getText().toString().trim();
            if (num.isEmpty()) {
                Toast.makeText(this, "Apna number daalein", Toast.LENGTH_SHORT).show();
                return;
            }
            prefs.edit().putString(Config.KEY_NUMBER, num).apply();
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
            ensurePermission();
            registerNow(num);
            ForwarderService.start(this);   // number set hote hi service on
            updateStatus();
        });

        permBtn.setOnClickListener(v -> {
            if (smsGranted()) {
                Toast.makeText(this, "SMS permission pehle se allowed hai ✓", Toast.LENGTH_SHORT).show();
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
            try { Net.register(number, Config.APP_VERSION); }
            catch (Exception ignored) {}
        }).start();
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
        Toast.makeText(this, "SMS ko Allow karein", Toast.LENGTH_LONG).show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        updateStatus();
    }

    private void updateStatus() {
        SharedPreferences prefs = getSharedPreferences(Config.PREFS, MODE_PRIVATE);
        String num = prefs.getString(Config.KEY_NUMBER, "");
        boolean smsOk = smsGranted();

        StringBuilder s = new StringBuilder();
        if (num.isEmpty()) {
            s.append("Apna mobile number daal kar Save dabayein.\n");
        } else {
            s.append("Number: ").append(num).append("\n");
        }
        s.append(smsOk ? "✓ SMS permission allowed — app active hai."
                       : "⚠ SMS permission chahiye — popup par Allow dabayein (ya neeche button).");
        s.append("\n🟢 Background service chal rahi hai (notification me status dikhega).");
        s.append("\nApp band kar sakte hain — kai din tak background me OTP forward karti rahegi.");
        s.append("\n\n(Xiaomi/Infinix/Realme/Oppo par: app settings mein 'Autostart' ON aur Battery 'No restrictions' karein — warna phone app ko maar deta hai.)");
        s.append("\n\nApp version: ").append(Config.APP_VERSION);
        status.setText(s.toString());
    }
}
