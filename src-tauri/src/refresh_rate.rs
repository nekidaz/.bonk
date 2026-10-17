// --- macOS: let the webview render at the display's rate (120 Hz on ProMotion) ---
//
// WKWebView caps page rendering (and requestAnimationFrame) near 60 fps through the internal
// WebKit preference `PreferPageRenderingUpdatesNear60FPSEnabled`; there is no public API to lift
// it (WebKit bug 294338). This flips it off through WebKit's private feature-flag API, the one
// Safari's Develop → Feature Flags menu uses. If a macOS update removes any of it, nothing
// happens and bonk stays at 60 fps. Check the result in the Resources tab (FPS).

#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject, Bool};
#[cfg(target_os = "macos")]
use objc2::{msg_send, sel};

#[cfg(target_os = "macos")]
const FLAG: &[u8] = b"PreferPageRenderingUpdatesNear60FPSEnabled";

#[cfg(target_os = "macos")]
pub fn unlock(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        let ptr = webview.inner() as *mut AnyObject;
        // objc2 checks message types in debug builds and panics on a mismatch: never let a
        // private-API surprise take the app down at launch.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
            let config: *mut AnyObject = msg_send![ptr.as_ref()?, configuration];
            let prefs: *mut AnyObject = msg_send![config.as_ref()?, preferences];
            disable_60fps_cap(prefs.as_ref()?)
        }));
    });
}

#[cfg(not(target_os = "macos"))]
pub fn unlock(_window: &tauri::WebviewWindow) {}

/// Turns the 60 fps preference off on `prefs` (a WKPreferences). `None` when WebKit lacks the
/// private API or the flag. Like Go calling into C: every step checks for nil.
#[cfg(target_os = "macos")]
unsafe fn disable_60fps_cap(prefs: &AnyObject) -> Option<()> {
    let feature = find_flag()?;
    let can_set: Bool = msg_send![prefs, respondsToSelector: sel!(_setEnabled:forFeature:)];
    if !can_set.as_bool() {
        return None;
    }
    let _: () = msg_send![prefs, _setEnabled: Bool::NO, forFeature: feature];
    Some(())
}

/// The `_WKFeature` for FLAG from `+[WKPreferences _features]`.
#[cfg(target_os = "macos")]
unsafe fn find_flag() -> Option<&'static AnyObject> {
    use std::ffi::{c_char, CStr};
    let class = AnyClass::get(c"WKPreferences")?;
    let has_features: Bool = msg_send![class, respondsToSelector: sel!(_features)];
    if !has_features.as_bool() {
        return None;
    }
    let features: *mut AnyObject = msg_send![class, _features];
    let features = features.as_ref()?;
    let count: usize = msg_send![features, count];
    (0..count).find_map(|i| {
        let feature: *mut AnyObject = msg_send![features, objectAtIndex: i];
        let feature = feature.as_ref()?;
        let key: *mut AnyObject = msg_send![feature, key];
        let utf8: *const c_char = msg_send![key.as_ref()?, UTF8String];
        (!utf8.is_null() && CStr::from_ptr(utf8).to_bytes() == FLAG).then_some(feature)
    })
}

// No unit test: WebKit initialises only on the main thread, and libtest runs tests on worker
// threads (they die with SIGTRAP in WebKit::runInitializationCode). Verified on macOS 26.2 with
// a standalone binary: a fresh WKPreferences reports the flag on, and off after disable_60fps_cap.
