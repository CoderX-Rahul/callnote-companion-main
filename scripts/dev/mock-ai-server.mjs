import http from "node:http";

const port = Number(process.argv[2] ?? 8787);
const server = http.createServer((request, response) => {
  const mode =
    new URL(request.url ?? "/", "http://127.0.0.1").pathname.split("/").filter(Boolean)[0] ?? "400";
  console.log(`Mock AI request mode=${mode}`);
  if (mode === "hang") return;
  if (mode === "slow") {
    setTimeout(() => {
      if (!response.destroyed) send(response, 200);
    }, 50_000);
    return;
  }
  if (mode === "429" || mode === "429-no-header") {
    if (mode === "429") response.setHeader("Retry-After", "2");
    return send(response, 429, { error: { message: "Mock rate limit" } });
  }
  if (mode === "500") return send(response, 500, { error: { message: "Mock server error" } });
  return send(response, 400, { error: { message: "Mock bad request" } });
});

function send(response, statusCode, body = { error: { message: "Mock response" } }) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

server.listen(port, "127.0.0.1", () =>
  console.log(`Mock AI server listening on 127.0.0.1:${port}`),
);
