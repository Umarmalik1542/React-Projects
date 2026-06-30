package com.greeceserver.otpforwarder;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * Periodic "I'm alive" ping to the server so the dashboard shows active/inactive.
 * Fires from a repeating AlarmManager alarm, and re-schedules itself on boot.
 */
public class HeartbeatReceiver extends BroadcastReceiver {

    private static final String TAG = "OtpForwarder";
    private static final int REQ = 1001;
    private static final long INTERVAL_MS = 6L * 60 * 60 * 1000; // ~6 hours

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            schedule(context); // reboot ke baad alarm dobara lagao
        }
        SharedPreferences prefs = context.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE);
        final String number = prefs.getString(Config.KEY_NUMBER, "");
        if (number == null || number.isEmpty()) return;

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try { Net.register(number, Config.APP_VERSION); }
            catch (Exception e) { Log.e(TAG, "heartbeat failed", e); }
            finally { pending.finish(); }
        }).start();
    }

    /** Schedule the repeating heartbeat alarm. */
    public static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, HeartbeatReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ, i, flags);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + 60_000, INTERVAL_MS, pi);
    }
}
