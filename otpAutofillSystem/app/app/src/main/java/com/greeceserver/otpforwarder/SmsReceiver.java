package com.greeceserver.otpforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.util.Log;
import android.widget.Toast;

import java.util.regex.Pattern;

/**
 * Listens for incoming SMS. If the message contains an OTP-like code (4-8 digits),
 * it forwards { number (this phone's registered number), text } to the routing
 * server. Shows Toasts so activity is visible while testing.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "OtpForwarder";
    // 4-8 digit run not glued to other digits (so phone numbers etc. don't false-match)
    private static final Pattern OTP = Pattern.compile("(?<!\\d)(\\d{4,8})(?!\\d)");

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        StringBuilder sb = new StringBuilder();
        for (SmsMessage m : messages) sb.append(m.getMessageBody());
        final String text = sb.toString();

        final boolean otpFound = OTP.matcher(text).find();

        SharedPreferences prefs = context.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE);
        final String number = prefs.getString(Config.KEY_NUMBER, "");

        // DIAGNOSTIC: receiver fire hua -> server ko foran batao (chahe OTP ho ya na ho).
        // Dashboard ka "Last SMS" column isi se update hota hai — sabit karta hai ke
        // SMS is phone tak pohnch raha hai. (koi OTP body server ko nahi bhejta)
        if (number != null && !number.isEmpty()) {
            new Thread(() -> {
                try { Net.smsSeen(number, otpFound); } catch (Exception ignored) {}
            }).start();
        }

        if (!otpFound) {
            Log.i(TAG, "SMS received but no OTP code; ignoring.");
            return; // koi OTP nahi -> forward nahi (privacy)
        }
        if (number == null || number.isEmpty()) {
            toast(context, "OTP aaya par app mein number set nahi hai!");
            return;
        }

        toast(context, "OTP SMS mila — server ko bhej rahe hain…");

        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                int code = Net.sendWithRetry(number, text, 3);
                if (code == 200) {
                    toast(context, "OTP bhej diya ✓");
                } else {
                    // net nahi/server fail -> queue karo, internet aate hi bhej denge
                    Queue.add(context, number, text);
                    OtpUploadJob.schedule(context);
                    toast(context, "Net nahi — OTP queue mein, internet aate hi bhej denge");
                }
                Log.i(TAG, "forward result " + code);
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static void toast(Context ctx, String msg) {
        new Handler(Looper.getMainLooper()).post(
                () -> Toast.makeText(ctx.getApplicationContext(), msg, Toast.LENGTH_LONG).show());
    }
}
