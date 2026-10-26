package com.docto110.soundz;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DontPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
