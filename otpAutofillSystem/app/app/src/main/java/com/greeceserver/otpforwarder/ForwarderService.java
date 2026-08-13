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

/**
 * Lightweight always-on service. Keeps the app process alive (so the SMS receiver
 * fires even if the app has not been opened for days) and sends a small heartbeat
 * every ~60s so the server knows this client is online and able to forward.
 *
 * Kept deliberately simple: one small HTTP ping/min + a permanent low-priority
 * notification. No wakelocks, no loops — light on battery, phone hang nahi hota.
 * A separate ~15 min watchdog alarm (HeartbeatReceiver) revives it if the OS kills it.
 */
public class ForwarderService extends Service {

    private static final String CHANNEL_ID = "otp_forwarder";
    private static final int NOTIF_ID = 42;
    private static final long HEARTBEAT_MS = 60_000; // ~1 minute

    private static final int FAIL_LIMIT = 3; // itni lagataar fail ke baad hi "net nahi" dikhao

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean beating = false;
    private int fails = 0;

    private final Runnable beat = new Runnable() {
        @Override public void run() {
            final Context ctx = ForwarderService.this;
            SharedPreferences prefs = getSharedPreferences(Config.PREFS, MODE_PRIVATE);
            final String number = prefs.getString(Config.KEY_NUMBER, "");
            if (number != null && !number.isEmpty()) {
                new Thread(() -> {
                    boolean ok;
                    try { ok = Net.register(ctx, number) == 200; }
                    catch (Exception e) { ok = false; }
                    final boolean fok = ok;
                    handler.post(() -> {
                        if (fok) fails = 0; else fails++;
                        updateNotification(fok || fails < FAIL_LIMIT);
                    });
                }).start();
            } else {
                updateNotification(false); // number nahi -> not ready
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
        startForeground(NOTIF_ID, buildNotification("Active — background me forward ke liye taiyar"));
        if (!beating) {
            beating = true;
            handler.post(beat); // pehla ping foran, phir har 60s
        }
        HeartbeatReceiver.schedule(this); // watchdog alarm pakka chalu rahe
        return START_STICKY;              // OS kill kare to dobara start kare
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Kuch OEM recents-swipe par service maar dete hain -> alarm se jaldi revive
        HeartbeatReceiver.scheduleSoon(this);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        beating = false;
        handler.removeCallbacks(beat);
        HeartbeatReceiver.scheduleSoon(this); // mar rahe hain to jald wapas aane ka intezaam
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

    /**
     * Notification reflects the REAL state, in priority order:
     * missing setting -> not connected -> online. Client ko yahi ek cheez dikhti hai.
     * @param connected whether the last heartbeat reached the server (with debounce)
     */
    private void updateNotification(boolean connected) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        String text;
        if (!Readiness.number(this))      text = "⚠ App mein apna number daalein";
        else if (!Readiness.sms(this))    text = "⚠ SMS permission allow karein";
        else if (!connected)              text = "🔴 Net nahi — connect hone ki koshish";
        else if (!Readiness.battery(this))text = "🟢 Online (behtar: Battery ‘No restrictions’ karein)";
        else                              text = "🟢 Online — OTP ke liye taiyar";
        nm.notify(NOTIF_ID, buildNotification(text));
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return b.setContentTitle("OTP Forwarder")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_popup_sync)
                .setOngoing(true)
                .setContentIntent(pi)
                .build();
    }

    /** Start the service (API-safe). */
    public static void start(Context ctx) {
        Intent i = new Intent(ctx, ForwarderService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception ignored) {}
    }
}
