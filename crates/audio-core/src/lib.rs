pub mod ffmpeg;
mod process;
pub use ffmpeg::AudioMetadata;
use realfft::RealFftPlanner;
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, SeekFrom};
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
fn limit(rate:u32)->usize{(rate as usize).saturating_mul(3).min(576000)}
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
        analyzed_frames:samples.len(),preview_limited:limited,
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
pub fn wav(path:&Path)->Result<AnalysisSnapshot,String>{
    let mut reader=hound::WavReader::open(path).map_err(|e|e.to_string())?;
    let spec=reader.spec();validate(spec.sample_rate,spec.channels)?;
    let available=reader.duration() as usize;
    let frames=available.min(limit(spec.sample_rate));
    let count=frames.saturating_mul(spec.channels as usize);
    let mut samples=Vec::with_capacity(frames);
    match spec.sample_format {
        hound::SampleFormat::Float=>{
            for (i,r) in reader.samples::<f32>().take(count).enumerate(){
                let v=r.map_err(|e|e.to_string())?;
                if i%spec.channels as usize==0{samples.push(v as f64);}
            }
        },
        hound::SampleFormat::Int=>{
            if spec.bits_per_sample<1 || spec.bits_per_sample>32{return Err("Unsupported WAV bit depth".into());}
            let div=2_f64.powi(spec.bits_per_sample as i32-1);
            for (i,r) in reader.samples::<i32>().take(count).enumerate(){
                let v=r.map_err(|e|e.to_string())?;
                if i%spec.channels as usize==0{samples.push(v as f64/div);}
            }
        }
    }
    let mut snapshot = analyze(&path.file_name().unwrap_or_default().to_string_lossy(),"WAV first-channel preview",spec.sample_rate,spec.channels,&samples,available>frames)?;
    snapshot.metadata = Some(AudioMetadata {
        container:"wav".into(),codec:format!("pcm_{}bit",spec.bits_per_sample),
        sample_rate_hz:spec.sample_rate,channels:spec.channels,
        duration_seconds:Some(available as f64/spec.sample_rate as f64),
        bit_rate_bps:Some(spec.sample_rate as u64 * spec.channels as u64 * spec.bits_per_sample as u64),
        bits_per_sample:Some(spec.bits_per_sample),file_bytes:std::fs::metadata(path).map_err(|e|e.to_string())?.len(),
        audio_stream_index:0
    });
    Ok(snapshot)
}
pub fn pcm(path:&Path,spec:&RawSpec)->Result<AnalysisSnapshot,String>{
    validate(spec.sample_rate_hz,spec.channels)?;
    let width=match spec.sample_format.as_str(){"u8"|"s8"=>1,"s16"=>2,"s24"=>3,"s32"|"f32"=>4,"f64"=>8,_=>return Err("Invalid PCM format".into())};
    let le=match spec.endianness.as_str(){"little"=>true,"big"=>false,_=>return Err("Invalid endianness".into())};
    if spec.layout != "planar" && spec.layout != "interleaved" {
        return Err("PCM layout must be interleaved or planar".into());
    }
    let frame_bytes=width*spec.channels as usize;
    let mut file=std::fs::File::open(path).map_err(|e|e.to_string())?;
    let bytes=file.metadata().map_err(|e|e.to_string())?.len();
    if spec.byte_offset>=bytes{return Err("PCM header offset exceeds file size".into());}
    let available_u64=(bytes-spec.byte_offset)/frame_bytes as u64;
    if available_u64>usize::MAX as u64 { return Err("PCM frame count is too large".into()); }
    let available=available_u64 as usize;
    let count=available.min(limit(spec.sample_rate_hz));
    if count==0 { return Err("PCM has no complete frames".into()); }
    file.seek(SeekFrom::Start(spec.byte_offset)).map_err(|e|e.to_string())?;
    let mut frame=vec![0u8;frame_bytes];
    let mut samples=Vec::with_capacity(count);
    for _ in 0..count {
        if spec.layout=="planar" {
            file.read_exact(&mut frame[..width]).map_err(|e|e.to_string())?;
        } else {
            file.read_exact(&mut frame).map_err(|e|e.to_string())?;
        }
        let b=&frame[..width];
        let val=match spec.sample_format.as_str(){
            "u8"=>(b[0] as f64-128.0)/128.0,
            "s8"=>b[0] as i8 as f64/128.0,
            "s16"=>(if le{i16::from_le_bytes([b[0],b[1]])}else{i16::from_be_bytes([b[0],b[1]])}) as f64/32768.0,
            "s24"=>{
                let u=if le{(b[0] as i32)|((b[1] as i32)<<8)|((b[2] as i32)<<16)}
                    else{(b[2] as i32)|((b[1] as i32)<<8)|((b[0] as i32)<<16)};
                ((u<<8)>>8) as f64/8388608.0
            },
            "s32"=>(if le{i32::from_le_bytes(b.try_into().unwrap())}else{i32::from_be_bytes(b.try_into().unwrap())}) as f64/2147483648.0,
            "f32"=>(if le{f32::from_le_bytes(b.try_into().unwrap())}else{f32::from_be_bytes(b.try_into().unwrap())}) as f64,
            "f64"=>if le{f64::from_le_bytes(b.try_into().unwrap())}else{f64::from_be_bytes(b.try_into().unwrap())},
            _=>unreachable!()
        };
        samples.push(val);
    }
    let mut snapshot=analyze(&path.file_name().unwrap_or_default().to_string_lossy(),
        &format!("Raw {} PCM first channel",spec.layout),spec.sample_rate_hz,spec.channels,&samples,available>count)?;
    snapshot.metadata = Some(AudioMetadata {
        container:"raw".into(),codec:spec.sample_format.clone(),
        sample_rate_hz:spec.sample_rate_hz,channels:spec.channels,
        duration_seconds:Some(available as f64/spec.sample_rate_hz as f64),
        bit_rate_bps:Some(spec.sample_rate_hz as u64 * frame_bytes as u64 * 8),
        bits_per_sample:Some((width*8) as u16),
        file_bytes:bytes,audio_stream_index:0
    });
    Ok(snapshot)
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
#[test] fn zero_is_silent(){let v=analyze("silence","test",48000,1,&vec![0.0;4096],false).unwrap();assert_eq!(v.rms_dbfs,None);assert_eq!(v.peak_dbfs,None);}
#[test] fn sine_rms_minus_three_db(){let s:Vec<_>=(0..48000).map(|i|(2.0*std::f64::consts::PI*1000.0*i as f64/48000.0).sin()).collect();let v=analyze("sine","test",48000,1,&s,false).unwrap();assert!((v.rms_dbfs.unwrap()+3.01029995664).abs()<0.001);}
#[test] fn fft_bin_gain(){let s:Vec<_>=(0..4096).map(|i|0.5*(2.0*std::f64::consts::PI*128.0*i as f64/4096.0).sin()).collect();let v=analyze("sine","test",48000,1,&s,false).unwrap();assert!((v.spectrum[128].dbfs.unwrap()+6.020599913).abs()<0.02);}
}
