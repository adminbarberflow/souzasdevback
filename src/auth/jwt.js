import { randomUUID } from "node:crypto";

import {
  SignJWT,
  jwtVerify
} from "jose";

const JWT_SECRET =
  process.env.JWT_SECRET?.trim() || "";

const JWT_EXPIRES_IN =
  process.env.JWT_EXPIRES_IN?.trim() || "2h";

const JWT_ISSUER = "meu-portfolio-api";
const JWT_AUDIENCE = "meu-portfolio-admin";
const JWT_ALGORITHM = "HS256";

if (JWT_SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET ausente ou muito pequeno no arquivo .env."
  );
}

const secretKey = new TextEncoder().encode(
  JWT_SECRET
);

export async function createAccessToken(admin) {
  return new SignJWT({
    name: admin.name,
    email: admin.email,
    role: admin.role
  })
    .setProtectedHeader({
      alg: JWT_ALGORITHM,
      typ: "JWT"
    })
    .setSubject(admin.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(secretKey);
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(
    token,
    secretKey,
    {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: 5
    }
  );

  return payload;
}
