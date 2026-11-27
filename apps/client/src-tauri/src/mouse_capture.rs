use serde::Serialize;
use tauri::WebviewWindow;

#[derive(Serialize)]
pub struct MouseDelta {
    active: bool,
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn rift_mouse_start() -> bool;
    fn rift_mouse_stop();
    fn rift_mouse_take(x: *mut f64, y: *mut f64) -> bool;
}

#[tauri::command]
pub async fn desktop_mouse_start(window: WebviewWindow) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            let started = unsafe { rift_mouse_start() };
            #[cfg(not(target_os = "macos"))]
            let started = false;
            let _ = tx.send(started);
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn desktop_mouse_stop(window: WebviewWindow) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            unsafe {
                rift_mouse_stop()
            };
            let _ = tx.send(());
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn desktop_mouse_take() -> MouseDelta {
    #[cfg(target_os = "macos")]
    {
        let mut result = MouseDelta { active: false, x: 0.0, y: 0.0 };
        result.active = unsafe { rift_mouse_take(&mut result.x, &mut result.y) };
        result
    }
    #[cfg(not(target_os = "macos"))]
    MouseDelta { active: false, x: 0.0, y: 0.0 }
}
