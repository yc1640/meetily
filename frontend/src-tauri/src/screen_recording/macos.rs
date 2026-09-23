use std::{path::PathBuf, sync::Mutex};

use cidre::{
    arc, av,
    av::asset::WriterStatus,
    cm, define_obj_type, dispatch, ns, objc, sc,
    sc::stream::{Output, OutputImpl},
};
use log::{debug, info, warn};

const CAPTURE_FPS: i32 = 30;
const MAX_CAPTURE_WIDTH: usize = 2560;
const MAX_CAPTURE_HEIGHT: usize = 1440;

static SCREEN_RECORDER: Mutex<Option<ScreenRecorder>> = Mutex::new(None);

#[repr(C)]
struct OutputContext {
    input: arc::R<av::AssetWriterInput>,
    writer: arc::R<av::AssetWriter>,
    session_started: bool,
    frames_written: u64,
    first_error: Option<String>,
}

define_obj_type!(
    ScreenOutput + OutputImpl,
    OutputContext,
    MEETILY_SCREEN_OUTPUT
);

impl Output for ScreenOutput {}

#[objc::add_methods]
impl OutputImpl for ScreenOutput {
    extern "C" fn impl_stream_did_output_sample_buf(
        &mut self,
        _cmd: Option<&objc::Sel>,
        _stream: &sc::Stream,
        sample_buffer: &mut cm::SampleBuf,
        kind: sc::OutputType,
    ) {
        if kind != sc::OutputType::Screen || sample_buffer.image_buf().is_none() {
            return;
        }

        let ctx = self.inner_mut();
        if ctx.first_error.is_some() {
            return;
        }

        if !ctx.session_started {
            ctx.writer.start_session_at_src_time(sample_buffer.pts());
            ctx.session_started = true;
        }

        if !ctx.input.is_ready_for_more_media_data() {
            debug!("Dropping screen frame while AVAssetWriter is applying backpressure");
            return;
        }

        match ctx.input.append_sample_buf(sample_buffer) {
            Ok(true) => ctx.frames_written += 1,
            Ok(false) => {
                ctx.first_error = Some(format!(
                    "AVAssetWriter rejected a screen frame: {:?}",
                    ctx.writer.error()
                ));
            }
            Err(error) => {
                ctx.first_error = Some(format!("Failed to append screen frame: {:?}", error));
            }
        }
    }
}

struct ScreenRecorder {
    stream: arc::R<sc::Stream>,
    output: arc::R<ScreenOutput>,
    _queue: arc::R<dispatch::Queue>,
    output_path: PathBuf,
}

// ScreenCaptureKit delivers frames on the retained serial dispatch queue. The
// recorder is moved only while no global lock is held across an await.
unsafe impl Send for ScreenRecorder {}

fn capture_dimensions(width: usize, height: usize) -> (usize, usize) {
    let source_width = width.saturating_mul(2).max(2);
    let source_height = height.saturating_mul(2).max(2);
    let scale = f64::min(
        1.0,
        f64::min(
            MAX_CAPTURE_WIDTH as f64 / source_width as f64,
            MAX_CAPTURE_HEIGHT as f64 / source_height as f64,
        ),
    );

    let even = |value: usize| value.max(2) & !1;
    (
        even((source_width as f64 * scale).round() as usize),
        even((source_height as f64 * scale).round() as usize),
    )
}

fn video_settings(
    width: usize,
    height: usize,
) -> Result<arc::R<ns::DictionaryMut<ns::String, ns::Id>>, String> {
    objc::ar_pool(|| {
        let assistant =
            av::OutputSettingsAssistant::with_preset(av::OutputSettingsPreset::h264_1920x1080())
                .ok_or_else(|| "H.264 output settings are unavailable".to_string())?;
        let mut settings = assistant
            .video_settings()
            .ok_or_else(|| "H.264 video settings are unavailable".to_string())?
            .copy_mut();
        settings.set_obj_for_key(
            ns::Number::with_u64(width as u64).as_ref(),
            av::video_settings_keys::width(),
        );
        settings.set_obj_for_key(
            ns::Number::with_u64(height as u64).as_ref(),
            av::video_settings_keys::height(),
        );
        Ok(settings)
    })
}

