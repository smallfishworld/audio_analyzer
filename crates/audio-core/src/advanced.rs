//! Read-only, bounded frequency analysis, spectrogram and audition chunks.
//! The same selected-channel source samples feed both measurements and playback.
use crate::{ffmpeg, streaming, validate, RawSpec};
use realfft::RealFftPlanner;
use serde::Serialize;
use std::{fs::File, io::{BufReader, Read, Seek, SeekFrom}, path::Path};

const MAX_ANALYSIS_FRAMES: usize = 2_097_152;
const MAX_PLAY_SECONDS: f64 = 2.0;
const MAX_COLUMNS: usize = 220;
const BINS_PER_COLUMN: usize = 256;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Peak { pub frequency_hz: f64, pub dbfs: f64 }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct SpectrumBin { pub frequency_hz: f64, pub dbfs: Option<f64> }

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Spectrogram {
    pub start_sec: f64,
    pub end_sec: f64,
    pub nyquist_hz: f64,
    pub columns: Vec<Vec<f32>>,
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Detail {
    pub start_sec: f64, pub end_sec: f64,
    pub sample_rate_hz: u32, pub fft_size: usize, pub window: String,
    pub peak_dbfs: Option<f64>, pub rms_dbfs: Option<f64>,
    pub spectrum: Vec<SpectrumBin>, pub peaks: Vec<Peak>,
    pub spectrogram: Spectrogram,
}

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct AudioChunk {
    pub start_sec: f64, pub sample_rate_hz: u32,
    pub samples: Vec<f32>,
}

fn validate_interval(start: f64, duration: f64) -> Result<(),String> {
    if !start.is_finite() || !duration.is_finite() || start < 0.0 || duration <= 0.0 {
        return Err("Time range must be positive and finite".into());
    }
    Ok(())
}

/// Read a single channel, preserving original sample rate and PCM interpretation.
/// These bounded requests do not alter source files and never downmix.
fn source_samples(path: &Path, raw: Option<&RawSpec>, channel: usize,
                  start_sec: f64, duration_sec: f64, max_frames: usize)
    -> Result<(u32,Vec<f64>),String> {
    validate_interval(start_sec,duration_sec)?;
    if !path.is_file() { return Err("Audio file does not exist".into()); }
    if let Some(spec) = raw {
        validate(spec.sample_rate_hz,spec.channels)?;
        if channel >= spec.channels as usize { return Err("Channel out of range".into()); }
        let bytes_per_sample = streaming::width(&spec.sample_format)?;
        let le = match spec.endianness.as_str() {
            "little" => true, "big" => false, _ => return Err("Invalid byte order".into()),
        };
        if spec.layout != "interleaved" && spec.layout != "planar" { return Err("Invalid PCM layout".into()); }
        let total_width = bytes_per_sample * spec.channels as usize;
        let file = File::open(path).map_err(|e|e.to_string())?;
        let bytes = file.metadata().map_err(|e|e.to_string())?.len();
        if spec.byte_offset >= bytes { return Err("PCM offset exceeds file length".into()); }
        let total = (bytes-spec.byte_offset)/total_width as u64;
        let start = (start_sec*spec.sample_rate_hz as f64).floor() as u64;
        if start>=total { return Err("Start time exceeds audio duration".into()); }
        let wanted = (duration_sec*spec.sample_rate_hz as f64).ceil() as u64;
        if wanted>max_frames as u64 {return Err("Selected range exceeds the bounded analysis limit; select a shorter interval".into());}
        let frames = wanted.min(total-start) as usize;
        let planar = spec.layout=="planar";
        let base = if planar {
            spec.byte_offset.checked_add((channel as u64).checked_mul(total)
                .and_then(|v|v.checked_mul(bytes_per_sample as u64)).ok_or("PCM offset overflow")?)
                .ok_or("PCM offset overflow")?
        } else {spec.byte_offset};
        let stride = if planar {bytes_per_sample} else {total_width};
        let offset = base.checked_add(start.checked_mul(stride as u64).ok_or("PCM seek overflow")?)
            .ok_or("PCM seek overflow")?;
        let mut reader=BufReader::new(file);
        reader.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;
        let mut samples=Vec::with_capacity(frames);
        let mut buf=vec![0u8;8192*stride];
        let mut done=0;
        while done<frames {
            let n=(frames-done).min(8192);
            reader.read_exact(&mut buf[..n*stride]).map_err(|e|e.to_string())?;
            for i in 0..n {
                let start=i*stride + if planar {0} else {channel*bytes_per_sample};
                samples.push(streaming::sample_value(&spec.sample_format,le,&buf[start..start+bytes_per_sample]));
            }
            done+=n;
        }
        return Ok((spec.sample_rate_hz,samples));
    }
    if path.extension().and_then(|x|x.to_str()).unwrap_or("").eq_ignore_ascii_case("wav") {
        if let Ok(mut reader)=hound::WavReader::open(path) {
            let spec=reader.spec();
            validate(spec.sample_rate,spec.channels)?;
            if channel>=spec.channels as usize {return Err("Channel out of range".into());}
            let start=(start_sec*spec.sample_rate as f64).floor() as u64;
            let total=reader.duration() as u64;
            if start>=total {return Err("Start time exceeds audio duration".into());}
            let wanted=(duration_sec*spec.sample_rate as f64).ceil() as u64;
            if wanted>max_frames as u64 {return Err("Selected range exceeds the bounded analysis limit; select a shorter interval".into());}
            let frames=wanted.min(total-start) as usize;
            reader.seek(u32::try_from(start).map_err(|_|"WAV position exceeds seek limit")?)
                .map_err(|e|e.to_string())?;
            let mut samples=Vec::with_capacity(frames);
            match spec.sample_format {
                hound::SampleFormat::Float => {
                    for (i,s) in reader.samples::<f32>().take(frames*spec.channels as usize).enumerate() {
                        let s=s.map_err(|e|e.to_string())?;
                        if i%spec.channels as usize==channel {samples.push(s as f64);}
                    }
                }
                hound::SampleFormat::Int => {
                    if !(1..=32).contains(&spec.bits_per_sample) {return Err("Unsupported WAV bit depth".into());}
                    let norm=2_f64.powi(spec.bits_per_sample as i32-1);
                    for (i,s) in reader.samples::<i32>().take(frames*spec.channels as usize).enumerate() {
                        let s=s.map_err(|e|e.to_string())?;
                        if i%spec.channels as usize==channel {samples.push(s as f64/norm);}
                    }
                }
            }
            return Ok((spec.sample_rate,samples));
        }
    }
    let meta=ffmpeg::probe(path)?;
    if channel>=meta.channels as usize {return Err("Channel out of range".into());}
    let wanted=(duration_sec*meta.sample_rate_hz as f64).ceil() as usize;
    if wanted>max_frames {return Err("Selected range exceeds the bounded analysis limit; select a shorter interval".into());}
    ffmpeg::decode_range(path,&meta,channel,start_sec,duration_sec,max_frames)
        .map(|v|(meta.sample_rate_hz,v))
}

fn coeff(kind:&str,i:usize,n:usize)->f64 {
    let phase=2.0*std::f64::consts::PI*i as f64/(n-1) as f64;
    match kind {
        "hann" => 0.5-0.5*phase.cos(),
        "hamming" => 0.54-0.46*phase.cos(),
        "blackman" => 0.42-0.5*phase.cos()+0.08*(2.0*phase).cos(),
        _ => 1.0,
    }
}

fn fft_db(samples:&[f64],window:&[f64],fft:&std::sync::Arc<dyn realfft::RealToComplex<f64>>,
          input:&mut[f64],output:&mut[num_complex::Complex<f64>],gain:f64)->Result<Vec<f64>,String> {
    for (i,x) in samples.iter().enumerate(){input[i]=x*window[i];}
    fft.process(input,output).map_err(|e|e.to_string())?;
    Ok(output.iter().enumerate().map(|(i,c)| {
        let factor=if i==0||i==samples.len()/2 {1.0}else{2.0};
        c.norm()*factor/gain
    }).collect())
}

pub fn analyze_range(path:&Path,raw:Option<&RawSpec>,channel:usize,
        start_sec:f64,duration_sec:f64,fft_size:usize,window_name:&str)->Result<Detail,String> {
    if ![1024,2048,4096,8192,16384].contains(&fft_size) {return Err("FFT size must be 1024..16384 (power of 2)".into());}
    if !["hann","hamming","blackman","rectangular"].contains(&window_name) {return Err("Unsupported FFT window".into());}
    let (rate,samples)=source_samples(path,raw,channel,start_sec,duration_sec,MAX_ANALYSIS_FRAMES)?;
    if samples.len()<fft_size {return Err("Selected interval is shorter than FFT window; select a longer range or smaller FFT".into());}
    if samples.iter().any(|x|!x.is_finite()) {return Err("PCM contains NaN or infinity".into());}
    let start_frame=(start_sec*rate as f64).floor() as u64;
    let time_start=start_frame as f64/rate as f64;
    let end=time_start+samples.len() as f64/rate as f64;
    let peak=samples.iter().map(|v|v.abs()).fold(0.0_f64,f64::max);
    let rms=(samples.iter().map(|v|v*v).sum::<f64>()/samples.len() as f64).sqrt();
    let win:Vec<f64>=(0..fft_size).map(|i|coeff(window_name,i,fft_size)).collect();
    let gain=win.iter().sum::<f64>();
    let mut planner=RealFftPlanner::<f64>::new();
    let fft=planner.plan_fft_forward(fft_size);
    let mut input=fft.make_input_vec();
    let mut output=fft.make_output_vec();
    let steps=((samples.len()-fft_size)/(fft_size/2)).saturating_add(1).min(512);
    let hop=if steps>=512 {(samples.len()-fft_size)/511} else {fft_size/2};
    let mut avg=vec![0f64;fft_size/2+1];
    let mut count=0usize;
    for start in (0..=samples.len()-fft_size).step_by(hop.max(1)).take(512) {
        let bins=fft_db(&samples[start..start+fft_size],&win,&fft,
                        &mut input,&mut output,gain)?;
        for (a,b) in avg.iter_mut().zip(bins){*a+=b;}
        count+=1;
    }
    for a in &mut avg {*a/=count as f64;}
    let step=rate as f64/fft_size as f64;
    let spectrum:Vec<SpectrumBin>=avg.iter().enumerate().map(|(i,&a)| SpectrumBin {
        frequency_hz:i as f64*step,dbfs:if a>0.0{Some(20.0*a.log10())}else{None}
    }).collect();
    let mut peaks:Vec<Peak>=(1..avg.len()-1).filter(|&i|
        avg[i]>avg[i-1] && avg[i]>=avg[i+1] && avg[i]>1e-8)
        .map(|i|{
            let l=avg[i-1].max(1e-20).ln();
            let c=avg[i].max(1e-20).ln();
            let r=avg[i+1].max(1e-20).ln();
            let denominator=l-2.0*c+r;
            let offset=if denominator.abs()>1e-12 { (0.5*(l-r)/denominator).clamp(-0.5,0.5) } else {0.0};
            Peak{frequency_hz:(i as f64+offset)*step,dbfs:20.0*avg[i].log10()}
        }).collect();
    peaks.sort_by(|a,b|b.dbfs.total_cmp(&a.dbfs));
    // Machine-noise and floating point sidelobes around −100 dBFS should
    // not look like genuine harmonics of a clean pure sine.
    if let Some(strongest)=peaks.first().map(|p|p.dbfs) {
        peaks.retain(|p|p.dbfs>=-90.0 && p.dbfs>=strongest-60.0);
    }
    peaks.truncate(5);
    // A bounded STFT: equally spaced overlapping windows, max 220 x 256 output.
    let hop_stft=((samples.len()-fft_size)/MAX_COLUMNS.max(1)).max((fft_size/4).max(1));
    let mut columns=Vec::new();
    for offset in (0..=samples.len()-fft_size).step_by(hop_stft).take(MAX_COLUMNS) {
        let db=fft_db(&samples[offset..offset+fft_size],&win,&fft,
                      &mut input,&mut output,gain)?;
        let mut pixels=vec![-120f32;BINS_PER_COLUMN];
        for (i,level) in db.into_iter().enumerate() {
            let row=(i*(BINS_PER_COLUMN-1))/(fft_size/2);
            if level>0.0 {pixels[row]=pixels[row].max((20.0*level.log10()).clamp(-120.0,6.0) as f32);}
        }
        columns.push(pixels);
    }
    Ok(Detail{
        start_sec:time_start,end_sec:end,sample_rate_hz:rate,fft_size,window:window_name.into(),
        peak_dbfs:if peak>0.0{Some(20.0*peak.log10())}else{None},
        rms_dbfs:if rms>0.0{Some(20.0*rms.log10())}else{None},
        spectrum,peaks,
        spectrogram:Spectrogram{start_sec:time_start,end_sec:end,nyquist_hz:rate as f64/2.0,columns},
    })
}

pub fn audio_chunk(path:&Path,raw:Option<&RawSpec>,channel:usize,
                   start_sec:f64,duration_sec:f64)->Result<AudioChunk,String> {
    if duration_sec>MAX_PLAY_SECONDS {return Err("Playback chunks are limited to 2 seconds".into());}
    let (rate,values)=source_samples(path,raw,channel,start_sec,duration_sec,MAX_ANALYSIS_FRAMES)?;
    if values.iter().any(|v|!v.is_finite()){return Err("Audio contains non-finite samples".into());}
    let samples=values.into_iter().map(|v|v.clamp(-1.0,1.0) as f32).collect();
    Ok(AudioChunk{start_sec,sample_rate_hz:rate,samples})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn selection_peak_and_harmonics() {
        let path=std::env::temp_dir().join(format!("aa_detail_{}.pcm",std::process::id()));
        let mut bytes=Vec::new();
        for i in 0..32768 {
            let v=(0.5*(2.0*std::f64::consts::PI*1000.0*i as f64/32768.0).sin()*32767.0) as i16;
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        std::fs::write(&path,bytes).unwrap();
        let spec=RawSpec{sample_rate_hz:32768,channels:1,sample_format:"s16".into(),
            endianness:"little".into(),byte_offset:0,layout:"interleaved".into()};
        for name in ["hann","hamming","blackman","rectangular"] {
            let d=analyze_range(&path,Some(&spec),0,0.25,0.5,4096,name).unwrap();
            assert!((d.peaks[0].frequency_hz-1000.0).abs()<10.0);
            assert!((d.peak_dbfs.unwrap()+6.02).abs()<0.15);
            assert!(d.spectrogram.columns.len()>1);
        }
        let chunk=audio_chunk(&path,Some(&spec),0,0.1,0.2).unwrap();
        assert_eq!(chunk.samples.len(),6554);
        assert!(analyze_range(&path,Some(&spec),0,0.0,0.1,16384,"hann").is_err());
        std::fs::remove_file(path).unwrap();
    }
}
