import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = join(root, "lib/party/players.ts");
const bundlePath = join(root, "private/roster.enc");
const remotePath = "block-party-2026/assets/roster.enc";
const ids = ["brady", "sophie", "emilie", "troy", "chase", "daniel", "macy", "luke", "owen", "gleb"];
const demoMark = "// Block Party public demo roster.";
const header = "BPROSTER1";
const aad = Buffer.from("BLOCK PARTY private roster v1");
const photoPath = id => join(root, "public", "players", id + ".jpg");

function keyFromEnvironment() {
  const raw = process.env.ROSTER_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== raw) {
    throw new Error("ROSTER_KEY must be exactly 32 random bytes encoded as unpadded base64url.");
  }
  return key;
}

function writeAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path).equals(Buffer.from(data))) return;
  const temp = join(dirname(path), ".roster-" + randomUUID() + ".tmp");
  try {
    writeFileSync(temp, data, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

function jpeg(buffer) {
  return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function seal(key) {
  if (!key) throw new Error("Set ROSTER_KEY in the environment before sealing the roster.");
  if (!existsSync(sourcePath) || !ids.every(id => existsSync(photoPath(id)))) {
    throw new Error("The full local roster and its ten JPEGs are required to seal.");
  }
  const source = readFileSync(sourcePath, "utf8");
  if (source.startsWith(demoMark)) throw new Error("The public demo cannot replace the private roster.");
  const photos = {};
  for (const id of ids) {
    const bytes = readFileSync(photoPath(id));
    if (!jpeg(bytes)) throw new Error("A roster portrait is not a JPEG.");
    photos[id] = bytes.toString("base64");
  }
  const plain = gzipSync(Buffer.from(JSON.stringify({ version: 1, source, photos })));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const packet = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
  writeAtomic(bundlePath, header + "\n" + packet + "\n");
  console.log("Sealed the private roster.");
}

function decodeBundle(bundle, key) {
  let payload;
  try {
    const lines = bundle.toString("utf8").trimEnd().split("\n");
    const [format, packet] = lines;
    if (lines.length !== 2 || format !== header || !packet) throw new Error();
    const bytes = Buffer.from(packet, "base64");
    if (bytes.length <= 28 || bytes.toString("base64") !== packet) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12), { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const compressed = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    payload = JSON.parse(gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }).toString("utf8"));
  } catch {
    throw new Error("Could not authenticate or read the private roster. Check the key and bundle.");
  }
  if (payload?.version !== 1 || typeof payload.source !== "string" || !payload.source ||
      !payload.photos || Object.keys(payload.photos).length !== ids.length) throw new Error("Invalid private roster format.");
  const portraits = ids.map(id => {
    if (typeof payload.photos[id] !== "string") throw new Error("Incomplete private roster.");
    const bytes = Buffer.from(payload.photos[id], "base64");
    if (!jpeg(bytes)) throw new Error("A private portrait is damaged.");
    return { id, bytes };
  });
  return { source: payload.source, portraits };
}

async function readRemoteBundle() {
  try {
    const { get } = await import("@vercel/blob");
    const blob = await get(remotePath, { access: "private", useCache: false });
    if (!blob) return null;
    if (blob.statusCode !== 200 || blob.blob.size > 48 * 1024 * 1024) throw new Error();
    return Buffer.from(await new Response(blob.stream).arrayBuffer());
  } catch {
    throw new Error("Could not read the roster from the attached private Blob store.");
  }
}

async function store(key) {
  if (process.env.VERCEL !== "1") throw new Error("Run the one-time store command from the trusted Vercel build.");
  if (!key || !existsSync(bundlePath)) throw new Error("The one-time upload needs ROSTER_KEY and the local encrypted bundle.");
  const bundle = readFileSync(bundlePath);
  decodeBundle(bundle, key); // Never install a damaged bundle.
  let existing = await readRemoteBundle();
  if (!existing) {
    try {
      const { put } = await import("@vercel/blob");
      await put(remotePath, bundle, {
        access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "application/octet-stream",
      });
    } catch {
      // A concurrent bootstrap or a lost acknowledgment can leave a valid file.
      // Compare the authoritative bytes before declaring the upload successful.
    }
    existing = await readRemoteBundle();
  }
  if (!existing) throw new Error("The private roster upload could not be confirmed.");
  if (!existing.equals(bundle)) throw new Error("A different private roster already exists. The existing file was preserved.");
  console.log("Verified the roster in private storage.");
}

async function prepare(key) {
  if (key) {
    const bundle = existsSync(bundlePath) ? readFileSync(bundlePath) : await readRemoteBundle();
    if (!bundle) throw new Error("The encrypted roster has not been installed in private storage.");
    const { source, portraits } = decodeBundle(bundle, key);
    for (const { id, bytes } of portraits) writeAtomic(photoPath(id), bytes);
    writeAtomic(sourcePath, source);
    console.log("Prepared the private roster.");
    return;
  }
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_TARGET_ENV === "production" ||
      (process.env.VERCEL === "1" && !process.env.VERCEL_ENV)) {
    throw new Error("Set the private ROSTER_KEY in the production environment before building.");
  }
  if (existsSync(sourcePath) && !readFileSync(sourcePath, "utf8").startsWith(demoMark)) {
    if (!ids.every(id => existsSync(photoPath(id)))) throw new Error("The local roster is missing portraits. Supply ROSTER_KEY to restore them.");
    return;
  }
  const template = readFileSync(join(root, "scripts", "demo-roster.ts.template"), "utf8");
  writeAtomic(sourcePath, template.replace("__ROSTER_IDS__", JSON.stringify(ids)));
  console.log("Prepared the public demo roster.");
}

try {
  const command = process.argv[2];
  if (!["prepare", "seal", "store"].includes(command)) throw new Error("Usage: node scripts/roster.mjs prepare|seal|store");
  const key = keyFromEnvironment();
  if (command === "prepare") await prepare(key);
  else if (command === "store") await store(key);
  else seal(key);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Roster preparation failed.");
  process.exitCode = 1;
}
