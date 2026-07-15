import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";

import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const HASH_PREFIX = "scrypt";

export async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12
  ) {
    throw new Error(
      "A senha deve possuir pelo menos 12 caracteres."
    );
  }

  const salt = randomBytes(SALT_LENGTH).toString("hex");

  const derivedKey = await scrypt(
    password,
    salt,
    KEY_LENGTH
  );

  return [
    HASH_PREFIX,
    salt,
    Buffer.from(derivedKey).toString("hex")
  ].join(":");
}

export async function verifyPassword(
  password,
  storedPasswordHash
) {
  if (
    typeof password !== "string" ||
    typeof storedPasswordHash !== "string"
  ) {
    return false;
  }

  const [
    prefix,
    salt,
    storedHashHex
  ] = storedPasswordHash.split(":");

  if (
    prefix !== HASH_PREFIX ||
    !salt ||
    !storedHashHex
  ) {
    return false;
  }

  const storedHash = Buffer.from(
    storedHashHex,
    "hex"
  );

  const derivedKey = Buffer.from(
    await scrypt(
      password,
      salt,
      storedHash.length
    )
  );

  if (storedHash.length !== derivedKey.length) {
    return false;
  }

  return timingSafeEqual(
    storedHash,
    derivedKey
  );
}
