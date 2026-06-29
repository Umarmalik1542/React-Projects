package com.greeceserver.otpforwarder;

/** App-wide constants. Server URL + key are baked in; the user only enters their number. */
public final class Config {
    // VPS endpoint that receives the OTP (must match the routing server).
    public static final String SEND_URL = "https://greeceserver.com/otp-send";
    // Must equal SEND_KEY on the server.
    public static final String SEND_KEY = "gr-send-4Tn8Lm3Vy";

    public static final String PREFS = "otp_prefs";
    public static final String KEY_NUMBER = "number";

    private Config() {}
}
