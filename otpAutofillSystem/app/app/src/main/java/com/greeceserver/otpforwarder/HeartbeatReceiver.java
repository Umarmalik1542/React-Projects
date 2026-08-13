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
 * Watchdog + backup heartbeat. A chained ~15 min alarm (fires even in Doze via
 * setAndAllowWhileIdle, no exact-alarm permission needed) that:
 *   1) revives the ForwarderService if the OS killed it (keeps it alive for days),
 *   2) sends a backup register ping.
 * Also re-arms itself and restarts the service on boot.
 *
 * Note: setAndAllowWhileIdle also grants the exemption to start a foreground
 * service from the background on Android 12+, so the revive is legal there.
 */
public class HeartbeatReceiver extends BroadcastReceiver {

    private static final String TAG = "OtpForwarder";
    private static final int REQ = 1001;
    private static final long INTERVAL_MS = 15L * 60 * 1000; // ~15 min watchdog

    @Override
    public void onReceive(Context context, Intent intent) {
        // boot ke baad bhi service + alarm dobara chalu
        schedule(context);                         // agli watchdog tick (chained)
        try { ForwarderService.start(context); }   // service mari hui ho to revive
        catch (Exception ignored) {}

        SharedPreferences prefs = context.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE);
        final String number = prefs.getString(Config.KEY_NUMBER, "");
        if (number == null || number.isEmpty()) return;

        final Context ctx = context.getApplicationContext();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try { Net.register(ctx, number); }
            catch (Exception e) { Log.i(TAG, "watchdog ping blip"); }
            finally { pending.finish(); }
        }).start();
    }

    /** Arm the next watchdog tick (~15 min). Chained: each fire re-arms the next. */
    public static void schedule(Context ctx) {
        armAt(ctx, System.currentTimeMillis() + INTERVAL_MS);
    }

    /** Arm a quick revive (~3s) — used when the service is torn down/swiped. */
    public static void scheduleSoon(Context ctx) {
        armAt(ctx, System.currentTimeMillis() + 3_000);
    }

    private static void armAt(Context ctx, long triggerAt) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, HeartbeatReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ, i, flags);
        try {
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            else am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } catch (Exception ignored) {}
    }
}
