import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const fitDirectory = resolve(projectRoot, "fit files/files");
const dataPath = resolve(projectRoot, "public/data/swims.json");
const temporaryDataPath = resolve(projectRoot, "public/data/swims.next.json");
const exportScript = resolve(projectRoot, "scripts/export_swims.py");
const deletionStage = resolve(projectRoot, ".activity-delete-stage");
const maxFitSize = 25 * 1024 * 1024;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxFitSize) throw new Error("FIT files must be smaller than 25 MB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readSwimData() {
  return JSON.parse(await readFile(dataPath, "utf8"));
}

async function writeSwimData(data) {
  await writeFile(temporaryDataPath, JSON.stringify(data, null, 2), "utf8");
  await rename(temporaryDataPath, dataPath);
  return data;
}

async function parseSwimFile(path) {
  const { stdout } = await execFileAsync(process.env.PYTHON || "python3", [exportScript, "--file", path], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function fitImportPlugin() {
  return {
    name: "local-fit-import",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || "/", "http://localhost");
        if (url.pathname === "/api/delete-activities") {
          if (request.method !== "DELETE") return sendJson(response, 405, { error: "Only activity deletion is supported here." });
          const staged = [];
          let originalData = null;
          try {
            const body = JSON.parse((await readRequestBody(request)).toString("utf8"));
            const files = [...new Set(Array.isArray(body.files) ? body.files : [])];
            if (!files.length) return sendJson(response, 400, { error: "Select at least one activity to delete." });
            await mkdir(deletionStage, { recursive: true });

            for (const [index, requestedName] of files.entries()) {
              const safeName = basename(requestedName);
              if (safeName !== requestedName || extname(safeName).toLowerCase() !== ".fit") {
                throw new Error("One or more selected activity files are invalid.");
              }
              const source = resolve(fitDirectory, safeName);
              if (!(await fileExists(source))) throw new Error(`${safeName} could not be found.`);
              const stagedPath = resolve(deletionStage, `${Date.now()}-${index}-${safeName}`);
              await rename(source, stagedPath);
              staged.push({ source, stagedPath });
            }

            originalData = await readSwimData();
            const deletedFiles = new Set(files);
            const data = await writeSwimData({
              ...originalData,
              sessions: originalData.sessions.filter((session) => !deletedFiles.has(session.file)),
            });
            await Promise.all(staged.map(({ stagedPath }) => unlink(stagedPath)));
            return sendJson(response, 200, data);
          } catch (error) {
            await Promise.all(staged.map(async ({ source, stagedPath }) => {
              if (await fileExists(stagedPath)) await rename(stagedPath, source).catch(() => {});
            }));
            if (originalData) await writeSwimData(originalData).catch(() => {});
            return sendJson(response, 500, { error: error.message || "The selected activities could not be deleted." });
          }
        }

        if (url.pathname !== "/api/import-fit") return next();
        if (request.method !== "POST") return sendJson(response, 405, { error: "Only FIT file imports are supported." });

        const requestedName = url.searchParams.get("filename") || "";
        const safeName = basename(requestedName);
        if (!safeName || extname(safeName).toLowerCase() !== ".fit") {
          return sendJson(response, 415, { error: "Choose a file with the .fit extension." });
        }

        const targetPath = resolve(fitDirectory, safeName);
        if (await fileExists(targetPath)) {
          return sendJson(response, 409, { error: `${safeName} has already been imported.` });
        }

        try {
          const body = await readRequestBody(request);
          if (!body.length) return sendJson(response, 400, { error: "The selected FIT file is empty." });
          await mkdir(fitDirectory, { recursive: true });
          await writeFile(targetPath, body, { flag: "wx" });

          const imported = await parseSwimFile(targetPath);
          if (!imported) {
            await unlink(targetPath);
            return sendJson(response, 422, { error: "This FIT file does not contain a supported pool-swim activity." });
          }

          const currentData = await readSwimData();
          const data = await writeSwimData({
            ...currentData,
            sessions: [...currentData.sessions, imported].sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
          });

          return sendJson(response, 201, data);
        } catch (error) {
          if (await fileExists(targetPath)) {
            await unlink(targetPath).catch(() => {});
          }
          return sendJson(response, 500, { error: error.message || "The FIT file could not be imported." });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), fitImportPlugin()],
  server: {
    watch: {
      ignored: ["**/public/data/swims.json"],
    },
  },
});
