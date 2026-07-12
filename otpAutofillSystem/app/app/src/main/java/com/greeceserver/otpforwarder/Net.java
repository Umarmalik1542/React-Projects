package com.greeceserver.otpforwarder;

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

    /** Tell the server this client is alive (registry/heartbeat). */
    public static int register(String number, String ver) throws Exception {
        String url = Config.REGISTER_URL
                + "?key=" + enc(Config.SEND_KEY)
                + "&number=" + enc(number)
                + "&ver=" + enc(ver);
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
     * Diagnostic: tell the server an SMS reached the app (receiver fired).
     * Reuses the register endpoint (sms=1) so no extra nginx route is needed.
     * The dashboard's "Last SMS" column proves the SMS is reaching the app.
     */
    public static int smsSeen(String number, boolean otpFound) throws Exception {
        String url = Config.REGISTER_URL
                + "?key=" + enc(Config.SEND_KEY)
                + "&number=" + enc(number)
                + "&ver=" + enc(Config.APP_VERSION)
                + "&sms=1&otpfound=" + (otpFound ? "1" : "0");
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
