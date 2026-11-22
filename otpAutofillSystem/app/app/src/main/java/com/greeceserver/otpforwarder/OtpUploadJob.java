package com.greeceserver.otpforwarder;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/**
 * Runs when the network is available and flushes any queued OTPs. Scheduled by
 * the SMS receiver whenever a forward fails (e.g. no internet at that moment).
 */
public class OtpUploadJob extends JobService {

    private static final int JOB_ID = 2002;

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            boolean more = Queue.flush(getApplicationContext());
            jobFinished(params, more); // agar abhi bhi pending -> backoff par dobara
        }).start();
        return true; // kaam background thread par jaari hai
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true; // dobara schedule karo
    }

    /** Schedule the job to run as soon as there is a network connection. */
    public static void schedule(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, OtpUploadJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setBackoffCriteria(5000, JobInfo.BACKOFF_POLICY_LINEAR)
                .build();
        js.schedule(info);
    }
}
