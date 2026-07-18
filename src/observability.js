import {
  appendFileSync,
  mkdirSync
} from "node:fs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(
  import.meta.url
);

const currentDirectory = path.dirname(
  currentFile
);

const defaultLogPath = path.resolve(
  currentDirectory,
  "../data/logs/app.log"
);

const configuredLogPath =
  process.env.LOG_FILE_PATH?.trim() || "";

const logFilePath = configuredLogPath
  ? path.resolve(configuredLogPath)
  : defaultLogPath;

mkdirSync(path.dirname(logFilePath), {
  recursive: true
});

function formatEntry(
  level,
  message,
  meta = {}
) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };

  return `${JSON.stringify(payload)}\n`;
}

export function logEvent(
  level,
  message,
  meta = {}
) {
  appendFileSync(
    logFilePath,
    formatEntry(level, message, meta),
    {
      encoding: "utf8"
    }
  );
}

export function logInfo(
  message,
  meta = {}
) {
  logEvent("info", message, meta);
}

export function logWarn(
  message,
  meta = {}
) {
  logEvent("warn", message, meta);
}

export function logError(
  message,
  meta = {}
) {
  logEvent("error", message, meta);
}