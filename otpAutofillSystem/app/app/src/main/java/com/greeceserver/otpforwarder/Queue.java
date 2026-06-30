package com.greeceserver.otpforwarder;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Holds OTPs that couldn't be sent (no internet) and re-sends them when the
 * network returns. Items older than the OTP validity are dropped (an expired
 * OTP is useless — a new one must be requested).
 */
public final class Queue {

    private static final String PREFS = "otp_queue";
    private static final String KEY = "pending";
    private static final long VALID_MS = 5 * 60 * 1000; // OTP ~5 min valid

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONArray read(SharedPreferences p) {
        try { return new JSONArray(p.getString(KEY, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    /** Save a failed OTP for later. */
    public static synchronized void add(Context ctx, String number, String text) {
        SharedPreferences p = prefs(ctx);
        JSONArray arr = read(p);
        try {
            JSONObject o = new JSONObject();
            o.put("n", number);
            o.put("t", text);
            o.put("at", System.currentTimeMillis());
            arr.put(o);
            p.edit().putString(KEY, arr.toString()).apply();
        } catch (Exception ignored) {}
    }

    /** Try to send everything still fresh. Returns true if items remain (retry later). */
    public static synchronized boolean flush(Context ctx) {
        SharedPreferences p = prefs(ctx);
        JSONArray arr = read(p);
        JSONArray remaining = new JSONArray();
        long now = System.currentTimeMillis();

        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            long at = o.optLong("at", 0);
            if (now - at > VALID_MS) continue; // expire -> drop

            boolean ok = false;
            try { ok = Net.sendWithRetry(o.optString("n"), o.optString("t"), 2) == 200; }
            catch (Exception ignored) {}
            if (!ok) remaining.put(o); // network still bad -> keep
        }

        p.edit().putString(KEY, remaining.toString()).apply();
        return remaining.length() > 0;
    }

    private Queue() {}
}
