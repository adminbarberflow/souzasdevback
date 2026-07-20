import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  clearAuthCookie,
  createAuthCookie,
  getAuthToken,
  parseCookies
} from "./auth/cookies.js";

import {
  createAccessToken,
  verifyAccessToken
} from "./auth/jwt.js";

import {
  verifyPassword
} from "./auth/password.js";

import {
  closeDatabase,
  countContacts,
  createContact,
  deleteContact,
  findAdminByEmail,
  findAdminById,
  getContactStats,
  listContacts,
  updateContactStatus
} from "./database/database.js";

import {
  logError,
  logInfo,
  logWarn
} from "./observability.js";

import {
  readPositiveIntegerEnv
} from "./config.js";

import {
  cleanupExpiredRateLimitEntries
} from "./rate-limit.js";

const PORT = readPositiveIntegerEnv(
  "PORT",
  3000,
  {
    max: 65_535
  }
);

const currentFilePath = fileURLToPath(
  import.meta.url
);

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGIN?.trim() ||
  "http://localhost:5500"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const MAX_BODY_SIZE = 16_384;

const LOGIN_WINDOW_MS =
  15 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 5;

const RATE_LIMIT_WINDOW_MS =
  readPositiveIntegerEnv(
    "RATE_LIMIT_WINDOW_MS",
    60_000
  );

const MAX_CONTACT_REQUESTS =
  readPositiveIntegerEnv(
    "MAX_CONTACT_REQUESTS",
    15
  );

const MAX_AUTH_REQUESTS =
  readPositiveIntegerEnv(
    "MAX_AUTH_REQUESTS",
    10
  );

const CSRF_COOKIE_NAME =
  process.env.CSRF_COOKIE_NAME?.trim() ||
  "portfolio_csrf";

const CSRF_MAX_AGE =
  readPositiveIntegerEnv(
    "AUTH_COOKIE_MAX_AGE",
    7200
  );

const TRUST_PROXY =
  process.env.TRUST_PROXY
    ?.trim()
    .toLowerCase() === "true";

const validStatuses = new Set([
  "new",
  "read",
  "archived"
]);

const loginAttempts = new Map();
const rateLimitBuckets = new Map();

const RATE_LIMIT_CLEANUP_INTERVAL_MS =
  60_000;

let lastRateLimitCleanupAt = 0;

function maybeCleanupRateLimitEntries(
  now = Date.now()
) {
  if (
    now - lastRateLimitCleanupAt <
    RATE_LIMIT_CLEANUP_INTERVAL_MS
  ) {
    return;
  }

  cleanupExpiredRateLimitEntries(
    rateLimitBuckets,
    loginAttempts,
    now
  );

  lastRateLimitCleanupAt = now;
}

function sendJson(
  response,
  statusCode,
  data
) {
  response.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  response.setHeader(
    "Cache-Control",
    "no-store"
  );

  response.statusCode = statusCode;
  response.end(JSON.stringify(data));
}

function getAllowedOrigin(requestOrigin = "") {
  if (
    !requestOrigin ||
    !ALLOWED_ORIGINS.includes(requestOrigin)
  ) {
    return "";
  }

  return requestOrigin;
}

function setSecurityHeaders(response) {
  response.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  response.setHeader(
    "X-Frame-Options",
    "DENY"
  );

  response.setHeader(
    "Referrer-Policy",
    "no-referrer"
  );

  response.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=()"
  );

  response.setHeader(
    "Cross-Origin-Opener-Policy",
    "same-origin"
  );


}

