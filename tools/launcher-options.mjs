import { basename, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { parseDesignSource } from "../src/app/designInput.js";
import { parseCellConfig } from "../src/infer/cellConfig.js";
import { parseTimingLog } from "../src/timing/timingParser.js";

export const STARTUP_ENDPOINT = "/__ngb_startup__.json";

export class LauncherArgumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "LauncherArgumentError";
    this.exitCode = 2;
  }
}

export function parseLauncherArgs(argv, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const command = ["start", "stop", "status"].includes(argv[0]) ? argv[0] : "start";
  const firstOption = command === "start" && argv[0] === "start" ? 1 : command === "start" ? 0 : 1;
  const result = {
    command,
    port: parsePort(env.PORT || "4173", "PORT"),
    openBrowser: true,
    help: false,
    force: false,
    replaceExisting: false,
    parentDeath: false,
    stateFile: null,
    inputs: {},
    target: {}
  };
  const valueOptions = new Map([
    ["--port", "port"],
    ["--netlist", "netlist"],
    ["--timing", "timing"],
    ["--cell-config", "cellConfig"],
    ["--module", "module"],
    ["--focus", "focus"],
    ["--fanin-depth", "faninDepth"],
    ["--fanout-depth", "fanoutDepth"],
    ["--state-file", "stateFile"]
  ]);

  for (let index = firstOption; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-open" || argument === "--no-browser") {
      result.openBrowser = false;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (argument === "--force") {
      result.force = true;
      continue;
    }
    if (argument === "--replace") {
      result.replaceExisting = true;
      continue;
    }
    if (argument === "--parent-death") {
      result.parentDeath = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key) throw new LauncherArgumentError(`Unknown option: ${argument}`);
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new LauncherArgumentError(`${argument} requires a value`);
    }
    if (key === "port") result.port = parsePort(value, argument);
    else if (key === "faninDepth" || key === "fanoutDepth") result.target[key] = parseDepth(value, argument);
    else if (key === "stateFile") result.stateFile = resolve(cwd, value);
    else if (key === "module" || key === "focus") result.target[key] = value;
    else result.inputs[key] = resolve(cwd, value);
  }
  if (result.replaceExisting && !result.stateFile) {
    throw new LauncherArgumentError("--replace requires --state-file");
  }
  return result;
}

export async function createStartupManifest(options, readText = (path) => readFile(path, "utf8")) {
  const manifest = { version: 1, inputs: {}, target: { ...options.target } };
  let design = null;
  for (const kind of ["cellConfig", "netlist", "timing"]) {
    const path = options.inputs[kind];
    if (!path) continue;
    let text;
    try {
      text = await readText(path);
    } catch (error) {
      throw new LauncherArgumentError(`Cannot read --${toKebab(kind)} file ${path}: ${error.message}`);
    }
    try {
      if (kind === "cellConfig") parseCellConfig(text);
      if (kind === "netlist") design = parseDesignSource(text);
      if (kind === "timing") {
        const timing = parseTimingLog(text);
        if ((timing.scopeCount || timing.instanceCount || 0) === 0) throw new Error("no timing records recognized");
      }
    } catch (error) {
      throw new LauncherArgumentError(`Invalid --${toKebab(kind)} file ${path}: ${error.message}`);
    }
    manifest.inputs[kind] = { name: basename(path), text };
  }
  validateTarget(manifest.target, design);
  return manifest;
}

export function buildStartupUrl(port, manifest) {
  const url = new URL(`http://127.0.0.1:${port}/`);
  if (hasStartupRequest(manifest)) url.searchParams.set("startup", "1");
  return url.href;
}

export function createReadyRecord(port, manifest) {
  return {
    event: "ready",
    host: "127.0.0.1",
    port,
    url: buildStartupUrl(port, manifest),
    startup: {
      netlist: manifest.inputs.netlist?.name || null,
      timing: manifest.inputs.timing?.name || null,
      cellConfig: manifest.inputs.cellConfig?.name || null,
      module: manifest.target.module || null,
      focus: manifest.target.focus || null,
      faninDepth: manifest.target.faninDepth ?? null,
      fanoutDepth: manifest.target.fanoutDepth ?? null
    }
  };
}

export function getLauncherHelp(command = "node tools/serve.mjs") {
  return `Usage: ${command} [start|stop|status] [options]\n\n` +
    "  --netlist <path>       structural Verilog to load\n" +
    "  --timing <path>        Global/Local or LocResyn timing text\n" +
    "  --cell-config <path>   versioned Cell Config JSON\n" +
    "  --module <name>        module selected after loading\n" +
    "  --focus <instance>     cell instance to open as a focused neighborhood\n" +
    "  --fanin-depth <0-99>   focused fanin depth\n" +
    "  --fanout-depth <0-99>  focused fanout depth\n" +
    "  --port <0-65535>       localhost port; 0 selects an idle port (default: 4173)\n" +
    "  --state-file <path>    managed session state file\n" +
    "  --replace              stop the verified session in state-file first\n" +
    "  --parent-death         stop when the launching process exits\n" +
    "  --force                force stop when used with stop\n" +
    "  --no-open              do not open the default browser\n" +
    "  -h, --help             show this help";
}

function validateTarget(target, design) {
  if (!design) return;
  const module = target.module
    ? design.modules.find((item) => item.name === target.module || item.displayName === target.module)
    : design.modules[0];
  if (target.module && !module) throw new LauncherArgumentError(`Module not found in netlist: ${target.module}`);
  if (!target.focus || !module) return;
  const focus = target.focus.replace(/^cell:/, "");
  if (!module.cells.some((cell) => cell.instance === focus || cell.instanceDisplayName === focus)) {
    throw new LauncherArgumentError(`Focus cell not found in module ${module.name}: ${target.focus}`);
  }
}

function hasStartupRequest(manifest) {
  return Object.keys(manifest.inputs).length > 0 || Object.keys(manifest.target).length > 0;
}

function parsePort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new LauncherArgumentError(`${label} must be an integer from 0 to 65535`);
  }
  return port;
}

function parseDepth(value, label) {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 0 || depth > 99) {
    throw new LauncherArgumentError(`${label} must be an integer from 0 to 99`);
  }
  return depth;
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
