package com.greeceserver.otpforwarder;

import android.Manifest;
import android.app.Activity;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

/**
 * One-time setup: the user enters the phone number that will receive the OTP.
 * After that the SmsReceiver does all the work in the background.
 * A "Test Send" button verifies the server path without needing a real SMS.
 */
public class MainActivity extends Activity {

    private EditText numberInput;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        numberInput = findViewById(R.id.numberInput);
        status = findViewById(R.id.status);
        Button saveBtn = findViewById(R.id.saveBtn);
        Button testBtn = findViewById(R.id.testBtn);

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
            requestSmsPermission();
            updateStatus();
        });

        testBtn.setOnClickListener(v -> {
            String num = numberInput.getText().toString().trim();
            if (num.isEmpty()) {
                Toast.makeText(this, "Pehle number daal kar Save dabayein", Toast.LENGTH_SHORT).show();
                return;
            }
            Toast.makeText(this, "Test bhej rahe hain…", Toast.LENGTH_SHORT).show();
            new Thread(() -> {
                String msg;
                try {
                    int code = Net.send(num, "Test OTP code 123456");
                    msg = "Server ne jawab diya: " + code + (code == 200 ? " ✓" : "");
                } catch (Exception e) {
                    msg = "Error: " + e.getMessage();
                }
                final String fmsg = msg;
                new Handler(Looper.getMainLooper()).post(
                        () -> Toast.makeText(this, fmsg, Toast.LENGTH_LONG).show());
            }).start();
        });

        requestSmsPermission();
        updateStatus();
    }

    private void requestSmsPermission() {
        if (Build.VERSION.SDK_INT >= 23) {
            if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS}, 1);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        updateStatus();
    }

    private void updateStatus() {
        SharedPreferences prefs = getSharedPreferences(Config.PREFS, MODE_PRIVATE);
        String num = prefs.getString(Config.KEY_NUMBER, "");
        boolean smsOk = Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;

        StringBuilder s = new StringBuilder();
        if (num.isEmpty()) {
            s.append("Apna number daal kar Save dabayein.");
        } else {
            s.append("Registered number: ").append(num).append("\n");
            s.append(smsOk ? "✓ SMS permission OK — app active hai."
                           : "⚠ SMS permission NAHI mili. Save dabayein aur Allow karein,\nya Settings → Apps → OTP Forwarder → Permissions → SMS → Allow.");
            s.append("\n\nXiaomi/Infinix/Realme/Oppo par: app ki settings mein 'Autostart' ON karein,\naur battery ko 'No restrictions' karein — warna background SMS nahi parhega.");
        }
        status.setText(s.toString());
    }
}
