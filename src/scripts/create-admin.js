import { randomUUID } from "node:crypto";

import {
  closeDatabase,
  upsertAdmin
} from "../database/database.js";

import {
  hashPassword
} from "../auth/password.js";

const name =
  process.env.ADMIN_NAME?.trim() || "";

const email =
  process.env.ADMIN_EMAIL
    ?.trim()
    .toLowerCase() || "";

const password =
  process.env.ADMIN_PASSWORD || "";

const emailPattern =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (name.length < 2 || name.length > 80) {
  console.error(
    "ADMIN_NAME deve possuir entre 2 e 80 caracteres."
  );

  process.exitCode = 1;
} else if (!emailPattern.test(email)) {
  console.error(
    "ADMIN_EMAIL deve ser um e-mail válido."
  );

  process.exitCode = 1;
} else if (password.length < 12) {
  console.error(
    "A senha deve possuir pelo menos 12 caracteres."
  );

  process.exitCode = 1;
} else {
  try {
    const now = new Date().toISOString();

    const passwordHash =
      await hashPassword(password);

    const admin = await upsertAdmin({
      id: randomUUID(),
      name,
      email,
      passwordHash,
      role: "admin",
      createdAt: now,
      updatedAt: now
    });

    console.log("");
    console.log(
      "Administrador salvo com sucesso."
    );
    console.log(`Nome: ${admin.name}`);
    console.log(`E-mail: ${admin.email}`);
    console.log(`Função: ${admin.role}`);
    console.log("");
  } catch (error) {
    console.error(
      "Não foi possível salvar o administrador:",
      error
    );

    process.exitCode = 1;
  }
}

await closeDatabase();
