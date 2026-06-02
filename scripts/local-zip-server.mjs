import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] || "..");

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname).replace(/^\/+/, "");
  const file = resolve(join(root, pathname || "siyu-factory-ai-render.zip"));
  if (!file.startsWith(root)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }
  try {
    const stat = statSync(file);
    response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": stat.size });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("not found");
  }
}).listen(8899, () => {
  console.log(`serving ${root}`);
});
