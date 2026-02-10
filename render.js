// ============================================
// render.js — Final Video Assembly Endpoint
// ============================================
// POST /render
//
// Assembles a complete video from:
//   - Scene video clips (Ken Burns or Seedance)
//   - Narration audio (MP3)
//   - Music segments (MP3, optional)
//   - SRT captions (optional)
//
// Architecture: "Dumb pipe" — n8n decides everything,
// this server just executes FFmpeg and uploads to B2.
//
// Synchronous: blocks until render is complete (like /kenburns).
// No webhooks, no polling.
//
// Temp folders:  /tmp/render-{generation_id}/  (cleaned weekly by cron)
// Render logs:   /opt/ffmpeg-api/render_logs/  (kept permanently)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { uploadToB2 } = require('./b2');

// ============================================
// Config
// ============================================
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;

const RENDER_LOGS_DIR = path.join(__dirname, 'render_logs');
if (!fs.existsSync(RENDER_LOGS_DIR)) {
  fs.mkdirSync(RENDER_LOGS_DIR, { recursive: true });
}

// ============================================
// Helpers
// ============================================

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const client = url.startsWith('https') ? https : http;
    const request = (targetUrl) => {
      client.get(targetUrl, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return request(response.headers.location);
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${response.statusCode} for ${url}`));
        }
        const file = fs.createWriteStream(destPath);
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(destPath); });
        file.on('error', (err) => { fs.unlinkSync(destPath); reject(err); });
      }).on('error', reject);
    };
    request(url);
  });
}

function runFFmpeg(args, label) {
  const cmd = `ffmpeg ${args}`;
  console.log(`[render] ${label}`);
  try {
    execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().slice(-500) : 'no stderr';
    throw new Error(`FFmpeg failed (${label}): ${stderr}`);
  }
  return cmd;
}

function probeDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    );
    return parseFloat(result.trim());
  } catch {
    return 0;
  }
}

function getCaptionStyle(styleName) {
  const styles = {
    just_text: "FontName=Inter,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,MarginV=40",
    line_box: "FontName=Inter,FontSize=22,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=40",
    word_box: "FontName=Inter,FontSize=22,PrimaryColour=&H00FFFFFF,BackColour=&HB3000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=40"
  };
  return styles[styleName] || styles.line_box;
}

function writeRenderLog(generationId, logData) {
  const logPath = path.join(RENDER_LOGS_DIR, `renderlog_${generationId}.json`);
  fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
  console.log(`[render] Log written: ${logPath}`);
}

// ============================================
// handleRender — called by server.js
// ============================================
async function handleRender(req, res) {
  req.setTimeout(0);
  res.setTimeout(0);

  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    return res.status(503).json({
      status: 'error',
      error: `Server busy: ${activeRenders}/${MAX_CONCURRENT_RENDERS} renders active. Try again later.`
    });
  }

  activeRenders++;
  const startTime = Date.now();

  const renderLog = {
    started_at: new Date().toISOString(),
    request: req.body,
    steps: [],
    ffmpeg_commands: [],
    result: null
  };

  const {
    scenes,
    narration_url,
    music_segments,
    music_volume,
    caption_file_url,
    caption_style,
    generation_id,
    b2_path,
    b2_bucket
  } = req.body;

  const genId = generation_id || startTime;
  const tempDir = path.join('/tmp', `render-${genId}`);
  const clipsDir = path.join(tempDir, 'clips');
  const processedDir = path.join(tempDir, 'processed');

  console.log(`[render] Starting job for generation_id ${genId}`);

  try {
    if (!scenes || !scenes.length) throw new Error('No scenes provided');
    if (!narration_url) throw new Error('No narration_url provided');
    if (!b2_path) throw new Error('No b2_path provided');

    renderLog.steps.push({ step: 'validate', status: 'ok', scene_count: scenes.length });

    fs.mkdirSync(clipsDir, { recursive: true });
    fs.mkdirSync(processedDir, { recursive: true });

    // ================================================
    // STEP 1: Download all assets in parallel
    // ================================================
    console.log(`[render] Downloading ${scenes.length} clips + narration + ${(music_segments || []).length} music + captions`);
    const downloadStart = Date.now();
    const downloads = [];

    scenes.forEach((scene, i) => {
      const padded = String(i + 1).padStart(3, '0');
      downloads.push(
        downloadFile(scene.video_url, path.join(clipsDir, `${padded}.mp4`))
          .then(p => ({ type: 'clip', index: i, path: p }))
      );
    });

    const narrationPath = path.join(tempDir, 'narration.mp3');
    downloads.push(
      downloadFile(narration_url, narrationPath)
        .then(p => ({ type: 'narration', path: p }))
    );

    const musicPaths = [];
    if (music_segments && music_segments.length > 0) {
      music_segments.forEach((seg, i) => {
        const mp = path.join(tempDir, `music_${i + 1}.mp3`);
        musicPaths.push(mp);
        downloads.push(
          downloadFile(seg.music_url, mp)
            .then(p => ({ type: 'music', index: i, path: p }))
        );
      });
    }

    const captionsPath = path.join(tempDir, 'captions.srt');
    const hasCaptions = caption_file_url && caption_style && caption_style !== 'none';
    if (hasCaptions) {
      downloads.push(
        downloadFile(caption_file_url, captionsPath)
          .then(p => ({ type: 'captions', path: p }))
      );
    }

    await Promise.all(downloads);
    const downloadTime = (Date.now() - downloadStart) / 1000;
    console.log(`[render] All downloads complete in ${downloadTime.toFixed(1)}s`);
    renderLog.steps.push({ step: 'download', status: 'ok', duration_seconds: downloadTime });

    // ================================================
    // STEP 2: Pre-process each clip to exact duration
    // ================================================
    console.log(`[render] Pre-processing ${scenes.length} clips to exact durations`);
    const processStart = Date.now();
    const clipDetails = [];

    for (let i = 0; i < scenes.length; i++) {
      const padded = String(i + 1).padStart(3, '0');
      const inputPath = path.join(clipsDir, `${padded}.mp4`);
      const outputPath = path.join(processedDir, `${padded}.mp4`);
      const targetDuration = scenes[i].duration;

      const sourceDuration = probeDuration(inputPath);
      const needsPadding = sourceDuration < targetDuration;

      let vf = 'fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black';

      if (needsPadding) {
        const padSeconds = Math.ceil(targetDuration - sourceDuration) + 1;
        vf += `,tpad=stop_mode=clone:stop_duration=${padSeconds}`;
      }

      const cmd = runFFmpeg(
        `-y -i "${inputPath}" -vf "${vf}" -t ${targetDuration} -c:v libx264 -preset fast -crf 18 -an "${outputPath}"`,
        `clip ${padded} (${sourceDuration.toFixed(1)}s -> ${targetDuration}s)`
      );

      clipDetails.push({
        scene: i + 1,
        source_duration: sourceDuration,
        target_duration: targetDuration,
        padded: needsPadding
      });
      renderLog.ffmpeg_commands.push({ step: `clip_${padded}`, command: cmd });
    }

    const processTime = (Date.now() - processStart) / 1000;
    console.log(`[render] All clips pre-processed in ${processTime.toFixed(1)}s`);
    renderLog.steps.push({ step: 'preprocess', status: 'ok', duration_seconds: processTime, clips: clipDetails });

    // ================================================
    // STEP 3: Create concat list
    // ================================================
    const concatListPath = path.join(tempDir, 'concat.txt');
    let concatContent = '';
    for (let i = 0; i < scenes.length; i++) {
      const padded = String(i + 1).padStart(3, '0');
      concatContent += `file '${path.join(processedDir, `${padded}.mp4`)}'\n`;
    }
    fs.writeFileSync(concatListPath, concatContent);

    // ================================================
    // STEP 4: Build final FFmpeg command
    // ================================================
    const outputPath = path.join(tempDir, 'output.mp4');
    const assemblyStart = Date.now();

    let inputs = `-f concat -safe 0 -i "${concatListPath}" -i "${narrationPath}"`;
    musicPaths.forEach(mp => { inputs += ` -i "${mp}"`; });

    const vol = music_volume || 0.08;
    let filterParts = [];
    let mixInputs = [];

    filterParts.push(`[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[nar]`);
    mixInputs.push('[nar]');

    if (music_segments && music_segments.length > 0) {
      music_segments.forEach((seg, i) => {
        const inputIdx = i + 2;
        const delayMs = Math.round((seg.start_time || 0) * 1000);
        const fadeIn = seg.fade_in || 2;
        const fadeOut = seg.fade_out || 1.5;
        const segDuration = seg.duration || 30;
        const fadeOutStart = Math.max(0, segDuration - fadeOut);

        let chain = `[${inputIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo`;
        chain += `,volume=${vol}`;
        chain += `,afade=t=in:d=${fadeIn}`;
        chain += `,afade=t=out:st=${fadeOutStart}:d=${fadeOut}`;
        if (delayMs > 0) {
          chain += `,adelay=${delayMs}|${delayMs}`;
        }
        chain += `[m${i}]`;

        filterParts.push(chain);
        mixInputs.push(`[m${i}]`);
      });
    }

    let audioFilter;
    if (mixInputs.length === 1) {
      audioFilter = filterParts[0].replace('[nar]', '[audio]');
    } else {
      audioFilter = filterParts.join(';') + ';' +
        mixInputs.join('') + `amix=inputs=${mixInputs.length}:duration=first:dropout_transition=2[audio]`;
    }

    let videoFilter = '';
    if (hasCaptions) {
      const escapedSrtPath = captionsPath.replace(/'/g, "'\\''").replace(/:/g, '\\:');
      const styleStr = getCaptionStyle(caption_style);
      videoFilter = `-vf "subtitles='${escapedSrtPath}':force_style='${styleStr}'"`;
    }

    const finalArgs = [
      `-y ${inputs}`,
      `-filter_complex "${audioFilter}"`,
      `-map 0:v ${videoFilter}`,
      `-map "[audio]"`,
      `-c:v libx264 -preset medium -crf 20`,
      `-c:a aac -b:a 192k`,
      `-movflags +faststart`,
      `-shortest`,
      `"${outputPath}"`
    ].join(' ');

    console.log(`[render] Starting final assembly`);
    const assemblyCmd = runFFmpeg(finalArgs, 'final assembly');
    renderLog.ffmpeg_commands.push({ step: 'assembly', command: assemblyCmd });

    if (!fs.existsSync(outputPath)) {
      throw new Error('FFmpeg produced no output file');
    }
    const outputSize = fs.statSync(outputPath).size;
    if (outputSize < 1000) {
      throw new Error(`Output file suspiciously small: ${outputSize} bytes`);
    }

    const outputDuration = probeDuration(outputPath);
    const assemblyTime = (Date.now() - assemblyStart) / 1000;
    console.log(`[render] Assembly complete: ${outputSize} bytes, ${outputDuration.toFixed(1)}s in ${assemblyTime.toFixed(1)}s`);
    renderLog.steps.push({ step: 'assembly', status: 'ok', duration_seconds: assemblyTime, output_duration: outputDuration, output_size: outputSize });

    // ================================================
    // STEP 5: Upload to B2
    // ================================================
    const uploadStart = Date.now();
    console.log(`[render] Uploading to B2: ${b2_path}`);
    const b2Url = await uploadToB2(outputPath, b2_path);
    const uploadTime = (Date.now() - uploadStart) / 1000;
    console.log(`[render] Upload complete: ${b2Url} in ${uploadTime.toFixed(1)}s`);
    renderLog.steps.push({ step: 'upload', status: 'ok', duration_seconds: uploadTime, b2_url: b2Url });

    // ================================================
    // STEP 6: Respond + write log
    // ================================================
    const processingTime = (Date.now() - startTime) / 1000;

    const result = {
      status: 'complete',
      success: true,
      b2_url: b2Url,
      duration: outputDuration,
      processing_time_seconds: processingTime,
      file_size: outputSize
    };

    renderLog.completed_at = new Date().toISOString();
    renderLog.result = result;
    writeRenderLog(genId, renderLog);

    console.log(`[render] Job ${genId} complete in ${processingTime.toFixed(1)}s`);
    res.json(result);

  } catch (err) {
    const processingTime = (Date.now() - startTime) / 1000;
    console.error(`[render] Job ${genId} failed:`, err.message);

    const errorResult = {
      status: 'error',
      success: false,
      error: err.message,
      processing_time_seconds: processingTime
    };

    renderLog.completed_at = new Date().toISOString();
    renderLog.result = errorResult;
    renderLog.steps.push({ step: 'error', error: err.message });
    writeRenderLog(genId, renderLog);

    res.status(500).json(errorResult);
  } finally {
    activeRenders--;
  }
}

module.exports = { handleRender };
