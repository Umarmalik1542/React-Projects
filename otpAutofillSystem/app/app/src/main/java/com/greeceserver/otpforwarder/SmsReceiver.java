package com.greeceserver.otpforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;

import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Listens for incoming SMS. If the message contains an OTP-like code (4-8 digits),
 * it forwards { number (this phone's registered number), text } to the routing
 * server. Messages without a code are ignored, so unrelated SMS are never sent.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "OtpForwarder";
    private static final Pattern OTP = Pattern.compile("\\b(\\d{4,8})\\b");

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        StringBuilder sb = new StringBuilder();
        for (SmsMessage m : messages) sb.append(m.getMessageBody());
        final String text = sb.toString();

        if (!OTP.matcher(text).find()) return; // koi OTP nahi -> ignore (privacy)

        SharedPreferences prefs = context.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE);
        final String number = prefs.getString(Config.KEY_NUMBER, "");
        if (number == null || number.isEmpty()) {
            Log.w(TAG, "OTP received but no number registered; ignoring.");
            return;
        }

        // Network call off the main thread; keep the receiver alive until done.
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                send(number, text);
            } catch (Exception e) {
                Log.e(TAG, "forward failed", e);
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static void send(String number, String text) throws Exception {
        String url = Config.SEND_URL
                + "?key=" + enc(Config.SEND_KEY)
                + "&number=" + enc(number)
                + "&text=" + enc(text);
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            c.setRequestMethod("GET");
            int code = c.getResponseCode();
            Log.i(TAG, "forwarded OTP, server responded " + code);
        } finally {
            c.disconnect();
        }
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8");
    }
}
