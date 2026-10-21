// Converts audio from files.salebot.pro into Telegram voice format (OGG/Opus).
// Usage: GET /voice.ogg?src=<url of mp3/m4a/wav on files.salebot.pro>
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;

const ALLOWED = ["files.salebot.pro"];
const cache = new Map();

function convert(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-i", file,
      "-vn", "-ac", "1", "-ar", "48000",
      "-c:a", "libopus", "-b:a", "48k", "-application", "voip",
      "-f", "ogg", "pipe:1",
    ]);
    const out = [], err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) => {
      const buf = Buffer.concat(out);
      if (code !== 0 || !buf.length) reject(new Error(Buffer.concat(err).toString() || "ffmpeg failed"));
      else resolve(buf);
    });
  });
}

http.createServer(async (req, res) => {
  const send = (status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/" || url.pathname === "/health") return send(200, "ok");
    if (!url.pathname.endsWith(".ogg")) return send(404, "not found");

    const src = url.searchParams.get("src");
    if (!src) return send(400, "src required");
    let host;
    try { host = new URL(src).hostname; } catch { return send(400, "bad src"); }
    if (!ALLOWED.includes(host)) return send(403, "host not allowed");

    let out = cache.get(src);
    if (!out) {
      const r = await fetch(src);
      if (!r.ok) return send(502, "source fetch failed: " + r.status);
      // m4a can keep its index at the end of the file, so give ffmpeg a real file, not a pipe
      const tmp = path.join(os.tmpdir(), "in-" + crypto.randomUUID());
      fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
      try { out = await convert(tmp); } finally { fs.rmSync(tmp, { force: true }); }
      cache.set(src, out);
    }
    send(200, out, {
      "Content-Type": "audio/ogg",
      "Content-Disposition": 'inline; filename="voice.ogg"',
      "Cache-Control": "public, max-age=86400",
    });
  } catch (e) {
    send(500, "error: " + e.message);
  }
}).listen(process.env.PORT || 3000, () => console.log("voice converter up"));
