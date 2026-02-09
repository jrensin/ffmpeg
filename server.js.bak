require('dotenv').config();

const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const { selectMove, buildFFmpegCommand, MOVE_NAMES } = require('./kenburns');
const { uploadToB2 } = require('./b2');

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3500;
const TMP_DIR = process.env.TMP_DIR || '/opt/ffmpeg-api/tmp';
const API_KEY = process.env.API_KEY;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_JOBS) || 4;

let activeJobs = 0;

function authMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!API_KEY || key === API_KEY) return next();
  return res.status(401).json({ error: 'Invalid API key' });
}

app.use(authMiddleware);

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return resolve(downloadFile(response.headers.location, destPath));
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

async function cleanupJob(jobDir) {
  try { await fsp.rm(jobDir, { recursive: true, force: true }); }
  catch (e) { console.error(`Cleanup failed for ${jobDir}:`, e.message); }
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeJobs,
    maxConcurrent: MAX_CONCURRENT,
    availableMoves: MOVE_NAMES,
    uptime: process.uptime(),
  });
});

app.post('/kenburns', async (req, res) => {
  const startTime = Date.now();
  const jobId = uuidv4().slice(0, 8);
  const jobDir = path.join(TMP_DIR, `kb-${jobId}`);

  try {
    const { image_url, duration, b2_path, scene_number, generation_id } = req.body;
    const move_name = req.body.move_name || null;

    if (!image_url) return res.status(400).json({ error: 'image_url is required' });
    if (!duration) return res.status(400).json({ error: 'duration is required' });
    if (!b2_path) return res.status(400).json({ error: 'b2_path is required' });

    if (activeJobs >= MAX_CONCURRENT) {
      return res.status(429).json({ error: 'Server busy', activeJobs, maxConcurrent: MAX_CONCURRENT });
    }

    activeJobs++;
    console.log(`[${jobId}] Ken Burns — scene ${scene_number}, ${duration}s, move: ${move_name || 'auto'}`);

    await fsp.mkdir(jobDir, { recursive: true });

    const urlPath = new URL(image_url).pathname;
    const ext = path.extname(urlPath) || '.png';
    const inputPath = path.join(jobDir, `input${ext}`);
    const outputPath = path.join(jobDir, `scene_${String(scene_number).padStart(3, '0')}.mp4`);

    console.log(`[${jobId}] Downloading image...`);
    await downloadFile(image_url, inputPath);

    const selectedMove = move_name && MOVE_NAMES.includes(move_name)
      ? move_name
      : selectMove(scene_number || 0, 1);

    const clampedDuration = Math.min(Math.max(Number(duration), 2), 30);

    const ffmpegArgs = buildFFmpegCommand(inputPath, outputPath, selectedMove, clampedDuration);
    const ffmpegStart = Date.now();

    console.log(`[${jobId}] Running FFmpeg: ${selectedMove}...`);
    await execFileAsync(ffmpegArgs[0], ffmpegArgs.slice(1), {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const ffmpegTime = ((Date.now() - ffmpegStart) / 1000).toFixed(1);
    console.log(`[${jobId}] FFmpeg done in ${ffmpegTime}s`);

    console.log(`[${jobId}] Uploading to B2...`);
    const b2Url = await uploadToB2(outputPath, b2_path);

    await cleanupJob(jobDir);
    activeJobs--;

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${jobId}] Complete in ${totalTime}s`);

    return res.json({
      success: true,
      b2_url: b2Url,
      move_name: selectedMove,
      duration: clampedDuration,
      scene_number,
      generation_id,
      processing_time_seconds: parseFloat(totalTime),
    });

  } catch (err) {
    activeJobs = Math.max(0, activeJobs - 1);
    console.error(`[${jobId}] ERROR:`, err.message);
    await cleanupJob(jobDir);
    return res.status(500).json({ error: err.message, jobId });
  }
});

app.post('/kenburns/batch', async (req, res) => {
  const startTime = Date.now();
  const { scenes } = req.body;

  if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
    return res.status(400).json({ error: 'scenes array is required' });
  }

  console.log(`[batch] Starting ${scenes.length} Ken Burns jobs`);
  const results = [];

  for (const scene of scenes) {
    const jobId = uuidv4().slice(0, 8);
    const jobDir = path.join(TMP_DIR, `kb-${jobId}`);

    try {
      const { image_url, duration, b2_path, scene_number, generation_id, move_name } = scene;

      if (!image_url || !duration || !b2_path) {
        results.push({ scene_number, success: false, error: 'Missing required fields' });
        continue;
      }

      activeJobs++;
      await fsp.mkdir(jobDir, { recursive: true });

      const urlPath = new URL(image_url).pathname;
      const ext = path.extname(urlPath) || '.png';
      const inputPath = path.join(jobDir, `input${ext}`);
      const outputPath = path.join(jobDir, `scene_${String(scene_number).padStart(3, '0')}.mp4`);

      await downloadFile(image_url, inputPath);

      const selectedMove = move_name && MOVE_NAMES.includes(move_name)
        ? move_name
        : selectMove(scene_number || 0, scenes.length);

      const clampedDuration = Math.min(Math.max(Number(duration), 2), 30);
      const ffmpegArgs = buildFFmpegCommand(inputPath, outputPath, selectedMove, clampedDuration);

      const ffmpegStart = Date.now();
      await execFileAsync(ffmpegArgs[0], ffmpegArgs.slice(1), {
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const ffmpegTime = ((Date.now() - ffmpegStart) / 1000).toFixed(1);

      const b2Url = await uploadToB2(outputPath, b2_path);
      await cleanupJob(jobDir);
      activeJobs = Math.max(0, activeJobs - 1);

      console.log(`[batch] Scene ${scene_number}: ${selectedMove} in ${ffmpegTime}s`);
      results.push({
        scene_number, generation_id, success: true,
        b2_url: b2Url, move_name: selectedMove, duration: clampedDuration,
      });

    } catch (err) {
      activeJobs = Math.max(0, activeJobs - 1);
      await cleanupJob(jobDir);
      console.error(`[batch] Scene ${scene.scene_number} FAILED:`, err.message);
      results.push({ scene_number: scene.scene_number, success: false, error: err.message });
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`[batch] Done: ${succeeded} ok, ${failed} failed in ${totalTime}s`);

  return res.json({
    success: failed === 0,
    total: scenes.length, succeeded, failed,
    processing_time_seconds: parseFloat(totalTime),
    results,
  });
});

fs.mkdirSync(TMP_DIR, { recursive: true });

app.listen(PORT, () => {
  console.log(`FFmpeg API running on port ${PORT}`);
  console.log(`Moves: ${MOVE_NAMES.join(', ')}`);
  console.log(`Max concurrent: ${MAX_CONCURRENT}`);
});
