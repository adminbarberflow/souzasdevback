import test, {
  after
} from "node:test";

import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import {
  mkdtempSync,
  rmSync
} from "node:fs";

import os from "node:os";
import path from "node:path";

const testDirectory = mkdtempSync(
  path.join(
    os.tmpdir(),
    "souzas-dev-backend-"
  )
);

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "12345678901234567890123456789012";

process.env.DATABASE_PATH = path.join(
  testDirectory,
  "portfolio.test.sqlite"
);

process.env.LOG_FILE_PATH = path.join(
  testDirectory,
  "app.test.log"
);

process.env.TRUST_PROXY = "false";

const {
  createAppServer
} = await import(
  "../src/server.js"
);

const {
  closeDatabase
} = await import(
  "../src/database/database.js"
);

after(async () => {
  await closeDatabase();

  rmSync(testDirectory, {
    recursive: true,
    force: true
  });
});

function requestJson(
  server,
  pathname,
  options = {}
) {
  return new Promise((resolve, reject) => {
    const address = server.address();

    const port =
      typeof address === "object" &&
      address
        ? address.port
        : 0;

    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: options.method || "GET",

        headers: {
          ...(options.headers || {}),

          ...(options.body
            ? {
                "Content-Length":
                  Buffer.byteLength(
                    options.body
                  )
              }
            : {})
        }
      },

      (response) => {
        let data = "";

        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          try {
            resolve({
              statusCode:
                response.statusCode,

              headers:
                response.headers,

              body:
                data
                  ? JSON.parse(data)
                  : {}
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

async function withServer(callback) {
  const server = createAppServer();

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    return await callback(server);
  } finally {
    await new Promise(
      (resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }
    );
  }
}

test(
  "GET /api/status responde com sucesso",
  async () => {
    await withServer(async (server) => {
      const result = await requestJson(
        server,
        "/api/status"
      );

      assert.equal(
        result.statusCode,
        200
      );

      assert.equal(
        result.body.status,
        "success"
      );

      assert.equal(
        result.body.database.status,
        "connected"
      );
    });
  }
);

test(
  "GET /api/auth/csrf retorna token e cookie",
  async () => {
    await withServer(async (server) => {
      const result = await requestJson(
        server,
        "/api/auth/csrf"
      );

      assert.equal(
        result.statusCode,
        200
      );

      assert.match(
        result.body.csrfToken,
        /.+/
      );

      assert.ok(
        result.headers["set-cookie"]
      );
    });
  }
);

test(
  "POST /api/contact aceita mensagem válida",
  async () => {
    await withServer(async (server) => {
      const payload = JSON.stringify({
        name: "Ana Silva",
        email: "ana@example.com",
        message:
          "Mensagem de teste de integração para o projeto."
      });

      const result = await requestJson(
        server,
        "/api/contact",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: payload
        }
      );

      assert.equal(
        result.statusCode,
        201
      );

      assert.equal(
        result.body.status,
        "success"
      );

      assert.match(
        result.body.contactId,
        /.+/
      );
    });
  }
);
test(
  "CORS permite uma origem configurada",
  async () => {
    await withServer(async (server) => {
      const result = await requestJson(
        server,
        "/api/status",
        {
          headers: {
            Origin:
              "http://localhost:5500"
          }
        }
      );

      assert.equal(
        result.statusCode,
        200
      );

      assert.equal(
        result.headers[
          "access-control-allow-origin"
        ],
        "http://localhost:5500"
      );
    });
  }
);

test(
  "CORS rejeita uma origem não autorizada",
  async () => {
    await withServer(async (server) => {
      const result = await requestJson(
        server,
        "/api/status",
        {
          headers: {
            Origin:
              "https://origem-maliciosa.example"
          }
        }
      );

      assert.equal(
        result.statusCode,
        403
      );

      assert.equal(
        result.headers[
          "access-control-allow-origin"
        ],
        undefined
      );
    });
  }
);

test(
  "POST /api/auth/logout rejeita ausência de CSRF",
  async () => {
    await withServer(async (server) => {
      const result = await requestJson(
        server,
        "/api/auth/logout",
        {
          method: "POST"
        }
      );

      assert.equal(
        result.statusCode,
        403
      );

      assert.equal(
        result.body.message,
        "Token CSRF inválido ou ausente."
      );
    });
  }
);

test(
  "POST /api/auth/logout aceita um CSRF válido",
  async () => {
    await withServer(async (server) => {
      const csrfResult = await requestJson(
        server,
        "/api/auth/csrf"
      );

      const setCookie =
        csrfResult.headers["set-cookie"];

      const csrfCookie = Array.isArray(
        setCookie
      )
        ? setCookie[0].split(";")[0]
        : String(setCookie).split(";")[0];

      const logoutResult =
        await requestJson(
          server,
          "/api/auth/logout",
          {
            method: "POST",

            headers: {
              Cookie: csrfCookie,

              "X-CSRF-Token":
                csrfResult.body.csrfToken
            }
          }
        );

      assert.equal(
        logoutResult.statusCode,
        200
      );

      assert.equal(
        logoutResult.body.status,
        "success"
      );

      assert.ok(
        logoutResult.headers["set-cookie"]
      );
    });
  }
);

test(
  "respostas da API incluem os headers de segurança reforçados",
  async () => {
    await withServer(async (server) => {
      const result = await requestJson(
        server,
        "/api/status"
      );

      assert.equal(
        result.headers[
          "content-security-policy"
        ],
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
      );

      assert.equal(
        result.headers[
          "strict-transport-security"
        ],
        "max-age=15552000"
      );

      assert.equal(
        result.headers[
          "cross-origin-resource-policy"
        ],
        "same-site"
      );

      assert.equal(
        result.headers[
          "origin-agent-cluster"
        ],
        "?1"
      );

      assert.equal(
        result.headers[
          "x-permitted-cross-domain-policies"
        ],
        "none"
      );
    });
  }
);
