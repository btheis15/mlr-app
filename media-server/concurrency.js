// Tiny in-process concurrency limiter (no dependency).
//
// The upload handler runs CPU-heavy work inline: ffmpeg transcodes (libx264),
// ffmpeg frame-sampling, and sharp downscales. /upload is rate-limited only
// per-IP (30/hr), so several family members uploading videos at once could
// spawn N parallel encodes and peg every core on the mini. This bounds how many
// of those heavy operations run at once; excess callers queue (FIFO) and run as
// slots free up. A rejected/thrown task still releases its slot.
//
// Usage:
//   const { createLimiter } = require("./concurrency");
//   const heavy = createLimiter(2);
//   const result = await heavy(() => maybeTranscode(path, mime));
function createLimiter(maxConcurrent) {
  const max = Math.max(1, Number(maxConcurrent) || 1);
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

module.exports = { createLimiter };
