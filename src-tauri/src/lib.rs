use std::path::Path;
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
    if ext=="wav" {
        // Native fast path remains available for WAV when ffmpeg is not installed.
        match audio_core::wav(p) {
            Ok(result)=>Ok(result),
            Err(_)=>audio_core::ffmpeg::decode_preview(p)
        }
    } else if matches!(ext.as_str(), "raw"|"pcm"|"bin") {
        Err("Raw PCM requires import format settings".into())
    } else {
        audio_core::ffmpeg::decode_preview(p)
    }
}
#[tauri::command]
fn probe_ffmpeg()->String{
    audio_core::ffmpeg::availability()
}
pub fn run(){
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![analyze_demo,analyze_file,probe_ffmpeg])
        .run(tauri::generate_context!())
        .expect("unable to start Audio Analyzer");
}