pub async fn start(output_path: PathBuf) -> Result<PathBuf, String> {
    if SCREEN_RECORDER
        .lock()
        .map_err(|_| "Screen recorder state is unavailable".to_string())?
        .is_some()
    {
        return Err("Screen recording is already active".to_string());
    }
    if output_path.exists() {
        return Err(format!(
            "Refusing to overwrite existing screen recording: {}",
            output_path.display()
        ));
    }

    let content = sc::ShareableContent::current()
        .await
        .map_err(|error| format!("Screen access was not granted: {:?}", error))?;
    let display = content
        .displays()
        .get(0)
        .map_err(|_| "No display is available to record".to_string())?;
    let source_width = usize::try_from(display.width())
        .map_err(|_| "The primary display has an invalid width".to_string())?;
    let source_height = usize::try_from(display.height())
        .map_err(|_| "The primary display has an invalid height".to_string())?;
    let (width, height) = capture_dimensions(source_width, source_height);

    let mut config = sc::StreamCfg::new();
    config.set_width(width);
    config.set_height(height);
    config.set_minimum_frame_interval(cm::Time::new(1, CAPTURE_FPS));
    config.set_shows_cursor(true);
    config.set_captures_audio(false);

    let excluded_windows = ns::Array::new();
    let filter = sc::ContentFilter::with_display_excluding_windows(&display, &excluded_windows);
    let stream = sc::Stream::new(&filter, &config);
    let queue = dispatch::Queue::serial_with_ar_pool();

    let path_string = output_path.to_string_lossy();
    let url = ns::Url::with_fs_path_str(&path_string, false);
    let mut writer = av::AssetWriter::with_url_and_file_type(&url, av::FileType::mp4())
        .map_err(|error| format!("Failed to create screen recording file: {:?}", error))?;
    let mut input = av::AssetWriterInput::with_media_type_and_output_settings(
        av::MediaType::video(),
        Some(video_settings(width, height)?.as_ref()),
    )
    .map_err(|error| format!("Failed to create H.264 encoder input: {:?}", error))?;
    input.set_expects_media_data_in_real_time(true);
    writer
        .add_input(&input)
        .map_err(|error| format!("Failed to attach H.264 encoder input: {:?}", error))?;

    let mut output = ScreenOutput::with(OutputContext {
        input,
        writer,
        session_started: false,
        frames_written: 0,
        first_error: None,
    });
    stream
        .add_stream_output(output.as_ref(), sc::OutputType::Screen, Some(&queue))
        .map_err(|error| format!("Failed to attach screen capture output: {:?}", error))?;

    if !output.inner_mut().writer.start_writing() {
        let error = format!(
            "Failed to initialize screen video writer: {:?}",
            output.inner().writer.error()
        );
        let _ = std::fs::remove_file(&output_path);
        return Err(error);
    }

    if let Err(error) = stream.start().await {
        output.inner_mut().writer.cancel_writing();
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("Failed to start screen capture: {:?}", error));
    }

    let recorder = ScreenRecorder {
        stream,
        output,
        _queue: queue,
        output_path: output_path.clone(),
    };
    let rejected_recorder = {
        let mut guard = SCREEN_RECORDER
            .lock()
            .map_err(|_| "Screen recorder state is unavailable".to_string())?;
        if guard.is_some() {
            Some(recorder)
        } else {
            *guard = Some(recorder);
            None
        }
    };
    if let Some(mut recorder) = rejected_recorder {
        let _ = recorder.stream.stop().await;
        recorder.output.inner_mut().writer.cancel_writing();
        let _ = std::fs::remove_file(&output_path);
        return Err("Screen recording became active concurrently".to_string());
    }

    info!(
        "Screen recording started at {}x{}: {}",
        width,
        height,
        output_path.display()
    );
    Ok(output_path)
}

pub async fn stop() -> Result<Option<PathBuf>, String> {
    let recorder = SCREEN_RECORDER
        .lock()
        .map_err(|_| "Screen recorder state is unavailable".to_string())?
        .take();
    let Some(recorder) = recorder else {
        return Ok(None);
    };

    let stream_error = recorder
        .stream
        .stop()
        .await
        .err()
        .map(|error| format!("Failed to stop screen capture cleanly: {:?}", error));

    tokio::task::spawn_blocking(move || finalize_recording(recorder, stream_error))
        .await
        .map_err(|error| format!("Screen recording finalizer failed: {}", error))?
}

fn finalize_recording(
    mut recorder: ScreenRecorder,
    stream_error: Option<String>,
) -> Result<Option<PathBuf>, String> {
    let context = recorder.output.inner_mut();
    if context.frames_written == 0 {
        context.writer.cancel_writing();
        let _ = std::fs::remove_file(&recorder.output_path);
        return Err(context
            .first_error
            .clone()
            .or(stream_error)
            .unwrap_or_else(|| {
                "Screen recording stopped before any frames were captured".to_string()
            }));
    }

    context.input.mark_as_finished();
    context.writer.finish_writing();

    if let Some(error) = context.first_error.clone().or(stream_error) {
        warn!(
            "Screen recording completed with a capture warning: {}",
            error
        );
    }
    if context.writer.status() != WriterStatus::Completed {
        let error = format!(
            "Failed to finalize screen recording: {:?}",
            context.writer.error()
        );
        let _ = std::fs::remove_file(&recorder.output_path);
        return Err(error);
    }

    info!(
        "Screen recording finalized with {} frames: {}",
        context.frames_written,
        recorder.output_path.display()
    );
    Ok(Some(recorder.output_path))
}

#[cfg(test)]
mod tests {
    use super::capture_dimensions;

    #[test]
    fn capture_size_is_even_and_capped() {
        assert_eq!(capture_dimensions(1280, 720), (2560, 1440));
        assert_eq!(capture_dimensions(3024, 1964), (2216, 1440));
        let (width, height) = capture_dimensions(701, 499);
        assert_eq!(width % 2, 0);
        assert_eq!(height % 2, 0);
        assert!(width <= 2560);
        assert!(height <= 1440);
    }
}
