package com.greeceserver.otpforwarder;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * In-app auto-update. Reads version.txt (latest versionCode) from the GitHub
 * release; if newer than installed, downloads the APK and launches the
 * installer. Android still asks the user to confirm the install (no root).
 */
public final class Updater {

    /** Check in the background; prompt if a newer version exists. */
    public static void checkAsync(final Activity act, final boolean manual) {
        new Thread(() -> {
            int remote = fetchRemoteVersion();
            int local = localVersion(act);
            if (remote <= 0) { if (manual) toast(act, "Update check fail (internet?)"); return; }
            if (remote > local) {
                act.runOnUiThread(() -> promptUpdate(act));
            } else if (manual) {
                toast(act, "App up to date (v" + Config.APP_VERSION + ")");
            }
        }).start();
    }

    private static int fetchRemoteVersion() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(Config.VERSION_URL).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(6000);
            c.setInstanceFollowRedirects(true);
            BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream()));
            String line = r.readLine();
            r.close();
            return line == null ? -1 : Integer.parseInt(line.trim());
        } catch (Exception e) {
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static int localVersion(Context ctx) {
        try { return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionCode; }
        catch (Exception e) { return 0; }
    }

    private static void promptUpdate(final Activity act) {
        new AlertDialog.Builder(act)
                .setTitle("Update available")
                .setMessage("Naya version available hai. Abhi update karein?")
                .setPositiveButton("Update", (d, w) -> startDownload(act))
                .setNegativeButton("Baad mein", null)
                .show();
    }

    private static void startDownload(final Activity act) {
        try {
            final DownloadManager dm = (DownloadManager) act.getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(Config.APK_URL));
            req.setMimeType("application/vnd.android.package-archive");
            req.setTitle("OTP Forwarder update");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(act, null, "OtpForwarder-update.apk");
            final long id = dm.enqueue(req);
            toast(act, "Download ho raha hai…");

            final BroadcastReceiver rec = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) {
                    long done = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (done != id) return;
                    try { c.unregisterReceiver(this); } catch (Exception ignored) {}
                    install(act, dm.getUriForDownloadedFile(id));
                }
            };
            IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) act.registerReceiver(rec, f, Context.RECEIVER_EXPORTED);
            else act.registerReceiver(rec, f);
        } catch (Exception e) {
            toast(act, "Download fail: " + e.getMessage());
        }
    }

    private static void install(Context ctx, Uri uri) {
        if (uri == null) { toast(ctx, "Download nahi mila"); return; }
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ctx.startActivity(i);
    }

    private static void toast(final Context c, final String m) {
        new Handler(Looper.getMainLooper()).post(
                () -> Toast.makeText(c.getApplicationContext(), m, Toast.LENGTH_SHORT).show());
    }

    private Updater() {}
}
