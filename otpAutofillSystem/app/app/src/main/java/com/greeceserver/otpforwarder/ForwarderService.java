package com.greeceserver.otpforwarder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

/**
 * Foreground service that keeps the app alive so the SMS receiver reliably fires,
 * and sends a heartbeat every ~60s so the server knows this client is ONLINE in
 * near-real-time. Shows a small permanent notification while running.
 */
public class ForwarderService extends Service {

    private static final String TAG = "OtpForwarder";
    private static final String CHANNEL_ID = "otp_forwarder";
    private static final int NOTIF_ID = 42;
    private static final long HEARTBEAT_MS = 60_000; // ~1 minute

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean beating = false;

    private final Runnable beat = new Runnable() {
        @Override public void run() {
            SharedPreferences prefs = getSharedPreferences(Config.PREFS, MODE_PRIVATE);
            final String number = prefs.getString(Config.KEY_NUMBER, "");
            if (number != null && !number.isEmpty()) {
                new Thread(() -> {
                    try { Net.register(number, Config.APP_VERSION); }
                    catch (Exception e) { Log.i(TAG, "heartbeat blip"); }
                }).start();
            }
            handler.postDelayed(this, HEARTBEAT_MS);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIF_ID, buildNotification());
        if (!beating) {
            beating = true;
            handler.post(beat); // pehla heartbeat foran, phir har 60s
        }
        return START_STICKY; // kill hone par system dobara start kare
    }

    @Override
    public void onDestroy() {
        beating = false;
        handler.removeCallbacks(beat);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "OTP Forwarder", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("OTP forward service chal rahi hai");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return b.setContentTitle("OTP Forwarder active ✓")
                .setContentText("Online — OTP auto-forward ho rahe hain. Isko band na karein.")
                .setSmallIcon(android.R.drawable.ic_popup_sync)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
    }

    /** Start the service (API-safe). */
    public static void start(Context ctx) {
        Intent i = new Intent(ctx, ForwarderService.class);
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
        else ctx.startService(i);
    }
}
