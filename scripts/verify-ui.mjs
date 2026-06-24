import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const baseUrl = "http://127.0.0.1:5174/";
const outputDir = new URL("../verification-output/", import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const chromePaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function outputPath(name) {
  return fileURLToPath(new URL(name, outputDir));
}

async function waitForServer(processHandle) {
  let output = "";

  processHandle.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  processHandle.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (output.includes("Local:") || output.includes("ready")) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Vite did not start.\n${output}`);
}

async function stopServer(processHandle) {
  if (!processHandle.pid || processHandle.exitCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  processHandle.kill("SIGTERM");
}

async function launchBrowser() {
  for (const executablePath of chromePaths) {
    try {
      return await chromium.launch({ executablePath, headless: true });
    } catch {
      // Try the next locally installed browser path.
    }
  }

  return chromium.launch({ headless: true });
}

function rowsState() {
  return {
    red: { selected: [], lock: "none" },
    yellow: { selected: [], lock: "none" },
    green: { selected: [], lock: "none" },
    blue: { selected: [], lock: "none" },
  };
}

function activeGameForRoll(roll) {
  const players = [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ];

  return {
    page: "play",
    players,
    selectedPlayerId: "alice",
    currentPlayerIndex: 0,
    rows: rowsState(),
    penalties: 0,
    turn: {
      roll,
      opponentWhiteSum: null,
      selectedMarks: [],
      penalty: false,
      opponentLocks: [],
    },
    gameOver: false,
    gameOverReason: null,
  };
}

async function setGame(page, game) {
  await page.goto(baseUrl);
  await page.evaluate((nextGame) => {
    localStorage.clear();
    localStorage.setItem("qwixx.players.v1", JSON.stringify(nextGame.players));
    localStorage.setItem("qwixx.selectedPlayer.v1", nextGame.selectedPlayerId);
    localStorage.setItem("qwixx.activeGame.v1", JSON.stringify(nextGame));
  }, game);
  await page.reload();
}

async function runFlowChecks(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.screenshot({ path: outputPath("home-empty-mobile.png"), fullPage: true });

  for (const name of ["Alice", "Bob", "Cora"]) {
    await page.getByPlaceholder("Name").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
  }

  await page.screenshot({ path: outputPath("home-filled-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Start" }).click();
  await page.screenshot({ path: outputPath("play-idle-mobile.png"), fullPage: true });

  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Next starts disabled on the user's turn.");
  await page.getByRole("button", { name: "Roll dice" }).click();
  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Next stays disabled after rolling with no mark.");
  assert((await page.locator("button.score-tile.hint-white, button.score-tile.hint-mixed").count()) === 0, "Hints default off.");

  await page.getByRole("button", { name: "Show legal options" }).click();
  assert((await page.locator("button.score-tile.hint-white, button.score-tile.hint-mixed").count()) > 0, "Hint toggle shows legal options.");
  await page.getByRole("button", { name: "Hide legal options" }).click();

  const firstLegalTile = page.locator("button.score-tile.legal").first();
  assert((await firstLegalTile.count()) === 1, "At least one legal score tile appears after rolling.");
  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.getByRole("dialog", { name: "Undo roll?" }).count()) === 1, "Undoing a roll asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
  assert((await page.locator(".die .pip.visible").count()) > 0, "Canceling roll undo keeps the roll.");

  await firstLegalTile.click();
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Next enables after one valid user mark.");
  await page.getByRole("button", { name: "Undo" }).click();
  assert((await page.getByRole("dialog", { name: "Undo roll?" }).count()) === 0, "Undoing a mark does not ask for roll confirmation.");
  assert(await page.getByRole("button", { name: "Next" }).isDisabled(), "Undoing one mark keeps the roll but disables Next.");
  assert((await page.locator(".die .pip.visible").count()) > 0, "Undoing one mark does not clear the dice roll.");

  await page.locator("button.score-tile.legal").first().click();
  await page.screenshot({ path: outputPath("play-user-mark-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Next" }).click();
  await page.reload();
  assert((await page.getByRole("heading", { name: "Bob" }).count()) === 1, "Committed turn state persists after reload.");
  assert((await page.locator(".sum-strip.needs-input").count()) === 1, "Opponent turn prompts the white-sum row.");
  assert((await page.locator(".dice-grid.pale").count()) === 1, "Opponent turn dice appear pale.");

  await page.getByRole("button", { name: "White sum 6" }).click();
  assert((await page.locator(".sum-strip.needs-input").count()) === 0, "White-sum prompt disappears after selection.");
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Opponent turn enables Next after white sum.");
  await page.getByRole("button", { name: "Red locked" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  assert((await page.locator(".die.red").count()) === 0, "Closed red row removes the red die after Next.");
  await page.screenshot({ path: outputPath("play-red-locked-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "Start over" }).click();
  assert((await page.getByRole("dialog", { name: "Start over?" }).count()) === 1, "Start over asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Exit" }).click();
  assert((await page.getByRole("dialog", { name: "Exit?" }).count()) === 1, "Exit asks for confirmation.");
  await page.getByRole("button", { name: "Cancel" }).click();
}

async function runAmbiguityChecks(page) {
  await setGame(page, activeGameForRoll({ whiteA: 3, whiteB: 4, red: 4, yellow: 1, green: 1, blue: 1 }));
  await page.getByRole("button", { name: "Red 7" }).click();
  assert(
    (await page.locator('button.score-tile.legal[aria-label="Red 8"]').count()) === 1,
    "Ambiguous Red 7 keeps Red 8 legal as a mixed follow-up.",
  );
  await page.getByRole("button", { name: "Red 8" }).click();
  assert(!(await page.getByRole("button", { name: "Next" }).isDisabled()), "Ambiguous two-mark turn can complete.");

  await setGame(page, activeGameForRoll({ whiteA: 4, whiteB: 4, red: 3, yellow: 1, green: 1, blue: 1 }));
  await page.getByRole("button", { name: "Red 7" }).click();
  assert(
    (await page.locator('button.score-tile.legal[aria-label="Red 8"]').count()) === 0,
    "Unambiguous mixed Red 7 does not allow a later white Red 8.",
  );
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const server = spawn(npmCommand(), ["exec", "vite", "--", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
    cwd: projectRoot,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await Promise.race([
      waitForServer(server),
      once(server, "exit").then(([code]) => {
        throw new Error(`Vite exited before verification started with code ${code}.`);
      }),
    ]);

    const browser = await launchBrowser();
    const mobile = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });
    await runFlowChecks(mobile);
    await runAmbiguityChecks(mobile);

    const desktop = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 900, height: 900 } });
    await setGame(desktop, activeGameForRoll({ whiteA: 3, whiteB: 4, red: 4, yellow: 2, green: 6, blue: 1 }));
    await desktop.screenshot({ path: outputPath("play-desktop.png"), fullPage: true });

    await browser.close();
  } finally {
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
