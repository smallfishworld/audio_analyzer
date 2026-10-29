use std::path::Path;
use std::process::Command;
use audio_core::{RawSpec,AnalysisSnapshot};
#[tauri::command]
fn analyze_demo()->AnalysisSnapshot{audio_core::demo()}
#[tauri::command]
async fn analyze_file(path:String,raw_spec:Option<RawSpec>)->Result<AnalysisSnapshot,String>{
    // Keep parsing/FFT off the webview/main command executor.
    tauri::async_runtime::spawn_blocking(move || analyze_file_blocking(path,raw_spec))
        .await.map_err(|e|format!("Audio task failed: {e}"))?
}
fn analyze_file_blocking(path:String,raw_spec:Option<RawSpec>)->Result<AnalysisSnapshot,String>{
    let p=Path::new(&path);
    if !p.is_file(){return Err("File does not exist".into());}
    if let Some(spec)=raw_spec{return audio_core::pcm(p,&spec);}
    let ext=p.extension().and_then(|x|x.to_str()).unwrap_or("").to_ascii_lowercase();
    if ext=="wav"{audio_core::wav(p)}
    else{Err("M0 supports WAV and configurable raw PCM preview; other formats in M1".into())}
}
#[tauri::command]
fn probe_ffmpeg()->String{
    match Command::new("ffprobe").arg("-version").output(){
        Ok(x) if x.status.success()=>String::from_utf8_lossy(&x.stdout).lines().next().unwrap_or("ffprobe available").chars().take(58).collect(),
        _=>"ffprobe unavailable (sidecar planned M1)".into()
    }
}
pub fn run(){
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![analyze_demo,analyze_file,probe_ffmpeg])
        .run(tauri::generate_context!())
        .expect("unable to start Audio Analyzer");
}
