/** Start an isolated official DSH web host, never a browser or model request. */
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const redactHostOutput = (text) =>
  String(text).replace(/token=[^\s"'<>]+/g, "token=[redacted]");

/** Deliberately omit inherited account/provider/API credentials and user homes. */
export async function officialHostOptions({
  runtime = ".research/runtime-020",
  home,
  port = "0",
} = {}) {
  const runtimeRoot = resolve(projectRoot, runtime);
  const version = JSON.parse(
    await readFile(
      resolve(runtimeRoot, "node_modules/@deepseek-ai/dsh/package.json"),
      "utf8",
    ),
  ).version;
  const isolatedRoot = resolve(projectRoot, home ?? `.host-test/${version}`);
  const relativeHome = relative(
    resolve(projectRoot, ".host-test"),
    isolatedRoot,
  );
  if (
    !relativeHome ||
    isAbsolute(relativeHome) ||
    relativeHome === ".." ||
    relativeHome.startsWith(`..${sep}`)
  ) {
    throw new Error(
      "DSH_TEST_HOME must select an isolated subdirectory under this project's .host-test.",
    );
  }
  const cwd = resolve(isolatedRoot, "workdir");
  const inherited = [
    "PATH",
    "LANG",
    "LC_ALL",
    "TERM",
    "TZ",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
  ];
  const env = Object.fromEntries(
    inherited
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    HOME: resolve(isolatedRoot, "home"),
    DSH_HOME: resolve(isolatedRoot, "dsh"),
    XDG_DATA_HOME: resolve(isolatedRoot, "xdg-data"),
    XDG_CACHE_HOME: resolve(isolatedRoot, "xdg-cache"),
    XDG_CONFIG_HOME: resolve(isolatedRoot, "xdg-config"),
    PNPM_HOME: resolve(projectRoot, ".research/pnpm"),
    npm_config_cache: resolve(isolatedRoot, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org",
  });
  await Promise.all(
    [cwd, env.HOME, env.DSH_HOME].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  return {
    cli: resolve(runtimeRoot, "node_modules/@deepseek-ai/dsh/lib/bin.js"),
    version,
    isolatedRoot,
    cwd,
    env,
    port,
    projectRoot,
  };
}

async function runOfficial(options, args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [options.cli, ...args], {
      env: options.env,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          "Official DSH command timed out: " + redactHostOutput(output),
        ),
      );
    }, 180_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) done(output);
      else
        reject(
          new Error(
            `Official DSH command exited ${code}: ${redactHostOutput(output)}`,
          ),
        );
    });
  });
}

/** Use only the official profile initialization and plugin installation commands. */
export async function installOfficialPlugin(options) {
  await runOfficial(options, ["web", "--help"]);
  await runOfficial(options, [
    "plugin",
    "--profile",
    "web",
    "add",
    options.projectRoot,
    "--store-dir",
    resolve(projectRoot, ".research/pnpm/store"),
  ]);
}

/** Return the private launch URL in memory; callers must not print it. */
export async function launchOfficialHost(options) {
  const host = spawn(
    process.execPath,
    [
      options.cli,
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      String(options.port),
      "--no-open",
    ],
    { env: options.env, cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  let hostLog = "";
  const url = await new Promise((done, reject) => {
    const timer = setTimeout(() => {
      host.kill("SIGTERM");
      reject(new Error("Host startup timed out: " + redactHostOutput(hostLog)));
    }, 90_000);
    const accept = (chunk) => {
      hostLog += chunk;
      const match = hostLog.match(/dsh web: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    };
    host.stdout.on("data", accept);
    host.stderr.on("data", accept);
    host.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited ${code}: ${redactHostOutput(hostLog)}`));
    });
  });
  return {
    host,
    url,
    stop: () => host.kill("SIGTERM"),
    redactedLog: () => redactHostOutput(hostLog),
  };
}

async function main() {
  const options = await officialHostOptions({
    runtime: process.env.DSH_TEST_RUNTIME || ".research/runtime-020",
    home: process.env.DSH_TEST_HOME || ".host-test/preview-020",
    port: process.env.DSH_TEST_PORT || "5202",
  });
  console.log(`Preparing isolated official DSH ${options.version} preview.`);
  await installOfficialPlugin(options);
  const running = await launchOfficialHost(options);
  const launchUrl = new URL(running.url);
  if (process.env.DSH_PREVIEW_MOCK === "1")
    launchUrl.searchParams.set("canvasMock", "1");
  const launchFile = resolve(options.isolatedRoot, "launch-url.txt");
  await writeFile(launchFile, launchUrl.toString() + "\n", { mode: 0o600 });
  await chmod(launchFile, 0o600);
  console.log(
    `Official DSH ${options.version} is ready on 127.0.0.1:${options.port}.`,
  );
  console.log(`Private launch URL saved locally: ${launchFile}`);
  console.log(
    "No browser opened. No model request sent. Keep this terminal running.",
  );
  const stop = () => {
    running.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  running.host.once("exit", async (code) => {
    await rm(launchFile, { force: true });
    process.exitCode = code === 0 || code === null ? 0 : code;
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(redactHostOutput(error.message));
    process.exitCode = 1;
  });
}
