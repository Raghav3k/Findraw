import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const bucket = process.env.R2_BUCKET || "findraw-assets";
const concurrency = Math.max(1, Number(process.env.R2_UPLOAD_CONCURRENCY || 3));
const roots = ["public/auto-draw", "public/category-art"];
const progressDir = ".tmp";
const progressFile = path.join(progressDir, "r2-upload-complete.jsonl");
const doneFile = path.join("public", "DONE_ALL_ASSETS_UPLOADED.txt");
const cacheControl = "public,max-age=31536000,immutable";

const mimeTypes = new Map([
  [".avif", "image/avif"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".psd", "image/vnd.adobe.photoshop"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function contentType(filePath) {
  return mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}

function walk(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filePath, output);
    else output.push(filePath);
  }
  return output;
}

function objectKey(filePath) {
  return path.relative("public", filePath).replaceAll(path.sep, "/");
}

function loadCompleted() {
  const completed = new Set();
  if (!existsSync(progressFile)) return completed;
  for (const line of readFileSync(progressFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      completed.add(JSON.parse(line).key);
    } catch {
      // Ignore a partial final line from an interrupted upload.
    }
  }
  return completed;
}

function appendCompleted(entry) {
  mkdirSync(progressDir, { recursive: true });
  appendFileSync(progressFile, `${JSON.stringify(entry)}\n`, "utf8");
}

function upload(filePath) {
  const key = objectKey(filePath);
  const wrangler = "wrangler";
  const args = [
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--file",
    filePath,
    "--content-type",
    contentType(filePath),
    "--cache-control",
    cacheControl,
    "--remote",
  ];
  return new Promise((resolve, reject) => {
    const child = process.platform === "win32"
      ? spawn(`${wrangler} ${args.map((arg) => `"${arg.replaceAll('"', '""')}"`).join(" ")}`, {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
      : spawn(wrangler, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ key, bytes: statSync(filePath).size });
      else reject(new Error(`Upload failed for ${key}\n${output}`));
    });
  });
}

const files = roots.flatMap((root) => walk(root));
const completed = loadCompleted();
const pending = files.filter((file) => !completed.has(objectKey(file)));
const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
const pendingBytes = pending.reduce((sum, file) => sum + statSync(file).size, 0);

console.log(`Bucket: ${bucket}`);
console.log(`Total files: ${files.length}`);
console.log(`Already uploaded: ${files.length - pending.length}`);
console.log(`Pending files: ${pending.length}`);
console.log(`Total size: ${(totalBytes / 1024 / 1024 / 1024).toFixed(2)} GiB`);
console.log(`Pending size: ${(pendingBytes / 1024 / 1024 / 1024).toFixed(2)} GiB`);
console.log(`Concurrency: ${concurrency}`);

if (pending.length === 0) process.exit(0);

let index = 0;
let done = files.length - pending.length;
let uploadedBytes = totalBytes - pendingBytes;
let failed = false;

async function worker() {
  while (!failed && index < pending.length) {
    const file = pending[index++];
    try {
      const result = await upload(file);
      appendCompleted({ key: result.key, bytes: result.bytes, uploadedAt: new Date().toISOString() });
      done += 1;
      uploadedBytes += result.bytes;
      if (done % 10 === 0 || done === files.length) {
        console.log(`[${done}/${files.length}] ${(uploadedBytes / 1024 / 1024 / 1024).toFixed(2)} GiB uploaded - ${result.key}`);
      }
    } catch (error) {
      failed = true;
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

if (!failed) {
  writeFileSync(
    doneFile,
    [
      "Done: all Findraw assets uploaded to Cloudflare R2.",
      `Bucket: ${bucket}`,
      `Files uploaded: ${files.length}`,
      `Completed at: ${new Date().toISOString()}`,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`Created ${doneFile}`);
}
