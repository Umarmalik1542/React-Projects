package com.greeceserver.otpforwarder;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;

/**
 * Single source of truth for "is the app fully ready to forward OTPs?".
 * Checked on every heartbeat (reported to the server) and shown on the setup
 * screen. The client shows ONLINE only when it is connected AND ready.
 */
public final class Readiness {

    public static boolean number(Context c) {
        SharedPreferences p = c.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE);
        String n = p.getString(Config.KEY_NUMBER, "");
        return n != null && !n.isEmpty();
    }

    public static boolean sms(Context c) {
        return Build.VERSION.SDK_INT < 23
                || c.checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean notif(Context c) {
        if (Build.VERSION.SDK_INT < 33) return true;
        return c.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean battery(Context c) {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }

    /** Critical set — without these forwarding literally cannot work. */
    public static boolean ready(Context c) {
        return number(c) && sms(c);
    }

    /** Last approval status returned by the server: "", pending, approved, rejected. */
    public static String approval(Context c) {
        return c.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE)
                .getString(Config.KEY_APPROVAL, "");
    }

    private Readiness() {}
}
