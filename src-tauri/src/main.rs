#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
#[link(name = "winmm")]
extern "system" {
    fn PlaySoundW(sound: *const u16, module: isize, flags: u32) -> i32;
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Connection {
    port: u16,
    token: String,
}

struct Service {
    connection: Connection,
    child: Mutex<Child>,
}

struct ShortcutAvailable(bool);

impl Drop for Service {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn connection(state: tauri::State<Service>) -> Connection {
    state.connection.clone()
}

#[tauri::command]
fn quick_capture_shortcut_available(state: tauri::State<ShortcutAvailable>) -> bool {
    state.0
}

#[tauri::command]
async fn save_document(data: String, name: String) -> Result<bool, String> {
    if data.len() > 32 * 1024 * 1024 {
        return Err("Archivo demasiado grande".into());
    }

    let safe_name = std::path::Path::new(&name)
        .file_name()
        .ok_or("Nombre inválido")?
        .to_string_lossy()
        .to_string();
    let ext = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|value| value.to_str())
        .ok_or("Extensión inválida")?
        .to_string();
    if !["md", "csv", "docx", "pdf", "backup"].contains(&ext.as_str()) {
        return Err("Formato no permitido".into());
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Contenido inválido")?;
    let target = rfd::AsyncFileDialog::new()
        .set_file_name(&safe_name)
        .add_filter("Documento de Bitácora", &[&ext])
        .save_file()
        .await;
    if let Some(file) = target {
        file.write(&bytes)
            .await
            .map_err(|_| "No se pudo guardar el archivo")?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(windows)]
fn proposal_sound_wav() -> Vec<u8> {
    const SAMPLE_RATE: u32 = 22_050;
    let sample_count = SAMPLE_RATE * 44 / 100;
    let data_size = sample_count * 2;
    let mut wav = Vec::with_capacity(44 + data_size as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_size).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());

    for sample in 0..sample_count {
        let time = sample as f32 / SAMPLE_RATE as f32;
        let (note_time, frequency) = if time < 0.22 {
            (time, 660.0)
        } else {
            (time - 0.22, 880.0)
        };
        let envelope = (note_time / 0.02).min(1.0) * ((0.2 - note_time) / 0.05).clamp(0.0, 1.0);
        let value = (std::f32::consts::TAU * frequency * note_time).sin() * envelope * 9_000.0;
        wav.extend_from_slice(&(value as i16).to_le_bytes());
    }
    wav
}

#[tauri::command]
async fn play_proposal_sound() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::thread::Builder::new()
            .name("bitacora-proposal-sound".into())
            .spawn(|| {
                let wav = proposal_sound_wav();
                // SND_MEMORY | SND_NODEFAULT; la llamada síncrona conserva vivo el búfer.
                unsafe { PlaySoundW(wav.as_ptr().cast(), 0, 0x0004 | 0x0002) };
            })
            .map_err(|error| error.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Audio nativo no disponible".into())
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if let ShortcutState::Pressed = event.state() {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("quick-capture", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let resources = app.path().resource_dir()?;
            let service_dir = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/service")
            } else {
                resources.join("service")
            };
            let exe_dir = std::env::current_exe()?
                .parent()
                .ok_or("No se encontró el directorio de la aplicación")?
                .to_path_buf();
            let node_name = if cfg!(windows) {
                "bitacora-node.exe"
            } else {
                "bitacora-node"
            };
            let mut cmd = Command::new(exe_dir.join(node_name));
            cmd.arg(service_dir.join("server.cjs"))
                .env("BITACORA_WASM", service_dir.join("sql-wasm.wasm"))
                .env("BITACORA_MCP_PATH", service_dir.join("mcp.cjs"))
                .env("BITACORA_PARENT_PID", std::process::id().to_string())
                .env_remove("NODE_OPTIONS")
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .stdin(Stdio::null());
            if cfg!(debug_assertions) {
                cmd.env("BITACORA_DEV", "1");
            }
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);

            let mut child = cmd.spawn()?;
            let stdout = child
                .stdout
                .take()
                .ok_or("No se pudo conectar con el servicio local")?;
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut line = String::new();
                let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
                let _ = tx.send(result);
            });

            let line = match rx.recv_timeout(Duration::from_secs(20)) {
                Ok(Ok(line)) => line,
                _ => {
                    let _ = child.kill();
                    return Err("El servicio local no respondió".into());
                }
            };
            let connection: Connection = match serde_json::from_str(&line) {
                Ok(connection) => connection,
                Err(_) => {
                    let _ = child.kill();
                    return Err(
                        "No se pudo abrir Bitácora. Comprueba que no esté ya abierta.".into(),
                    );
                }
            };
            app.manage(Service {
                connection,
                child: Mutex::new(child),
            });
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyB);
            app.manage(ShortcutAvailable(
                app.global_shortcut().register(shortcut).is_ok(),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connection,
            quick_capture_shortcut_available,
            save_document,
            play_proposal_sound
        ])
        .build(tauri::generate_context!())
        .expect("No se pudo iniciar Bitácora");

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(service) = app.try_state::<Service>() {
                if let Ok(mut child) = service.child.lock() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
