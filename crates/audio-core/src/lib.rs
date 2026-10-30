pub mod ffmpeg;
mod process;
mod streaming;
pub use ffmpeg::AudioMetadata;
use realfft::RealFftPlanner;
use serde::{Deserialize, Serialize};
use std::path::Path;
const FFT_N: usize = 4096;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub struct RawSpec {
    pub sample_rate_hz:u32, pub channels:u16, pub sample_format:String,
    pub endianness:String, pub byte_offset:u64,
    #[serde(default = "default_layout")]
    pub layout:String
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct WavePoint { pub time_sec:f64, pub min:f64, pub max:f64 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SpectrumPoint { pub frequency_hz:f64, pub dbfs:Option<f64> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct AnalysisSnapshot {
    pub name:String, pub source_type:String, pub sample_rate_hz:u32, pub channels:u16,
    pub analyzed_frames:usize, pub preview_limited:bool,
    pub selected_channel:usize,
    pub fft_window_start_sec:Option<f64>,
    pub peak_dbfs:Option<f64>, pub rms_dbfs:Option<f64>,
    pub dominant_frequency_hz:Option<f64>,
    pub waveform:Vec<WavePoint>, pub spectrum:Vec<SpectrumPoint>,
    pub metadata:Option<AudioMetadata>
}
fn default_layout() -> String { "interleaved".into() }
fn level(n:f64)->Option<f64>{if n.is_finite() && n>0.0{Some(20.0*n.log10())}else{None}}
fn validate(rate:u32,channels:u16)->Result<(),String>{
    if !(1..=768000).contains(&rate) || !(1..=16).contains(&channels) {
        return Err("Sample rate must be 1..768000 Hz; channels 1..16".into());
    } Ok(())
}
pub fn analyze(name:&str, kind:&str,rate:u32,channels:u16,samples:&[f64],limited:bool)->Result<AnalysisSnapshot,String>{
    validate(rate,channels)?;
    if samples.is_empty(){return Err("No audio frames".into());}
    if samples.iter().any(|x|!x.is_finite()){return Err("Invalid NaN/Inf audio samples".into());}
    let peak=samples.iter().fold(0.0_f64,|a,v|a.max(v.abs()));
    let rms=(samples.iter().map(|x|x*x).sum::<f64>()/samples.len() as f64).sqrt();
    let stride=((samples.len()+1199)/1200).max(1);
    let waveform=samples.chunks(stride).enumerate().map(|(i,v)|WavePoint{
        time_sec:(i*stride) as f64/rate as f64,
        min:v.iter().copied().fold(f64::INFINITY,f64::min),
        max:v.iter().copied().fold(f64::NEG_INFINITY,f64::max),
    }).collect();
    let mut spectrum=Vec::new();
    let mut dominant=None;
    if samples.len()>=FFT_N {
        let mut planner=RealFftPlanner::<f64>::new();
        let fft=planner.plan_fft_forward(FFT_N);
        let mut input=fft.make_input_vec();
        let mut output=fft.make_output_vec();
        let mut sum=0.0;
        for (i,v) in input.iter_mut().enumerate(){
            let w=0.5-0.5*(2.0*std::f64::consts::PI*i as f64/(FFT_N-1) as f64).cos();
            *v=samples[i]*w;sum+=w;
        }
        fft.process(&mut input,&mut output).map_err(|e|e.to_string())?;
        let mut best=(0,0.0_f64);
        for (i,c) in output.iter().enumerate(){
            let gain=if i==0 || i==FFT_N/2 {1.0}else{2.0};
            let a=c.norm()*gain/sum;
            if i>0 && a>best.1 {best=(i,a);}
            spectrum.push(SpectrumPoint{frequency_hz:i as f64*rate as f64/FFT_N as f64,dbfs:level(a)});
        }
        if best.1>0.0{dominant=Some(best.0 as f64*rate as f64/FFT_N as f64);}
    }
    Ok(AnalysisSnapshot{
        name:name.into(),source_type:kind.into(),sample_rate_hz:rate,channels,
        analyzed_frames:samples.len(),preview_limited:limited,selected_channel:0,
        fft_window_start_sec:Some(0.0),
        peak_dbfs:level(peak),rms_dbfs:level(rms),dominant_frequency_hz:dominant,waveform,spectrum,
        metadata:None
    })
}
pub fn demo()->AnalysisSnapshot{
    let rate=48000;
    let samples:Vec<_>=(0..96000).map(|i|{
        let t=i as f64/rate as f64;
        0.55*(2.0*std::f64::consts::PI*1000.0*t).sin()
        +0.15*(2.0*std::f64::consts::PI*7000.0*t).sin()
    }).collect();
    analyze("Studio demo","Synthesized 1 kHz + 7 kHz",rate,1,&samples,false).unwrap()
}
pub fn wav(path:&Path)->Result<AnalysisSnapshot,String>{ wav_channel(path,0) }
pub fn wav_channel(path:&Path,channel:usize)->Result<AnalysisSnapshot,String>{
    wav_channel_at(path,channel,0.0)
}
pub fn wav_channel_at(path:&Path,channel:usize,fft_start_sec:f64)->Result<AnalysisSnapshot,String>{
    streaming::wav_full(path,channel,fft_start_sec)
}
pub fn pcm(path:&Path,spec:&RawSpec)->Result<AnalysisSnapshot,String>{pcm_channel(path,spec,0)}
pub fn pcm_channel(path:&Path,spec:&RawSpec,channel:usize)->Result<AnalysisSnapshot,String>{
    pcm_channel_at(path,spec,channel,0.0)
}
pub fn pcm_channel_at(path:&Path,spec:&RawSpec,channel:usize,fft_start_sec:f64)->Result<AnalysisSnapshot,String>{
    streaming::pcm_full(path,spec,channel,fft_start_sec)
}
#[cfg(test)]
mod tests{
use super::*;
#[test] fn pcm_s16le_stereo_first_channel() {
    use std::io::Write;
    let path=std::env::temp_dir().join(format!("aa_m0_pcm_{}_{}.pcm",std::process::id(),std::thread::current().name().unwrap_or("test")));
    {let mut file=std::fs::File::create(&path).unwrap();file.write_all(&[0,128,0,0,255,127,0,0]).unwrap();}
    let s=RawSpec{sample_rate_hz:48000,channels:2,sample_format:"s16".into(),endianness:"little".into(),byte_offset:0,layout:"interleaved".into()};
    let v=pcm(&path,&s).unwrap();
    assert_eq!(v.analyzed_frames,2);
    assert!((v.peak_dbfs.unwrap()-0.0).abs()<0.0001);
    std::fs::remove_file(path).unwrap();
}

#[test] fn raw_planar_and_interleaved_channels() {
    let path=std::env::temp_dir().join(format!("aa_planar_{}.pcm",std::process::id()));
    // Planar: channel A [-32768, 32767], channel B [0, 0].
    std::fs::write(&path,[0,128,255,127,0,0,0,0]).unwrap();
    let raw=RawSpec{sample_rate_hz:48000,channels:2,sample_format:"s16".into(),
        endianness:"little".into(),byte_offset:0,layout:"planar".into()};
    let out=pcm(&path,&raw).unwrap();
    assert_eq!(out.analyzed_frames,2);
    assert_eq!(out.peak_dbfs,Some(0.0));
    assert_eq!(out.metadata.unwrap().channels,2);
    std::fs::remove_file(path).unwrap();
}
#[test] fn pcm_channels_are_independently_selected() {
    let path=std::env::temp_dir().join(format!("aa_m1_channels_{}.pcm",std::process::id()));
    std::fs::write(&path,[0,0,0,128,0,0,0,128,0,0,0,128]).unwrap();
    let spec=RawSpec{sample_rate_hz:48000,channels:2,sample_format:"s16".into(),
        endianness:"little".into(),byte_offset:0,layout:"interleaved".into()};
    assert_eq!(pcm_channel(&path,&spec,0).unwrap().rms_dbfs,None);
    let selected=pcm_channel(&path,&spec,1).unwrap();
    assert_eq!(selected.rms_dbfs,Some(0.0));
    assert_eq!(selected.selected_channel,1);
    assert!(pcm_channel(&path,&spec,2).is_err());
    std::fs::remove_file(&path).unwrap();
}
#[test] fn planar_second_channel_is_independent() {
    let path=std::env::temp_dir().join(format!("aa_m1_planes_{}.pcm",std::process::id()));
    std::fs::write(&path,[0,0,0,0,0,128,0,128]).unwrap();
    let spec=RawSpec{sample_rate_hz:48000,channels:2,sample_format:"s16".into(),
        endianness:"little".into(),byte_offset:0,layout:"planar".into()};
    assert_eq!(pcm_channel(&path,&spec,0).unwrap().rms_dbfs,None);
    assert_eq!(pcm_channel(&path,&spec,1).unwrap().rms_dbfs,Some(0.0));
    std::fs::remove_file(&path).unwrap();
}
#[test] fn multi_megabyte_pcm_is_scanned_with_bounded_output() {
    use std::fs::File;
    let path=std::env::temp_dir().join(format!("aa_sparse_gb_{}.pcm",std::process::id()));
    let file=File::create(&path).unwrap();
    file.set_len(8_388_608).unwrap(); // Sparse 8 MiB full-file scan.
    drop(file);
    let spec=RawSpec{sample_rate_hz:48000,channels:1,sample_format:"s16".into(),
        endianness:"little".into(),byte_offset:0,layout:"interleaved".into()};
    let out=pcm(&path,&spec).unwrap();
    assert_eq!(out.analyzed_frames,4_194_304);
    assert!(!out.preview_limited);
    assert!(out.waveform.len() <= 1_200);
    assert_eq!(out.rms_dbfs,None);
    std::fs::remove_file(&path).unwrap();
}
#[test] fn full_pcm_includes_samples_after_three_seconds() {
    use std::io::Write;
    let path=std::env::temp_dir().join(format!("aa_full_pcm_{}.pcm",std::process::id()));
    let mut file=std::fs::File::create(&path).unwrap();
    let rate=48000u32;
    let count=rate*5;
    for i in 0..count {
        let v=if i < rate*4 { 0_i16 } else {
            (16384.0_f64*(2.0*std::f64::consts::PI*1000.0*i as f64/rate as f64).sin()) as i16
        };
        file.write_all(&v.to_le_bytes()).unwrap();
    }
    drop(file);
    let fmt=RawSpec{sample_rate_hz:rate,channels:1,sample_format:"s16".into(),
        endianness:"little".into(),byte_offset:0,layout:"interleaved".into()};
    let out=pcm_channel_at(&path,&fmt,0,4.2).unwrap();
    assert_eq!(out.analyzed_frames,5*rate as usize);
    assert!(!out.preview_limited);
    assert!(out.peak_dbfs.unwrap() > -6.2);
    assert!(out.rms_dbfs.unwrap() < -14.9);
    assert!(out.waveform.last().unwrap().time_sec > 4.9);
    assert_eq!(out.fft_window_start_sec,Some(4.2));
    assert!((out.dominant_frequency_hz.unwrap()-1000.0).abs()<12.0);
    std::fs::remove_file(path).unwrap();
}
#[test] fn full_pcm_planar_late_second_channel() {
    use std::io::Write;
    let path=std::env::temp_dir().join(format!("aa_full_planar_{}.pcm",std::process::id()));
    let mut file=std::fs::File::create(&path).unwrap();
    let rate=1000u32;
    for _ in 0..(rate*5) {file.write_all(&0_i16.to_le_bytes()).unwrap();}
    for i in 0..(rate*5) {
        let s=if i>=rate*4 {-32768_i16} else {0_i16};
        file.write_all(&s.to_le_bytes()).unwrap();
    }
    drop(file);
    let fmt=RawSpec{sample_rate_hz:rate,channels:2,sample_format:"s16".into(),
        endianness:"little".into(),byte_offset:0,layout:"planar".into()};
    let a=pcm_channel(&path,&fmt,0).unwrap();
    let b=pcm_channel(&path,&fmt,1).unwrap();
    assert_eq!(a.rms_dbfs,None);
    assert_eq!(b.peak_dbfs,Some(0.0));
    assert_eq!(b.analyzed_frames,5000);
    assert!(b.rms_dbfs.unwrap()< -6.9);
    assert!(b.waveform.last().unwrap().max<0.0);
    std::fs::remove_file(path).unwrap();
}
#[test] fn full_wav_includes_tail_and_reports_full_duration() {
    let path=std::env::temp_dir().join(format!("aa_full_wav_{}.wav",std::process::id()));
    let spec=hound::WavSpec{channels:1,sample_rate:48000,bits_per_sample:16,
        sample_format:hound::SampleFormat::Int};
    let mut writer=hound::WavWriter::create(&path,spec).unwrap();
    for i in 0..(48000*4) {
        writer.write_sample(if i>=48000*3 {-32768_i16} else {0_i16}).unwrap();
    }
    writer.finalize().unwrap();
    let out=wav_channel_at(&path,0,3.4).unwrap();
    assert_eq!(out.analyzed_frames,192000);
    assert!(!out.preview_limited);
    assert_eq!(out.peak_dbfs,Some(0.0));
    assert!((out.rms_dbfs.unwrap()+6.020599913).abs()<0.000001);
    assert_eq!(out.fft_window_start_sec,Some(3.4));
    assert_eq!(out.metadata.unwrap().duration_seconds,Some(4.0));
    std::fs::remove_file(path).unwrap();
}
#[test] fn raw_s24_endian_sign_extension() {
    let path=std::env::temp_dir().join(format!("aa_release_s24_{}.pcm",std::process::id()));
    for (endianness, bytes) in [
        ("little", [0x00_u8,0x00,0x80]),
        ("big", [0x80_u8,0x00,0x00])
    ] {
        std::fs::write(&path,bytes).unwrap();
        let raw=RawSpec{
            sample_rate_hz:192000,channels:1,sample_format:"s24".into(),
            endianness:endianness.into(),byte_offset:0,layout:"interleaved".into()
        };
        let result=pcm_channel(&path,&raw,0).unwrap();
        assert_eq!(result.rms_dbfs,Some(0.0),"wrong {endianness} sign extension");
        assert_eq!(result.peak_dbfs,Some(0.0));
    }
    std::fs::remove_file(path).unwrap();
}
#[test] fn raw_f32_uses_actual_float_range() {
    let path=std::env::temp_dir().join(format!("aa_release_float_{}.pcm",std::process::id()));
    let mut bytes=Vec::new();
    bytes.extend_from_slice(&0.5_f32.to_le_bytes());
    bytes.extend_from_slice(&(-0.5_f32).to_le_bytes());
    std::fs::write(&path,bytes).unwrap();
    let raw=RawSpec{
        sample_rate_hz:48000,channels:1,sample_format:"f32".into(),
        endianness:"little".into(),byte_offset:0,layout:"interleaved".into()
    };
    let result=pcm(&path,&raw).unwrap();
    assert!((result.peak_dbfs.unwrap()+6.020599913).abs()<0.000001);
    assert!((result.rms_dbfs.unwrap()+6.020599913).abs()<0.000001);
    std::fs::remove_file(path).unwrap();
}
#[test] fn high_frequency_47khz_is_resolved_at_192khz() {
    let rate=192000u32;
    let tone=47000.0;
    let signal:Vec<_>=(0..FFT_N).map(|i|
        0.6*(2.0*std::f64::consts::PI*tone*i as f64/rate as f64).sin()
    ).collect();
    let result=analyze("47k","test",rate,1,&signal,false).unwrap();
    assert_eq!(result.spectrum.last().unwrap().frequency_hz,rate as f64/2.0);
    assert!((result.dominant_frequency_hz.unwrap()-tone).abs()<=rate as f64/FFT_N as f64);
}
#[test] fn zero_is_silent(){let v=analyze("silence","test",48000,1,&vec![0.0;4096],false).unwrap();assert_eq!(v.rms_dbfs,None);assert_eq!(v.peak_dbfs,None);}
#[test] fn sine_rms_minus_three_db(){let s:Vec<_>=(0..48000).map(|i|(2.0*std::f64::consts::PI*1000.0*i as f64/48000.0).sin()).collect();let v=analyze("sine","test",48000,1,&s,false).unwrap();assert!((v.rms_dbfs.unwrap()+3.01029995664).abs()<0.001);}
#[test] fn fft_bin_gain(){let s:Vec<_>=(0..4096).map(|i|0.5*(2.0*std::f64::consts::PI*128.0*i as f64/4096.0).sin()).collect();let v=analyze("sine","test",48000,1,&s,false).unwrap();assert!((v.spectrum[128].dbfs.unwrap()+6.020599913).abs()<0.02);}
}
