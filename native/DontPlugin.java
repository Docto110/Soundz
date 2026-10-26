package com.docto110.soundz;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;

/**
 * "DONT!" mode: plays a random sound from the board every so often,
 * even when the app is closed. JS gives us ready-to-play WAV files
 * (already trimmed and faded); an alarm does the rest.
 */
@CapacitorPlugin(
    name = "Dont",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class DontPlugin extends Plugin {

    static final String PREFS = "dont";

    static File soundDir(Context c) {
        File d = new File(c.getFilesDir(), "dont");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Replace all stored sounds: items = [{ id, name, data (base64 wav) }] */
    @PluginMethod
    public void setSounds(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null) { call.reject("items missing"); return; }
        Context c = getContext();
        try {
            File dir = soundDir(c);
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            JSONObject names = new JSONObject();
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.getJSONObject(i);
                String id = it.getString("id").replaceAll("[^A-Za-z0-9_-]", "_");
                byte[] bytes = Base64.decode(it.getString("data"), Base64.DEFAULT);
                try (FileOutputStream out = new FileOutputStream(new File(dir, id + ".wav"))) {
                    out.write(bytes);
                }
                names.put(id, it.optString("name", "Sound"));
            }
            c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("names", names.toString()).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save sounds: " + e.getMessage());
        }
    }

    /** Turn on: { minutes } */
    @PluginMethod
    public void enable(PluginCall call) {
        int minutes = call.getInt("minutes", 20);
        Context c = getContext();
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("on", true).putInt("minutes", minutes).apply();
        DontReceiver.schedule(c);
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        Context c = getContext();
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("on", false).apply();
        DontReceiver.cancel(c);
        call.resolve();
    }

    /** Plays one random sound right now (used for a quick test). */
    @PluginMethod
    public void playNow(PluginCall call) {
        DontReceiver.playRandom(getContext(), null);
        call.resolve();
    }

    @PluginMethod
    public void notificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject(); r.put("granted", true); call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "permCallback");
    }

    @PermissionCallback
    private void permCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }
}
