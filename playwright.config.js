// Test setup for Voynich Viewer. Run everything with `npm test`.
// The site is plain static files, so the tests serve the folder with Python's built-in web server (the same command the
// README gives for running the site locally) and drive a real Chromium browser against it.
const { defineConfig, devices } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

// Each checkout of the repository gets its own port: the same one every time for this folder, and (almost always) a
// different one for another folder or worktree. Playwright reuses whatever is already listening on the port, so with one
// shared port a server serving ANOTHER checkout's files would be tested instead of this one's, and the results would be about the
// wrong code. VV_PORT overrides it.
const PORT = +process.env.VV_PORT || 4300 + (parseInt(crypto.createHash("md5").update(__dirname).digest("hex").slice(0, 6), 16) % 700);
const CI = !!process.env.CI;
// Two test runs at the same time (two terminals, or you and a second Claude session) would delete each other's working
// files in a shared "test-results" folder and fail with ENOENT. So each local run gets a private folder. The HTML report
// (npm run test:report) still has the screenshots and traces of anything that failed.
if (!CI && !process.env.VV_TEST_OUTPUT) process.env.VV_TEST_OUTPUT = fs.mkdtempSync(path.join(os.tmpdir(), "voynich-tests-"));

module.exports = defineConfig({
  testDir: "tests",
  outputDir: CI ? "test-results" : process.env.VV_TEST_OUTPUT,
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: CI,                       // a stray test.only must never let a broken build through
  retries: CI ? 1 : 0,                  // one retry in CI, so a blip is not a red build but a real failure still is
  workers: CI ? 2 : 4,                  // software-drawn 3D is heavy; this many keeps a busy laptop steady
  // GitHub's machines draw the 3D view in software about four times slower than a laptop: the same tests get more time there
  timeout: CI ? 120_000 : 45_000,
  expect: { timeout: CI ? 15_000 : 8_000 },
  reporter: CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    reducedMotion: "reduce",            // the site honours it: no page-turn or 3D animation, so tests are quick and steady
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !CI,
    stderr: "ignore",                   // the server logs every file it sends; that is a wall of text in the test output
    timeout: 30_000,
  },

  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.js/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1360, height: 860 },
        // headless Chromium has no GPU: SwiftShader draws WebGL in software so the 3D view can be tested
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.js/,
      use: {
        ...devices["Pixel 7"],
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
    },
  ],
});
