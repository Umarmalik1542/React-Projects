package com.greeceserver.otpforwarder;

/** App-wide constants. Server URL + key are baked in; the user only enters their number. */
public final class Config {
    // VPS endpoints (must match the routing server).
    public static final String SEND_URL = "https://greeceserver.com/otp-send";
    public static final String REGISTER_URL = "https://greeceserver.com/otp-register";
    // Must equal SEND_KEY on the server.
    public static final String SEND_KEY = "gr-send-4Tn8Lm3Vy";

    // Auto-update: app reads version.txt (latest versionCode) and downloads the APK.
    public static final String VERSION_URL = "https://github.com/Umarmalik1542/React-Projects/releases/download/otp-app/version.txt";
    public static final String APK_URL = "https://github.com/Umarmalik1542/React-Projects/releases/download/otp-app/OtpForwarder.apk";

    public static final String APP_VERSION = "2.3";

    public static final String PREFS = "otp_prefs";
    public static final String KEY_NUMBER = "number";
    public static final String KEY_NAME = "name";
    public static final String KEY_APPROVAL = "approval"; // pending | approved | rejected

    private Config() {}
}
