package com.docto110.soundz;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

import java.io.File;
import java.util.Random;
import java.util.concurrent.atomic.AtomicBoolean;

/** Fires every N minutes (and after a reboot) while DONT! mode is on. */
public class DontReceiver extends BroadcastReceiver {

    static final String ACTION_FIRE = "com.docto110.soundz.DONT_FIRE";
    static final String CHANNEL = "dont";
    static final int NOTIF_ID = 4242;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(DontPlugin.PREFS, Context.MODE_PRIVATE);
    }

    static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, DontReceiver.class).setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(c, 1, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void schedule(Context c) {
        int minutes = Math.max(1, prefs(c).getInt("minutes", 20));
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = SystemClock.elapsedRealtime() + minutes * 60_000L;
        // Not exact on purpose: no special permission needed, and it still fires in Doze.
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, alarmIntent(c));
    }

    static void cancel(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(c));
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIF_ID);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        boolean on = prefs(context).getBoolean("on", false);
        if (!on) return;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.MY_PACKAGE_REPLACED".equals(action)) {
            schedule(context);
            return;
        }
        if (ACTION_FIRE.equals(action)) {
            schedule(context); // line up the next one first
            playRandom(context, goAsync());
        }
    }

    /** Plays one random stored sound and shows the DONT! notification. */
    static void playRandom(Context context, PendingResult pending) {
        final Context c = context.getApplicationContext();
        File[] files = DontPlugin.soundDir(c).listFiles((d, n) -> n.endsWith(".wav"));
        if (files == null || files.length == 0) { if (pending != null) pending.finish(); return; }
        File f = files[new Random().nextInt(files.length)];
        String id = f.getName().replace(".wav", "");
        String name = "a sound";
        try {
            JSONObject names = new JSONObject(prefs(c).getString("names", "{}"));
            name = names.optString(id, name);
        } catch (Exception ignored) {}

        notifyPlaying(c, name);

        final AtomicBoolean done = new AtomicBoolean(false);
        final MediaPlayer mp = new MediaPlayer();
        final Handler h = new Handler(Looper.getMainLooper());
        final Runnable finish = () -> {
            if (done.getAndSet(true)) return;
            try { mp.release(); } catch (Exception ignored) {}
            if (pending != null) pending.finish();
        };
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            mp.setDataSource(f.getAbsolutePath());
            mp.setOnCompletionListener(p -> finish.run());
            mp.setOnErrorListener((p, w, e) -> { finish.run(); return true; });
            mp.prepare();
            mp.start();
            h.postDelayed(finish, 12_000); // sounds are max 10 s; never hang
        } catch (Exception e) {
            finish.run();
        }
    }

    static void notifyPlaying(Context c, String name) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "DONT!", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Random sounds from your board");
            ch.setSound(null, null); // the sound itself is the alert
            nm.createNotificationChannel(ch);
        }
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(c, 2, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(c, CHANNEL)
            : new Notification.Builder(c);
        b.setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle("DONT!")
            .setContentText("Playing " + name)
            .setAutoCancel(true);
        if (pi != null) b.setContentIntent(pi);
        try { nm.notify(NOTIF_ID, b.build()); } catch (SecurityException ignored) {}
    }
}
