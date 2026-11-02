package local.fakepay.terminal;

import android.app.Activity;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Bundle;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Определяет ФАКТ касания любой NFC-метки/карты/телефона.
 * Данные карты НЕ читаются: даже идентификатор метки не запрашивается.
 * Работает через Reader Mode — только пока приложение на экране.
 */
@CapacitorPlugin(name = "NfcTap")
public class NfcTapPlugin extends Plugin {

    private NfcAdapter adapter;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        NfcAdapter a = NfcAdapter.getDefaultAdapter(getContext());
        JSObject res = new JSObject();
        res.put("supported", a != null);
        res.put("enabled", a != null && a.isEnabled());
        call.resolve(res);
    }

    @PluginMethod
    public void start(final PluginCall call) {
        final Activity activity = getActivity();
        adapter = NfcAdapter.getDefaultAdapter(activity);
        if (adapter == null) {
            call.reject("NFC не поддерживается на этом устройстве");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("NFC выключен в настройках телефона");
            return;
        }
        final int flags = NfcAdapter.FLAG_READER_NFC_A
                | NfcAdapter.FLAG_READER_NFC_B
                | NfcAdapter.FLAG_READER_NFC_F
                | NfcAdapter.FLAG_READER_NFC_V
                | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;

        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    adapter.enableReaderMode(activity, new NfcAdapter.ReaderCallback() {
                        @Override
                        public void onTagDiscovered(Tag tag) {
                            notifyListeners("tag", new JSObject());
                        }
                    }, flags, new Bundle());
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Не удалось включить NFC: " + e.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        final Activity activity = getActivity();
        if (adapter == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    adapter.disableReaderMode(activity);
                } catch (Exception ignored) {
                    // уже отключён
                }
                call.resolve();
            }
        });
    }

    @Override
    protected void handleOnPause() {
        try {
            if (adapter != null && getActivity() != null) adapter.disableReaderMode(getActivity());
        } catch (Exception ignored) {
            // ничего
        }
    }
}
