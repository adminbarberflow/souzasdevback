import test from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  "12345678901234567890123456789012";

const {
  hashPassword,
  verifyPassword
} = await import("../src/auth/password.js");

const {
  createAuthCookie,
  parseCookies
} = await import("../src/auth/cookies.js");

const {
  createAccessToken,
  verifyAccessToken
} = await import("../src/auth/jwt.js");

test("hashPassword e verifyPassword validam credenciais corretamente", async () => {
  const password = "senhaForte123!";
  const hash = await hashPassword(password);

  assert.match(hash, /^scrypt:/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("senhaErrada123!", hash), false);
});

test("createAuthCookie gera um cookie seguro e parseCookies decodifica o valor", () => {
  const cookie = createAuthCookie("token-123");

  assert.match(cookie, /portfolio_session=token-123/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /SameSite=Strict/);

  const parsed = parseCookies(
    "portfolio_session=token-123; outro=valor"
  );

  assert.equal(parsed.portfolio_session, "token-123");
  assert.equal(parsed.outro, "valor");
});

test("createAccessToken e verifyAccessToken funcionam para um admin", async () => {
  const token = await createAccessToken({
    id: "admin-1",
    name: "Admin",
    email: "admin@example.com",
    role: "admin"
  });

  const payload = await verifyAccessToken(token);

  assert.equal(payload.sub, "admin-1");
  assert.equal(payload.role, "admin");
  assert.equal(payload.email, "admin@example.com");
});
