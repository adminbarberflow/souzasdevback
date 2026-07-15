import http from "node:http";
import { randomUUID } from "node:crypto";

import {
  clearAuthCookie,
  createAuthCookie,
  getAuthToken
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

const PORT =
  Number(process.env.PORT) || 3000;

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN?.trim() ||
  "http://localhost:5500";

const MAX_BODY_SIZE = 16_384;

const LOGIN_WINDOW_MS =
  15 * 60 * 1000;

const MAX_LOGIN_ATTEMPTS = 5;

const validStatuses = new Set([
  "new",
  "read",
  "archived"
]);

const loginAttempts = new Map();

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

function setCorsHeaders(response) {
  response.setHeader(
    "Access-Control-Allow-Origin",
    ALLOWED_ORIGIN
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
    "Content-Type"
  );

  response.setHeader(
    "Vary",
    "Origin"
  );
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
  return request.socket.remoteAddress ||
    "unknown";
}

function getLoginLimit(clientId) {
  const now = Date.now();

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

    return findAdminById(payload.sub) || null;
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
    findAdminByEmail(email);

  const passwordIsValid =
    admin &&
    await verifyPassword(
      password,
      admin.passwordHash
    );

  if (!admin || !passwordIsValid) {
    registerFailedLogin(clientId);

    sendJson(response, 401, {
      status: "error",
      message:
        "E-mail ou senha inválidos."
    });

    return;
  }

  clearLoginAttempts(clientId);

  const token =
    await createAccessToken(admin);

  response.setHeader(
    "Set-Cookie",
    createAuthCookie(token)
  );

  sendJson(response, 200, {
    status: "success",
    message: "Login realizado com sucesso.",

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
  setCorsHeaders(response);

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
          countContacts()
      }
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
      clearAuthCookie()
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

    createContact(contact);

    console.log("");
    console.log(
      "Nova mensagem salva:"
    );
    console.log(`ID: ${contact.id}`);
    console.log(
      `Nome: ${contact.name}`
    );
    console.log(
      `E-mail: ${contact.email}`
    );
    console.log(
      `Data: ${contact.createdAt}`
    );
    console.log("");

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
        listContacts(status),
      stats: getContactStats()
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
      updateContactStatus(
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
      deleteContact(contactId);

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

const server = http.createServer(
  (request, response) => {
    handleRequest(
      request,
      response
    ).catch((error) => {
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
  }
);

server.listen(PORT, () => {
  console.log(
    `Servidor rodando em http://localhost:${PORT}`
  );

  console.log(
    `Mensagens armazenadas: ${countContacts()}`
  );

  console.log(
    "Autenticação JWT habilitada."
  );
});

let isShuttingDown = false;

function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(
    "\nEncerrando servidor..."
  );

  server.close(() => {
    closeDatabase();

    console.log(
      "Servidor e banco encerrados."
    );

    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
