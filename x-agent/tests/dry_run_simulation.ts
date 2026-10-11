import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";

const html = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

function tweet(author: string, id: string, text: string): string {
  return `<article data-testid="tweet"><a href="/${author}/status/${id}"><time>now</time></a><a href="/${author}">@${author}</a><div data-testid="tweetText">${text}</div></article>`;
}

const server = createServer((request, response) => {
  const path = new URL(request.url || "/", "http://localhost").pathname;
  response.setHeader("Content-Type", "application/json");

  if (path === "/health") {
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (path === "/api/reading/reply") {
    response.end(JSON.stringify({ reply: "Programmable ownership changes the collateral layer first." }));
    return;
  }
  if (path === "/api/reading/market_cycle") {
    response.end(JSON.stringify({
      post: [
        "Bullish watchlist (TVL trend only, not a buy call): Example (Ethereum). TVL is rising. Automated screens: no flags; neither rules out a rug. Sources: #DeFi #Ethereum",
        "https://defillama.com/protocol/example",
        `https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=0x${"a".repeat(40)}`,
        `https://api.gopluslabs.io/api/v1/rugpull_detecting/1?contract_addresses=0x${"a".repeat(40)}`
      ].join(" ")
    }));
    return;
  }

  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (path === "/xoshi_Si/with_replies") {
    response.end(html(tweet("alice", "101", "@xoshi_Si what changes when equities are tokenized?")));
    return;
  }
  if (path === "/search") {
    response.end(html(tweet("bob", "202", "Tokenized stocks need credible settlement rails.")));
    return;
  }
  if (path.startsWith("/i/status/")) {
    response.end(html(`
      <button data-testid="reply" aria-label="Reply">Reply</button>
      <script>
        document.querySelector('[data-testid="reply"]').addEventListener('click', () => {
          const editor = document.createElement('div');
          editor.setAttribute('data-testid', 'tweetTextarea_0');
          editor.setAttribute('contenteditable', 'true');
          document.body.appendChild(editor);
          const send = document.createElement('button');
          send.setAttribute('data-testid', 'tweetButtonInline');
          send.textContent = 'Send';
          send.addEventListener('click', () => { editor.textContent = ''; });
          document.body.appendChild(send);
        });
      </script>
    `));
    return;
  }
  if (path === "/compose/post" || path === "/compose/tweet") {
    response.end(html('<div data-testid="tweetTextarea_0" contenteditable="true"></div><button data-testid="tweetButton">Send</button>'));
    return;
  }
  response.end(html('<main>Authenticated X mock</main>'));
});

function closeServer(): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

async function run(): Promise<void> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsNode = require.resolve("ts-node/dist/bin.js");

  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [tsNode, "run_cycle.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DRY_RUN: "true",
        FASTAPI_URL: baseUrl,
        X_BASE_URL: baseUrl,
        XOSHI_HANDLE: "xoshi_Si",
        GIST_ID: "",
        GIST_TOKEN: "",
        TWITTER_AUTH_TOKEN: "",
        TWITTER_CT0: ""
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Dry-run simulation timed out. Output:\n${output}`));
    }, 60000);
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });

  await closeServer();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /DRY_RUN: reply prepared; no publish attempted\./);
  assert.match(result.output, /DRY_RUN: daily post prepared; no publish attempted\./);
  assert.match(result.output, /DRY_RUN: persistent memory not updated\./);
  assert.doesNotMatch(result.output, /Reply sent|Daily post sent/);
  console.log("Playwright DRY_RUN simulation passed.");
}

run().catch(async error => {
  await closeServer().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
