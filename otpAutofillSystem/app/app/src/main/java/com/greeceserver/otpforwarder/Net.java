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
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            c.setRequestMethod("GET");
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8");
    }

    private Net() {}
}
