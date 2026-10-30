//! Bounded best-effort inference for HEADERLESS PCM. Never treat guesses as facts.
use super::{RawSpec, validate};
use super::streaming::{sample_value, width};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const PROBE_BYTES: usize = 131072;
const FORMATS: &[(&str, &str)] = &[
    ("s16", "little"), ("s16", "big"), ("s24", "little"), ("s24", "big"),
    ("s32", "little"), ("s32", "big"), ("f32", "little"), ("f32", "big"),
    ("f64", "little"), ("f64", "big"), ("u8", "little"), ("s8", "little"),
];
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCandidate {
    pub sample_format: String,
    pub endianness: String,
    pub score: f64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDetection {
    pub suggested: RawSpec,
    pub confidence: String,
    pub inferred_fields: Vec<String>,
    pub reasons: Vec<String>,
    pub candidates: Vec<RawCandidate>,
    pub file_bytes: u64,
}

fn tokens(name: &str) -> Vec<String> {
    name.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(str::to_string).collect()
}
fn parse_rate(s: &str) -> Option<u32> {
    // Rate is only extracted from a *labelled* filename segment.
    let n = s.trim_end_matches("khz").trim_end_matches("hz");
    let result = if let Some(k) = n.strip_suffix('k') {
        k.parse::<u32>().ok()?.checked_mul(1000)?
    } else if n == "44k1" || n == "44p1" { 44100 }
    else if n == "88k2" || n == "88p2" { 88200 }
    else { n.parse::<u32>().ok()? };
    if (8000..=768000).contains(&result) { Some(result) } else { None }
}
fn format_from_token(s: &str) -> Option<(&'static str, Option<&'static str>)> {
    let x = s.strip_prefix("pcm").unwrap_or(s);
    for fmt in ["s16", "s24", "s32", "f32", "f64", "u8", "s8"] {
        if x == fmt { return Some((fmt, None)); }
        if x == format!("{fmt}le") { return Some((fmt, Some("little"))); }
        if x == format!("{fmt}be") { return Some((fmt, Some("big"))); }
    }
    for (token, f) in [
        ("16bit","s16"),("24bit","s24"),("32bit","s32"),
        ("int16","s16"),("int24","s24"),("int32","s32"),
        ("float32","f32"),("float64","f64"),("double64","f64"),
        ("8bit","s8"),
    ] {
        if x == token { return Some((f,None)); }
    }
    None
}
fn score(bytes: &[u8], fmt: &str, le: bool) -> Option<f64> {
    let w = width(fmt).ok()?;
    let n = (bytes.len() / w).min(8192);
    if n < 256 { return None; }
    let mut prev=0.0;
    let mut sum=0.0;
    let mut diff=0.0;
    let mut max=0.0_f64;
    let mut valid=0usize;
    let mut dynamic=0usize;
    let mut zero=0usize;
    for (i, b) in bytes.chunks_exact(w).take(n).enumerate() {
        let v=sample_value(fmt,le,b);
        if !v.is_finite() {continue;}
        valid+=1;
        let a=v.abs();
        if a>1e-5 {dynamic+=1;}
        if a==0.0 {zero+=1;}
        max=max.max(a);
        sum+=a;
        if i>0 {diff+=(v-prev).abs();}
        prev=v;
    }
    if valid < n * 99 / 100 || max > 32.0 {return None;}
    if dynamic < n/100 || max < 1e-5 {return None;} // Silence/denormals cannot identify a format.
    let mean=sum/valid as f64;
    let continuity=diff/(valid.saturating_sub(1).max(1) as f64 * mean.max(1e-9));
    let smooth=if continuity<0.3 {3.0} else if continuity<0.8 {2.0}
        else if continuity<1.4 {0.8} else if continuity<1.8 {-0.3} else {-1.2};
    let mut result=smooth;
    if fmt.starts_with('f') {
        // Float reinterpretations of integer PCM generally produce invalid,
        // denormal or impossibly large values, especially for smooth signals.
        if max<=1.2 && (zero as f64)/(valid as f64)<0.95 {
            result+=2.0;
        } else if max>4.0 {result-=3.0;}
    } else {
        result+=if fmt=="s16" {0.3} else {0.0};
    }
    Some((result * 100.0).round()/100.0)
}

pub fn detect_raw_pcm(path: &Path, previous: Option<RawSpec>) -> Result<RawDetection, String> {
    if !path.is_file() {return Err("File does not exist".into());}
    let bytes=std::fs::metadata(path).map_err(|e|e.to_string())?.len();
    if bytes==0 {return Err("PCM file is empty".into());}
    let mut proposed=previous.unwrap_or_else(||RawSpec {
        sample_rate_hz:48000,channels:1,sample_format:"s16".into(),
        endianness:"little".into(),byte_offset:0,layout:"interleaved".into()
    });
    // Do not use invalid persisted settings as probe offsets or defaults.
    if validate(proposed.sample_rate_hz,proposed.channels).is_err() {proposed.sample_rate_hz=48000;proposed.channels=1;}
    if width(&proposed.sample_format).is_err() {proposed.sample_format="s16".into();}
    if proposed.endianness!="little" && proposed.endianness!="big" {proposed.endianness="little".into();}
    if proposed.layout!="planar" && proposed.layout!="interleaved" {proposed.layout="interleaved".into();}
    if proposed.byte_offset>=bytes {proposed.byte_offset=0;}

    let pieces=tokens(&path.file_stem().unwrap_or_default().to_string_lossy());
    let mut reasons=Vec::new();
    let mut inferred_fields=Vec::new();
    let mut explicit_format=false;
    let mut explicit_endian=false;

    for (i, part) in pieces.iter().enumerate() {
        if let Some((fmt,endian))=format_from_token(part) {
            proposed.sample_format=fmt.into();
            explicit_format=true;
            if let Some(endian)=endian {proposed.endianness=endian.into();explicit_endian=true;}
        }
        if part=="le" || part=="littleendian" {proposed.endianness="little".into();explicit_endian=true;}
        if part=="be" || part=="bigendian" {proposed.endianness="big".into();explicit_endian=true;}
        if part=="mono" {proposed.channels=1; inferred_fields.push("channels".into());}
        if part=="stereo" {proposed.channels=2; inferred_fields.push("channels".into());}
        if part=="planar" {proposed.layout="planar".into();inferred_fields.push("layout".into());}
        if part=="interleaved" {proposed.layout="interleaved".into();inferred_fields.push("layout".into());}
        if let Some(value)=part.strip_suffix("ch").and_then(|v|v.parse::<u16>().ok()) {
            if (1..=16).contains(&value) {proposed.channels=value;inferred_fields.push("channels".into());}
        }
        if let Some(rate)=part.strip_prefix("sr").and_then(parse_rate)
            .or_else(||part.strip_prefix("fs").and_then(parse_rate))
            .or_else(||part.strip_prefix("rate").and_then(parse_rate))
            .or_else(||if i>0 && matches!(pieces[i-1].as_str(),"sr"|"fs"|"rate"|"samplerate") {
                parse_rate(part)
            } else {None}) {
                proposed.sample_rate_hz=rate;inferred_fields.push("sampleRateHz".into());
        }
    }
    if explicit_format {inferred_fields.push("sampleFormat".into());}
    if explicit_endian {inferred_fields.push("endianness".into());}
    if !inferred_fields.is_empty() {
        reasons.push("Filename labels supplied the marked fields; confirm against acquisition settings.".into());
    }

    let mut f=File::open(path).map_err(|e|e.to_string())?;
    f.seek(SeekFrom::Start(proposed.byte_offset)).map_err(|e|e.to_string())?;
    let mut data=vec![0u8;PROBE_BYTES.min((bytes-proposed.byte_offset) as usize)];
    let used=f.read(&mut data).map_err(|e|e.to_string())?;
    data.truncate(used);
    let mut candidates:Vec<_>=FORMATS.iter().filter_map(|&(fmt,endian)| {
        score(&data,fmt,endian=="little").map(|score|RawCandidate {
            sample_format:fmt.into(),endianness:endian.into(),score
        })
    }).collect();
    candidates.sort_by(|a,b|b.score.total_cmp(&a.score));
    let best=candidates.first().map(|x|x.score).unwrap_or(-10.0);
    let second=candidates.get(1).map(|x|x.score).unwrap_or(-10.0);
    let clear=best>=3.5 && best-second>=1.2;
    if !explicit_format && clear {
        proposed.sample_format=candidates[0].sample_format.clone();
        inferred_fields.push("sampleFormat".into());
        if !explicit_endian {
            proposed.endianness=candidates[0].endianness.clone();
            inferred_fields.push("endianness".into());
        }
        reasons.push("A small audio-data sample suggests this encoding, but raw bytes cannot prove the format.".into());
    } else if !explicit_format {
        reasons.push("Byte-level inference is ambiguous; retained previous/default encoding. Ranked alternatives are available below.".into());
    }
    // A silent or very short stream must not be presented as a confident match.
    if candidates.is_empty() {
        reasons.push("Insufficient dynamic audio data to infer an encoding (short or silent input).".into());
    }
    if !inferred_fields.iter().any(|x|x=="sampleRateHz") {
        reasons.push("Sample rate is not stored in raw PCM; using the last/default value.".into());
    }
    if !inferred_fields.iter().any(|x|x=="channels") {
        reasons.push("Channel count and planar/interleaved layout are not reliably identifiable from raw bytes.".into());
    }
    let confidence=if explicit_format {"filename"} else if clear {"heuristic"} else {"unknown"};
    // Avoid duplicates if a filename had repeated tokens.
    inferred_fields.sort(); inferred_fields.dedup();
    candidates.truncate(4);
    Ok(RawDetection {
        suggested:proposed,confidence:confidence.into(),inferred_fields,reasons,
        candidates,file_bytes:bytes
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_file(label:&str,data:&[u8])->std::path::PathBuf{
        let path=std::env::temp_dir().join(format!("aa_detect_{}_{}_{}.pcm",label,std::process::id(),data.len()));
        std::fs::write(&path,data).unwrap();path
    }
    #[test]
    fn filename_labels_are_used_without_fabricating_rate() {
        let p=test_file("sr32000_s16le_stereo_interleaved",&[0u8;4096]);
        let d=detect_raw_pcm(&p,None).unwrap();
        assert_eq!(d.suggested.sample_rate_hz,32000);
        assert_eq!(d.suggested.channels,2);
        assert_eq!(d.suggested.sample_format,"s16");
        assert_eq!(d.suggested.endianness,"little");
        assert_eq!(d.confidence,"filename");
        std::fs::remove_file(p).unwrap();
    }
    #[test]
    fn tone_frequency_is_not_confused_with_sample_rate() {
        let p=test_file("test_4khz_0dbfs",&[0u8;4096]);
        let d=detect_raw_pcm(&p,None).unwrap();
        assert_eq!(d.suggested.sample_rate_hz,48000);
        assert_eq!(d.confidence,"unknown");
        std::fs::remove_file(p).unwrap();
    }
    #[test]
    fn ambiguous_silence_retains_user_settings() {
        let p=test_file("silence",&[0u8;8192]);
        let original=RawSpec {
            sample_rate_hz:192000,channels:4,sample_format:"s24".into(),
            endianness:"big".into(),byte_offset:0,layout:"planar".into()
        };
        let d=detect_raw_pcm(&p,Some(original)).unwrap();
        assert_eq!(d.confidence,"unknown");
        assert!(d.candidates.is_empty());
        assert_eq!(d.suggested.sample_format,"s24");
        assert_eq!(d.suggested.channels,4);
        std::fs::remove_file(p).unwrap();
    }
    #[test]
    fn detects_float32_sine_as_candidate() {
        let mut bytes=Vec::new();
        for i in 0..8192 {
            let x=(0.7_f64*(i as f64*std::f64::consts::TAU*900.0/48000.0).sin()) as f32;
            bytes.extend_from_slice(&x.to_le_bytes());
        }
        let p=test_file("floatprobe",&bytes);
        let d=detect_raw_pcm(&p,None).unwrap();
        assert!(d.candidates.iter().any(|x|x.sample_format=="f32" && x.endianness=="little"),
            "candidates: {:?}",d.candidates.iter().map(|x|(&x.sample_format,&x.endianness,x.score)).collect::<Vec<_>>());
        std::fs::remove_file(p).unwrap();
    }
}