function setCorsHeaders(
  response,
  requestOrigin = ""
) {
  const allowedOrigin = getAllowedOrigin(
    requestOrigin
  );

  response.setHeader(
    "Vary",
    "Origin"
  );

  if (!allowedOrigin) {
    return false;
  }

  response.setHeader(
    "Access-Control-Allow-Origin",
    allowedOrigin
  );

  response.setHeader(
    "Access-Control-Allow-Credentials",
    "true"
  );

  response.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );

  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-CSRF-Token"
  );

  return true;
}
function requireJson(
  request,
  response
) {
  const contentType =
    request.headers["content-type"] || "";

  if (
    !contentType
      .toLowerCase()
      .includes("application/json")
  ) {
    sendJson(response, 415, {
      status: "error",
      message:
        "O Content-Type deve ser application/json."
    });

    return false;
  }

  return true;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let finished = false;

    request.setEncoding("utf8");

    request.on("data", (chunk) => {
      if (finished) {
        return;
      }

      body += chunk;

      if (
        Buffer.byteLength(body, "utf8") >
        MAX_BODY_SIZE
      ) {
        finished = true;

        reject(
          new Error("BODY_TOO_LARGE")
        );
      }
    });

    request.on("end", () => {
      if (finished) {
        return;
      }

      finished = true;

      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(
          new Error("INVALID_JSON")
        );
      }
    });

    request.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      reject(error);
    });
  });
}

function validateContact(data) {
  const errors = {};

  const name =
    typeof data.name === "string"
      ? data.name.trim()
      : "";

  const email =
    typeof data.email === "string"
      ? data.email.trim().toLowerCase()
      : "";

  const message =
    typeof data.message === "string"
      ? data.message.trim()
      : "";

  const emailPattern =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (
    name.length < 2 ||
    name.length > 80
  ) {
    errors.name =
      "O nome deve ter entre 2 e 80 caracteres.";
  }

  if (
    email.length > 254 ||
    !emailPattern.test(email)
  ) {
    errors.email =
      "Informe um e-mail válido.";
  }

  if (
    message.length < 10 ||
    message.length > 2000
  ) {
    errors.message =
      "A mensagem deve ter entre 10 e 2000 caracteres.";
  }

  return {
    isValid:
      Object.keys(errors).length === 0,

    errors,

    values: {
      name,
      email,
      message
    }
  };
}

function getClientIdentifier(request) {
  const forwardedFor =
    request.headers["x-forwarded-for"];

  if (
    TRUST_PROXY &&
    typeof forwardedFor === "string"
  ) {
    const forwardedAddress =
      forwardedFor
        .split(",")[0]
        .trim();

    if (forwardedAddress) {
      return forwardedAddress;
    }
  }

  return (
    request.socket.remoteAddress ||
    "unknown"
  );
}
function getRateLimitState(
  clientId,
  key,
  maxRequests,
  windowMs
) {
  const now = Date.now();

  maybeCleanupRateLimitEntries(now);
  const bucket =
    rateLimitBuckets.get(clientId) || new Map();

  const current = bucket.get(key) || {
    count: 0,
    resetAt: now + windowMs
  };

  if (current.resetAt <= now) {
    current.count = 0;
    current.resetAt = now + windowMs;
  }

  if (current.count >= maxRequests) {
    return {
      blocked: true,
      retryAfter: Math.max(
        1,
        Math.ceil(
          (current.resetAt - now) / 1000
        )
      )
    };
  }

  current.count += 1;
  bucket.set(key, current);
  rateLimitBuckets.set(clientId, bucket);

  return {
    blocked: false,
    retryAfter: 0
  };
}

