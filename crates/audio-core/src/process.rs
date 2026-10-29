//! Bounded, time-limited execution of the local FFmpeg tools.
//!
//! Both stdout and stderr are drained concurrently, preventing pipe deadlocks.
//! The readers retain at most their configured byte budgets; excessive data is
//! still drained but causes a descriptive error. No shell or network is invoked.
use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

pub struct ProcessOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

fn drain_bounded<R: Read + Send + 'static>(
    mut reader: R,
    limit: usize,
) -> thread::JoinHandle<Result<Vec<u8>, String>> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut captured = Vec::new();
        let mut exceeded = false;
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let remaining = limit.saturating_sub(captured.len());
                    let keep = remaining.min(n);
                    captured.extend_from_slice(&buffer[..keep]);
                    if keep < n { exceeded = true; }
                }
                Err(e) => return Err(format!("Cannot read decoder pipe: {e}")),
            }
        }
        if exceeded {
            Err(format!("Decoder output exceeded permitted {limit} bytes"))
        } else {
            Ok(captured)
        }
    })
}

pub fn run_bounded(
    command: &mut Command,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<ProcessOutput, String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot start audio decoder: {e}"))?;

    let stdout = child.stdout.take().ok_or("Missing decoder stdout")?;
    let stderr = child.stderr.take().ok_or("Missing decoder stderr")?;
    let out_handle = drain_bounded(stdout, stdout_limit);
    let err_handle = drain_bounded(stderr, stderr_limit);
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(code)) => break Ok(code),
            Ok(None) if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("Audio decoder timed out after {} seconds", timeout.as_secs()));
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(format!("Cannot monitor audio decoder: {e}"));
            }
        }
    };

    // The child is reaped before joining; all its pipes eventually close.
    let captured_stdout = out_handle.join()
        .map_err(|_| "Decoder stdout reader panicked")??;
    let captured_stderr = err_handle.join()
        .map_err(|_| "Decoder stderr reader panicked")??;
    Ok(ProcessOutput { status: status?, stdout: captured_stdout, stderr: captured_stderr })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absent_binary_is_an_error() {
        let mut cmd = Command::new("audio_analyzer_missing_binary_for_test_57291");
        assert!(run_bounded(&mut cmd, Duration::from_secs(1), 10, 10).is_err());
    }
}
