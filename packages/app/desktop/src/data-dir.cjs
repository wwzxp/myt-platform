"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/app/desktop/src/data-dir.ts
var data_dir_exports = {};
__export(data_dir_exports, {
  isSystemDrive: () => isSystemDrive,
  readConfig: () => readConfig,
  resolveDataDir: () => resolveDataDir,
  writeConfig: () => writeConfig
});
module.exports = __toCommonJS(data_dir_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var CONFIG_FILE = "myt.config.json";
function resolveDataDir(options) {
  const env = options.env ?? process.env;
  const drives = options.availableDrives ?? defaultAvailableDrives;
  const writable = options.isWritable ?? defaultIsWritable;
  const suggested = (0, import_node_path.join)(firstNonSystemDrive(drives) ?? options.fallbackDir, "MYT");
  const fromEnv = env["MYT_DATA_DIR"]?.trim();
  if (fromEnv) {
    return {
      dir: fromEnv,
      source: "env",
      onSystemDrive: isSystemDrive(fromEnv),
      suggested,
      needsPrompt: false
    };
  }
  const config = readConfig(options.configDir);
  if (config.dataDir && config.dataDir.trim().length > 0) {
    return {
      dir: config.dataDir,
      source: "config",
      onSystemDrive: isSystemDrive(config.dataDir),
      suggested,
      needsPrompt: false
    };
  }
  const portable = (0, import_node_path.join)(options.installDir, "data");
  if (writable(options.installDir)) {
    return {
      dir: portable,
      source: "install",
      onSystemDrive: isSystemDrive(portable),
      suggested,
      needsPrompt: config.skipped !== true
    };
  }
  return {
    dir: options.fallbackDir,
    source: "fallback",
    onSystemDrive: isSystemDrive(options.fallbackDir),
    suggested,
    needsPrompt: config.skipped !== true
  };
}
function readConfig(configDir) {
  try {
    const raw = (0, import_node_fs.readFileSync)((0, import_node_path.join)(configDir, CONFIG_FILE), "utf8");
    const parsed = JSON.parse(raw);
    const result = {};
    if (typeof parsed["dataDir"] === "string") result.dataDir = parsed["dataDir"];
    if (typeof parsed["skipped"] === "boolean") result.skipped = parsed["skipped"];
    return result;
  } catch {
    return {};
  }
}
function writeConfig(configDir, config) {
  (0, import_node_fs.mkdirSync)(configDir, { recursive: true });
  const target = (0, import_node_path.join)(configDir, CONFIG_FILE);
  const tmp = `${target}.tmp`;
  const payload = {};
  if (config.dataDir !== void 0) payload["dataDir"] = config.dataDir;
  if (config.skipped !== void 0) payload["skipped"] = config.skipped;
  (0, import_node_fs.writeFileSync)(tmp, JSON.stringify(payload, null, 2), "utf8");
  (0, import_node_fs.renameSync)(tmp, target);
}
function isSystemDrive(path) {
  if (process.platform !== "win32") return false;
  return /^c:/iu.test(path);
}
function defaultAvailableDrives() {
  if (process.platform !== "win32") return [];
  const candidates = ["D:", "E:", "F:", "G:"];
  return candidates.filter((drive) => (0, import_node_fs.existsSync)(`${drive}\\`));
}
function firstNonSystemDrive(drives) {
  return drives().find((drive) => !isSystemDrive(drive));
}
function defaultIsWritable(dir) {
  try {
    (0, import_node_fs.mkdirSync)(dir, { recursive: true });
    const probe = (0, import_node_path.join)(dir, `.write-probe-${Date.now()}`);
    (0, import_node_fs.writeFileSync)(probe, "", "utf8");
    (0, import_node_fs.rmSync)(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isSystemDrive,
  readConfig,
  resolveDataDir,
  writeConfig
});