function createCsrfCookie(token) {
  const parts = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${CSRF_MAX_AGE}`
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearCsrfCookie() {
  const parts = [
    `${CSRF_COOKIE_NAME}=`,
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT"
  ];

  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function getCsrfToken(request) {
  return (
    parseCookies(request.headers.cookie || "")[
      CSRF_COOKIE_NAME
    ] || ""
  );
}

function isCsrfValid(request) {
  if (
    request.method === "GET" ||
    request.method === "OPTIONS"
  ) {
    return true;
  }

  const cookieToken = getCsrfToken(request);
  const headerToken =
    request.headers["x-csrf-token"] ||
    request.headers["x-xsrf-token"] ||
    "";

  return Boolean(
    cookieToken &&
      headerToken &&
      cookieToken === headerToken
  );
}

function getLoginLimit(clientId) {
  const now = Date.now();

  maybeCleanupRateLimitEntries(now);

  const current =
    loginAttempts.get(clientId);

  if (
    !current ||
    current.resetAt <= now
  ) {
    return {
      blocked: false,
      retryAfter: 0
    };
  }

  if (
    current.count <
    MAX_LOGIN_ATTEMPTS
  ) {
    return {
      blocked: false,
      retryAfter: 0
    };
  }

  return {
    blocked: true,

    retryAfter: Math.max(
      1,
      Math.ceil(
        (current.resetAt - now) / 1000
      )
    )
  };
}

function registerFailedLogin(clientId) {
  const now = Date.now();

  const current =
    loginAttempts.get(clientId);

  if (
    !current ||
    current.resetAt <= now
  ) {
    loginAttempts.set(clientId, {
      count: 1,
      resetAt:
        now + LOGIN_WINDOW_MS
    });

    return;
  }

  current.count += 1;
  loginAttempts.set(clientId, current);
}

function clearLoginAttempts(clientId) {
  loginAttempts.delete(clientId);
}

async function getAuthenticatedAdmin(
  request
) {
  const token = getAuthToken(request);

  if (!token) {
    return null;
  }

  try {
    const payload =
      await verifyAccessToken(token);

    if (
      typeof payload.sub !== "string" ||
      payload.role !== "admin"
    ) {
      return null;
    }

    return (
      await findAdminById(payload.sub)
    ) || null;
  } catch {
    return null;
  }
}

async function handleLogin(
  request,
  response
) {
  if (!requireJson(request, response)) {
    return;
  }

  const clientId =
    getClientIdentifier(request);

  const limit = getLoginLimit(clientId);

  if (limit.blocked) {
    response.setHeader(
      "Retry-After",
      String(limit.retryAfter)
    );

    sendJson(response, 429, {
      status: "error",
      message:
        "Muitas tentativas. Aguarde alguns minutos."
    });

    return;
  }

  const authRateLimit = getRateLimitState(
    clientId,
    "auth:login",
    MAX_AUTH_REQUESTS,
    RATE_LIMIT_WINDOW_MS
  );

  if (authRateLimit.blocked) {
    response.setHeader(
      "Retry-After",
      String(authRateLimit.retryAfter)
    );

    sendJson(response, 429, {
      status: "error",
      message:
        "Muitas requisições. Tente novamente em alguns instantes."
    });

    return;
  }

  const body = await readJsonBody(request);

  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";

  const password =
    typeof body.password === "string"
      ? body.password
      : "";

  const admin =
    await findAdminByEmail(email);

  const passwordIsValid =
    admin &&
    await verifyPassword(
      password,
      admin.passwordHash
    );

  if (!admin || !passwordIsValid) {
    registerFailedLogin(clientId);
    logWarn("Falha de login");

    sendJson(response, 401, {
      status: "error",
      message:
        "E-mail ou senha inválidos."
    });

    return;
  }

  clearLoginAttempts(clientId);
  logInfo("Login realizado com sucesso", {
    adminId: admin.id
  });

  const token =
    await createAccessToken(admin);

  const csrfToken = randomUUID().replace(/-/g, "");

  response.setHeader(
    "Set-Cookie",
    [
      createAuthCookie(token),
      createCsrfCookie(csrfToken)
    ]
  );

  sendJson(response, 200, {
    status: "success",
    message: "Login realizado com sucesso.",
    csrfToken,

    user: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role
    }
  });
}

async function handleRequest(
  request,
  response
) {
  const requestOrigin =
    request.headers.origin || "";

  const corsAllowed = setCorsHeaders(
    response,
    requestOrigin
  );

  setSecurityHeaders(response);

  if (
    requestOrigin &&
    !corsAllowed
  ) {
    sendJson(response, 403, {
      status: "error",
      message: "Origem não autorizada."
    });

    return;
  }

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const host =
    request.headers.host ||
    `localhost:${PORT}`;

  const url = new URL(
    request.url || "/",
    `http://${host}`
  );

  if (
    request.method !== "GET" &&
    request.method !== "OPTIONS" &&
    ![
      "/api/contact",
      "/api/auth/login",
      "/api/auth/csrf"
    ].includes(url.pathname) &&
    url.pathname.startsWith("/api/") &&
    !isCsrfValid(request)
  ) {
    sendJson(response, 403, {
      status: "error",
      message:
        "Token CSRF inválido ou ausente."
    });

    return;
  }


  if (
    request.method === "GET" &&
    url.pathname === "/"
  ) {
    sendJson(response, 200, {
      status: "success",
      message:
        "Backend do meu portfólio.",

      endpoints: {
        status: "GET /api/status",
        login: "POST /api/auth/login",
        session: "GET /api/auth/me",
        logout: "POST /api/auth/logout",
        contact: "POST /api/contact"
      }
    });

    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/status"
  ) {
    sendJson(response, 200, {
      status: "success",
      message:
        "API do portfólio funcionando.",

      database: {
        status: "connected",
        storedContacts:
          await countContacts()
      }
    });

    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/auth/csrf"
  ) {
    const csrfToken = randomUUID().replace(/-/g, "");

    response.setHeader(
      "Set-Cookie",
      createCsrfCookie(csrfToken)
    );

    sendJson(response, 200, {
      status: "success",
      csrfToken
    });

    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/auth/login"
  ) {
    await handleLogin(
      request,
      response
    );

    return;
  }

  if (
    request.method === "GET" &&
    url.pathname === "/api/auth/me"
  ) {
    const admin =
      await getAuthenticatedAdmin(
        request
      );

    if (!admin) {
      sendJson(response, 401, {
        status: "error",
        message:
          "Sessão inválida ou expirada."
      });

      return;
    }

    sendJson(response, 200, {
      status: "success",
      user: admin
    });

    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/auth/logout"
  ) {
    response.setHeader(
      "Set-Cookie",
      [clearAuthCookie(), clearCsrfCookie()]
    );

    sendJson(response, 200, {
      status: "success",
      message:
        "Logout realizado com sucesso."
    });

    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/contact"
  ) {
    if (!requireJson(request, response)) {
      return;
    }

    const clientId =
      getClientIdentifier(request);

    const contactRateLimit = getRateLimitState(
      clientId,
      "contact",
      MAX_CONTACT_REQUESTS,
      RATE_LIMIT_WINDOW_MS
    );

    if (contactRateLimit.blocked) {
      response.setHeader(
        "Retry-After",
        String(contactRateLimit.retryAfter)
      );

      sendJson(response, 429, {
        status: "error",
        message:
          "Muitas mensagens enviadas. Tente novamente mais tarde."
      });

      return;
    }

    const body =
      await readJsonBody(request);

    const validation =
      validateContact(body);

    if (!validation.isValid) {
      sendJson(response, 400, {
        status: "error",
        message:
          "Existem campos inválidos.",
        errors: validation.errors
      });

      return;
    }

    const contact = {
      id: randomUUID(),
      ...validation.values,
      status: "new",
      createdAt:
        new Date().toISOString()
    };

    await createContact(contact);
    logInfo("Mensagem recebida", {
      contactId: contact.id
    });

    sendJson(response, 201, {
      status: "success",
      message:
        "Mensagem enviada com sucesso.",
      contactId: contact.id
    });

    return;
  }

  if (
    url.pathname.startsWith(
      "/api/admin/"
    )
  ) {
    const admin =
      await getAuthenticatedAdmin(
        request
      );

    if (!admin) {
      sendJson(response, 401, {
        status: "error",
        message:
          "Sessão inválida ou expirada."
      });

      return;
    }
  }

  if (
    request.method === "GET" &&
    url.pathname ===
      "/api/admin/contacts"
  ) {
    const status =
      url.searchParams.get("status") ||
      "";

    if (
      status &&
      !validStatuses.has(status)
    ) {
      sendJson(response, 400, {
        status: "error",
        message:
          "Filtro de status inválido."
      });

      return;
    }

    sendJson(response, 200, {
      status: "success",
      contacts:
        await listContacts(status),
      stats:
        await getContactStats()
    });

    return;
  }

  const contactMatch =
    url.pathname.match(
      /^\/api\/admin\/contacts\/([^/]+)$/
    );

  if (
    request.method === "PATCH" &&
    contactMatch
  ) {
    if (!requireJson(request, response)) {
      return;
    }

    const contactId =
      decodeURIComponent(
        contactMatch[1]
      );

    const body =
      await readJsonBody(request);

    const status = body.status;

    if (!validStatuses.has(status)) {
      sendJson(response, 400, {
        status: "error",
        message: "Status inválido."
      });

      return;
    }

    const contact =
      await updateContactStatus(
        contactId,
        status
      );

    if (!contact) {
      sendJson(response, 404, {
        status: "error",
        message:
          "Mensagem não encontrada."
      });

      return;
    }

    sendJson(response, 200, {
      status: "success",
      message: "Status atualizado.",
      contact
    });

    return;
  }

  if (
    request.method === "DELETE" &&
    contactMatch
  ) {
    const contactId =
      decodeURIComponent(
        contactMatch[1]
      );

    const deleted =
      await deleteContact(contactId);

    if (!deleted) {
      sendJson(response, 404, {
        status: "error",
        message:
          "Mensagem não encontrada."
      });

      return;
    }

    sendJson(response, 200, {
      status: "success",
      message:
        "Mensagem excluída."
    });

    return;
  }

  sendJson(response, 404, {
    status: "error",
    message: "Rota não encontrada."
  });
}

