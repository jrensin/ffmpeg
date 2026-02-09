// ============================================
// Ken Burns Complete Move Library
// json2video equivalents + advanced moves
// ============================================

// ── JSON2VIDEO EQUIVALENTS ────────────────────────────────
// These replicate the 8 effects from the current SH-KenBurns
// workflow. zoom values map to json2video's 1-10 scale.
// All use linear interpolation to match json2video behavior.

const J2V_EFFECTS = {

  // json2video: { zoom: 4, pan: 'top-right' }
  zoom_in_top_right: (frames) => ({
    z: `min(1.4, 1.0 + 0.4 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) + ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2) - ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),

  // json2video: { zoom: -3, pan: 'bottom-left' }
  zoom_out_bottom_left: (frames) => ({
    z: `max(1.0, 1.3 - 0.3 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) - ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2) + ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),

  // json2video: { zoom: 4, pan: 'left' }
  zoom_in_left: (frames) => ({
    z: `min(1.4, 1.0 + 0.4 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) - ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  // json2video: { zoom: -4, pan: 'right' }
  zoom_out_right: (frames) => ({
    z: `max(1.0, 1.4 - 0.4 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) + ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  // json2video: { zoom: 3, pan: 'top-left' }
  zoom_in_top_left: (frames) => ({
    z: `min(1.3, 1.0 + 0.3 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) - ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2) - ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),

  // json2video: { zoom: -4, pan: 'bottom' }
  zoom_out_bottom: (frames) => ({
    z: `max(1.0, 1.4 - 0.4 * on/${frames})`,
    x: `iw/2-(iw/zoom/2)`,
    y: `ih/2-(ih/zoom/2) + ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),

  // json2video: { zoom: 4, pan: 'bottom-right' }
  zoom_in_bottom_right: (frames) => ({
    z: `min(1.4, 1.0 + 0.4 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) + ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2) + ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),

  // json2video: { zoom: -3, pan: 'top' }
  zoom_out_top: (frames) => ({
    z: `max(1.0, 1.3 - 0.3 * on/${frames})`,
    x: `iw/2-(iw/zoom/2)`,
    y: `ih/2-(ih/zoom/2) - ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),
};

// Additional json2video-style effects for variety
const J2V_EXTRAS = {

  zoom_in_center: (frames) => ({
    z: `min(1.4, 1.0 + 0.4 * on/${frames})`,
    x: `iw/2-(iw/zoom/2)`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  zoom_out_center: (frames) => ({
    z: `max(1.0, 1.4 - 0.4 * on/${frames})`,
    x: `iw/2-(iw/zoom/2)`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  zoom_in_right: (frames) => ({
    z: `min(1.3, 1.0 + 0.3 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) + ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  zoom_out_left: (frames) => ({
    z: `max(1.0, 1.3 - 0.3 * on/${frames})`,
    x: `iw/2-(iw/zoom/2) - ((iw-iw/zoom)*0.07)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  pan_left: (frames) => ({
    z: `1.15`,
    x: `iw/2-(iw/zoom/2) + ((iw-iw/zoom)/2)*(1-on/${frames})`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  pan_right: (frames) => ({
    z: `1.15`,
    x: `iw/2-(iw/zoom/2) + ((iw-iw/zoom)/2)*(on/${frames})`,
    y: `ih/2-(ih/zoom/2)`,
  }),

  zoom_in_up: (frames) => ({
    z: `min(1.3, 1.0 + 0.3 * on/${frames})`,
    x: `iw/2-(iw/zoom/2)`,
    y: `ih/2-(ih/zoom/2) - ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),

  zoom_in_down: (frames) => ({
    z: `min(1.3, 1.0 + 0.3 * on/${frames})`,
    x: `iw/2-(iw/zoom/2)`,
    y: `ih/2-(ih/zoom/2) + ((ih-ih/zoom)*0.07)*(on/${frames})`,
  }),
};

// ── ADVANCED EASED MOVES ──────────────────────────────────
// These use easing curves for smoother, more cinematic motion.
// Duration-aware: zoom/pan scales with clip length.

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

const ADVANCED = {

  slow_push_in: (frames, opts = {}) => {
    const d = clamp(0.15 * ((opts.duration || 7) / 7), 0.05, 0.30);
    return {
      z: `1.0 + ${d} * (1 - cos(on/${frames} * PI)) / 2`,
      x: `(iw - iw/zoom) / 2`,
      y: `(ih - ih/zoom) / 2`,
    };
  },

  dramatic_pull_back: (frames, opts = {}) => {
    const d = clamp(0.35 * ((opts.duration || 7) / 7), 0.15, 0.50);
    const s = 1.0 + d;
    return {
      z: `${s} - ${d} * (1 - cos(on/${frames} * PI)) / 2`,
      x: `(iw - iw/zoom) / 2`,
      y: `(ih - ih/zoom) / 2`,
    };
  },

  lateral_drift_right: (frames, opts = {}) => {
    return {
      z: `1.15`,
      x: `(iw - iw/zoom) * (1 - cos(on/${frames} * PI)) / 2`,
      y: `(ih - ih/zoom) / 2`,
    };
  },

  lateral_drift_left: (frames, opts = {}) => {
    return {
      z: `1.15`,
      x: `(iw - iw/zoom) * (1 - (1 - cos(on/${frames} * PI)) / 2)`,
      y: `(ih - ih/zoom) / 2`,
    };
  },

  vertical_tilt_up: (frames, opts = {}) => {
    const d = clamp(0.05 * ((opts.duration || 7) / 7), 0.02, 0.10);
    return {
      z: `1.1 + ${d} * (1 - cos(on/${frames} * PI)) / 2`,
      x: `(iw - iw/zoom) / 2`,
      y: `(ih - ih/zoom) * (1 - (1 - cos(on/${frames} * PI)) / 2)`,
    };
  },

  vertical_tilt_down: (frames, opts = {}) => {
    const d = clamp(0.05 * ((opts.duration || 7) / 7), 0.02, 0.10);
    return {
      z: `1.1 + ${d} * (1 - cos(on/${frames} * PI)) / 2`,
      x: `(iw - iw/zoom) / 2`,
      y: `(ih - ih/zoom) * (1 - cos(on/${frames} * PI)) / 2`,
    };
  },

  diagonal_drift: (frames, opts = {}) => {
    return {
      z: `1.15`,
      x: `(iw - iw/zoom) * 0.3 * (1 - cos(on/${frames} * PI)) / 2`,
      y: `(ih - ih/zoom) * 0.7 * (1 - cos(on/${frames} * PI)) / 2`,
    };
  },

  push_to_corner: (frames, opts = {}) => {
    const d = clamp(0.25 * ((opts.duration || 7) / 7), 0.10, 0.40);
    const fx = opts.focal_x || 0.75;
    const fy = opts.focal_y || 0.25;
    return {
      z: `1.0 + ${d} * (1 - cos(on/${frames} * PI)) / 2`,
      x: `(iw - iw/zoom) * ${fx}`,
      y: `(ih - ih/zoom) * ${fy}`,
    };
  },

  subtle_float: (frames, opts = {}) => {
    return {
      z: `1.05 + 0.03 * sin(on/${frames} * PI)`,
      x: `(iw - iw/zoom) / 2 + 20 * sin(on/${frames} * PI * 2)`,
      y: `(ih - ih/zoom) / 2 + 10 * cos(on/${frames} * PI * 1.5)`,
    };
  },

  breathe: (frames, opts = {}) => {
    return {
      z: `1.08 + 0.04 * sin(on/${frames} * PI * 2)`,
      x: `(iw - iw/zoom) / 2`,
      y: `(ih - ih/zoom) / 2`,
    };
  },

  push_then_drift: (frames, opts = {}) => {
    const half = Math.round(frames / 2);
    return {
      z: `if(lt(on,${half}), 1.0+0.2*(1-cos(on/${half}*PI))/2, 1.2+0.02*sin((on-${half})/${half}*PI))`,
      x: `if(lt(on,${half}), (iw-iw/zoom)/2, (iw-iw/zoom)/2+30*(1-cos((on-${half})/${half}*PI))/2)`,
      y: `(ih - ih/zoom) / 2`,
    };
  },

  orbiting_drift: (frames, opts = {}) => {
    return {
      z: `1.12 + 0.03 * sin(on/${frames} * PI)`,
      x: `(iw - iw/zoom) / 2 + 40 * sin(on/${frames} * PI * 2)`,
      y: `(ih - ih/zoom) / 2 + 25 * cos(on/${frames} * PI * 2)`,
    };
  },

  dramatic_push_exponential: (frames, opts = {}) => {
    const d = clamp(0.35 * ((opts.duration || 7) / 7), 0.15, 0.50);
    return {
      z: `1.0 + ${d} * (1 - pow(2, -10 * on/${frames}))`,
      x: `(iw - iw/zoom) / 2`,
      y: `(ih - ih/zoom) * 0.40`,
    };
  },
};

// ── COMBINED LIBRARY ──────────────────────────────────────

const MOVES = { ...J2V_EFFECTS, ...J2V_EXTRAS, ...ADVANCED };
const MOVE_NAMES = Object.keys(MOVES);

// The 8 original json2video effects in cycle order
const J2V_CYCLE = [
  'zoom_in_top_right',
  'zoom_out_bottom_left',
  'zoom_in_left',
  'zoom_out_right',
  'zoom_in_top_left',
  'zoom_out_bottom',
  'zoom_in_bottom_right',
  'zoom_out_top',
];

function selectMove(sceneIndex, totalScenes) {
  // Cinematic move rotation - prefers subtle, centered moves for documentary content
  const CINEMATIC_CYCLE = [
    'slow_push_in',
    'lateral_drift_right',
    'dramatic_pull_back',
    'vertical_tilt_up',
    'diagonal_drift',
    'lateral_drift_left',
    'breathe',
    'vertical_tilt_down',
    'push_to_corner',
    'zoom_out_center',
    'subtle_float',
    'zoom_in_center',
  ];
  return CINEMATIC_CYCLE[sceneIndex % CINEMATIC_CYCLE.length];
}

function buildZoompanFilter(moveName, durationSeconds, fps = 30, opts = {}) {
  const totalFrames = Math.round(durationSeconds * fps);
  const move = MOVES[moveName];

  const expr = move(totalFrames, { duration: durationSeconds, ...opts });

  // Clamp x/y to prevent viewport going outside image bounds (no white edges)
  const safeX = `max(0, min(${expr.x}, iw-iw/zoom))`;
  const safeY = `max(0, min(${expr.y}, ih-ih/zoom))`;

  return `scale=3840:2160,zoompan=z='${expr.z}':x='${safeX}':y='${safeY}':d=${totalFrames}:s=1920x1080:fps=${fps}`;
}

function buildFFmpegCommand(inputPath, outputPath, moveName, durationSeconds, fps = 30, opts = {}) {
  const filter = buildZoompanFilter(moveName, durationSeconds, fps, opts);
  return [
    'ffmpeg', '-y',
    '-loop', '1',
    '-i', inputPath,
    '-vf', filter,
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath
  ];
}

module.exports = {
  MOVES,
  MOVE_NAMES,
  J2V_CYCLE,
  J2V_EFFECTS,
  J2V_EXTRAS,
  ADVANCED,
  selectMove,
  buildZoompanFilter,
  buildFFmpegCommand,
  clamp,
};
