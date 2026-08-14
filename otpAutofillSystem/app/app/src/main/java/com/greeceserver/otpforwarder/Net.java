package com.greeceserver.otpforwarder;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/** Sends { number, text } to the routing server. Returns the HTTP status code. */
public final class Net {

    public static int send(String number, String text) throws Exception {
        String url = Config.SEND_URL
                + "?key=" + enc(Config.SEND_KEY)
                + "&number=" + enc(number)
                + "&text=" + enc(text);
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setRequestMethod("GET");
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    /**
     * Heartbeat: tell the server this client is alive AND report each readiness
     * setting (sms/notif/battery/number). The server marks a client ONLINE only
     * when it is connected AND ready — so a missing setting shows the real reason.
     */
    public static int register(Context ctx, String number) throws Exception {
        SharedPreferences p = ctx.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE);
        String name = p.getString(Config.KEY_NAME, "");
        String url = Config.REGISTER_URL
                + "?key=" + enc(Config.SEND_KEY)
                + "&number=" + enc(number)
                + "&name=" + enc(name)
                + "&ver=" + enc(Config.APP_VERSION)
                + "&sms=" + b(Readiness.sms(ctx))
                + "&notif=" + b(Readiness.notif(ctx))
                + "&batt=" + b(Readiness.battery(ctx))
                + "&num=" + b(Readiness.number(ctx));
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            if (code == 200) {
                // Server ka approval status parse karke save karo (app me dikhane ke liye)
                try {
                    JSONObject j = new JSONObject(readBody(c));
                    String appr = j.optString("approved", "");
                    if (!appr.isEmpty()) p.edit().putString(Config.KEY_APPROVAL, appr).apply();
                } catch (Exception ignored) {}
            }
            return code;
        } finally {
            c.disconnect();
        }
    }

    private static String readBody(HttpURLConnection c) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
        }
        return sb.toString();
    }

    private static String b(boolean v) { return v ? "1" : "0"; }

    /**
     * Diagnostic: tell the server an SMS reached the app (receiver fired).
     * Reuses the register endpoint (sms=1) so no extra nginx route is needed.
     * The dashboard's "Last SMS" column proves the SMS is reaching the app.
     */
    public static int smsSeen(String number, boolean otpFound) throws Exception {
        String url = Config.REGISTER_URL
                + "?key=" + enc(Config.SEND_KEY)
                + "&number=" + enc(number)
                + "&ver=" + enc(Config.APP_VERSION)
                + "&smsseen=1&otpfound=" + (otpFound ? "1" : "0");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setRequestMethod("GET");
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    /** Try a few times so a transient network blip doesn't lose the OTP. */
    public static int sendWithRetry(String number, String text, int attempts) {
        int last = -1;
        for (int i = 1; i <= attempts; i++) {
            try {
                last = send(number, text);
                if (last == 200) return 200;
            } catch (Exception e) {
                last = -1;
            }
            if (i < attempts) {
                try { Thread.sleep(900); } catch (InterruptedException ignored) {}
            }
        }
        return last;
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8");
    }

    private Net() {}
}