export function createAppServer() {
  return http.createServer((request, response) => {
    handleRequest(
      request,
      response
    ).catch((error) => {
      logError("Erro interno do servidor", {
        message: error?.message || String(error)
      });

      if (
        error.message === "INVALID_JSON"
      ) {
        sendJson(response, 400, {
          status: "error",
          message: "JSON inválido."
        });

        return;
      }

      if (
        error.message ===
        "BODY_TOO_LARGE"
      ) {
        sendJson(response, 413, {
          status: "error",
          message:
            "O conteúdo ultrapassa o limite permitido."
        });

        return;
      }

      console.error(
        "Erro interno:",
        error
      );

      if (!response.headersSent) {
        sendJson(response, 500, {
          status: "error",
          message:
            "Erro interno do servidor."
        });

        return;
      }

      response.end();
    });
  });
}

let server = null;
let isShuttingDown = false;

async function startServer() {
  if (server) {
    return server;
  }

  const storedContacts =
    await countContacts();

  server = createAppServer();

  server.listen(PORT, () => {
    console.log(
      `Servidor rodando em http://localhost:${PORT}`
    );

    console.log(
      `Mensagens armazenadas: ${storedContacts}`
    );

    console.log(
      "Autenticação JWT habilitada."
    );
  });

  return server;
}

function shutdown() {
  if (isShuttingDown || !server) {
    return;
  }

  isShuttingDown = true;

  console.log(
    "\nEncerrando servidor..."
  );

  server.close(async () => {
    try {
      await closeDatabase();

      console.log(
        "Servidor e banco encerrados."
      );

      process.exit(0);
    } catch (error) {
      console.error(
        "Não foi possível encerrar o banco:",
        error
      );

      process.exit(1);
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    currentFilePath
) {
  startServer().catch(async (error) => {
    console.error(
      "Não foi possível iniciar o servidor:",
      error
    );

    try {
      await closeDatabase();
    } catch (closeError) {
      console.error(
        "Também não foi possível encerrar o banco:",
        closeError
      );
    }

    process.exitCode = 1;
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
