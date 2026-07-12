import { execFile } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const staticRoot = resolve(projectRoot, "dist");
const seedDataPath = resolve(projectRoot, "public/data/swims.json");
const runtimeRoot = resolve(process.env.DATA_DIR || join(projectRoot, ".runtime-data"));
const fitDirectory = join(runtimeRoot, "fits");
const dataPath = join(runtimeRoot, "swims.json");
const temporaryDataPath = join(runtimeRoot, "swims.next.json");
const exportScript = resolve(projectRoot, "scripts/export_swims.py");
const port = Number(process.env.PORT || 3000);
const maxFitSize = 25 * 1024 * 1024;
let mutationQueue = Promise.resolve();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function initializeStorage() {
  await mkdir(fitDirectory, { recursive: true });
  if (!(await exists(dataPath))) await copyFile(seedDataPath, dataPath);
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxFitSize) throw new Error("FIT files must be smaller than 25 MB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readData() {
  return JSON.parse(await readFile(dataPath, "utf8"));
}

async function writeData(data) {
  await writeFile(temporaryDataPath, JSON.stringify(data, null, 2), "utf8");
  await rename(temporaryDataPath, dataPath);
  return data;
}

function serializeMutation(task) {
  const result = mutationQueue.then(task, task);
  mutationQueue = result.catch(() => {});
  return result;
}

async function parseFit(path) {
  const { stdout } = await execFileAsync(process.env.PYTHON || "python3", [exportScript, "--file", path], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function importFit(request, response, url) {
  if (request.method !== "POST") return json(response, 405, { error: "Only FIT file imports are supported." });
  const requestedName = url.searchParams.get("filename") || "";
  const safeName = basename(requestedName);
  if (!safeName || safeName !== requestedName || extname(safeName).toLowerCase() !== ".fit") {
    return json(response, 415, { error: "Choose a file with the .fit extension." });
  }

  try {
    const body = await requestBody(request);
    if (!body.length) return json(response, 400, { error: "The selected FIT file is empty." });
    const data = await serializeMutation(async () => {
      const targetPath = join(fitDirectory, safeName);
      if (await exists(targetPath)) throw Object.assign(new Error(`${safeName} has already been imported.`), { status: 409 });
      await writeFile(targetPath, body, { flag: "wx" });
      try {
        const imported = await parseFit(targetPath);
        if (!imported) throw Object.assign(new Error("This FIT file does not contain a supported pool-swim activity."), { status: 422 });
        const current = await readData();
        return await writeData({
          ...current,
          sessions: [...current.sessions.filter((session) => session.file !== safeName), imported]
            .sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
        });
      } catch (error) {
        await unlink(targetPath).catch(() => {});
        throw error;
      }
    });
    return json(response, 201, data);
  } catch (error) {
    return json(response, error.status || 500, { error: error.message || "The FIT file could not be imported." });
  }
}

async function deleteActivities(request, response) {
  if (request.method !== "DELETE") return json(response, 405, { error: "Only activity deletion is supported here." });
  try {
    const body = JSON.parse((await requestBody(request)).toString("utf8"));
    const files = [...new Set(Array.isArray(body.files) ? body.files : [])];
    if (!files.length) return json(response, 400, { error: "Select at least one activity to delete." });
    for (const name of files) {
      if (basename(name) !== name || extname(name).toLowerCase() !== ".fit") {
        return json(response, 400, { error: "One or more selected activity files are invalid." });
      }
    }
    const data = await serializeMutation(async () => {
      const current = await readData();
      const deleted = new Set(files);
      const updated = await writeData({ ...current, sessions: current.sessions.filter((session) => !deleted.has(session.file)) });
      await Promise.all(files.map((name) => unlink(join(fitDirectory, name)).catch(() => {})));
      return updated;
    });
    return json(response, 200, data);
  } catch (error) {
    return json(response, 500, { error: error.message || "The selected activities could not be deleted." });
  }
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = resolve(staticRoot, requested);
  const path = candidate.startsWith(staticRoot) && await exists(candidate) ? candidate : join(staticRoot, "index.html");
  const content = await readFile(path);
  response.writeHead(200, { "Content-Type": mimeTypes[extname(path)] || "application/octet-stream" });
  response.end(content);
}

await initializeStorage();

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/data/swims.json") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(await readFile(dataPath));
    }
    if (url.pathname === "/api/import-fit") return await importFit(request, response, url);
    if (url.pathname === "/api/delete-activities") return await deleteActivities(request, response);
    return await serveStatic(response, url.pathname);
  } catch (error) {
    return json(response, 500, { error: error.message || "The request could not be completed." });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Fit Track is running on port ${port}`);
});
