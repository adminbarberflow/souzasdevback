import {
  readFileSync
} from "node:fs";

import {
  resolve
} from "node:path";

import pg from "pg";

import {
  readPositiveIntegerEnv
} from "../config.js";

const {
  Pool
} = pg;

const databaseUrl =
  process.env.DATABASE_URL?.trim() || "";

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL é obrigatória para o provedor PostgreSQL."
  );
}

function readBooleanEnvironment(
  name,
  defaultValue
) {
  const rawValue =
    process.env[name]
      ?.trim()
      .toLowerCase();

  if (!rawValue) {
    return defaultValue;
  }

  if (rawValue === "true") {
    return true;
  }

  if (rawValue === "false") {
    return false;
  }

  throw new Error(
    `${name} deve ser true ou false.`
  );
}

const useSsl = readBooleanEnvironment(
  "DATABASE_SSL",
  true
);

const sslCaPath =
  process.env.DATABASE_SSL_CA_PATH
    ?.trim() || "";

function createSslConfiguration() {
  if (!useSsl) {
    return false;
  }

  if (!sslCaPath) {
    return true;
  }

  const absoluteCaPath = resolve(
    process.cwd(),
    sslCaPath
  );

  let caCertificate;

  try {
    caCertificate = readFileSync(
      absoluteCaPath,
      "utf8"
    );
  } catch (error) {
    throw new Error(
      "Não foi possível carregar o certificado CA " +
      `em ${absoluteCaPath}: ${error.message}`
    );
  }

  if (
    !caCertificate.includes(
      "-----BEGIN CERTIFICATE-----"
    ) ||
    !caCertificate.includes(
      "-----END CERTIFICATE-----"
    )
  ) {
    throw new Error(
      "O certificado CA configurado " +
      "não é um arquivo PEM válido."
    );
  }

  return {
    ca: caCertificate,
    rejectUnauthorized: true
  };
}

const sslConfiguration =
  createSslConfiguration();

export const databasePath =
  "PostgreSQL";

const pool = new Pool({
  connectionString: databaseUrl,

  max: readPositiveIntegerEnv(
    "DATABASE_POOL_MAX",
    5
  ),

  idleTimeoutMillis:
    readPositiveIntegerEnv(
      "DATABASE_IDLE_TIMEOUT_MS",
      30000
    ),

  connectionTimeoutMillis:
    readPositiveIntegerEnv(
      "DATABASE_CONNECTION_TIMEOUT_MS",
      10000
    ),

  ssl: sslConfiguration
});

pool.on("error", (error) => {
  console.error(
    "Erro inesperado em conexão PostgreSQL ociosa:",
    error
  );
});

let databaseClosed = false;

function dateToIsoString(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(
      "O PostgreSQL retornou uma data inválida."
    );
  }

  return parsedDate.toISOString();
}

function mapContact(row) {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    message: row.message,
    status: row.status,

    createdAt:
      dateToIsoString(row.createdAt)
  };
}

function mapAdmin(row) {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,

    ...(row.passwordHash
      ? {
          passwordHash:
            row.passwordHash
        }
      : {}),

    role: row.role,

    createdAt:
      dateToIsoString(row.createdAt),

    updatedAt:
      dateToIsoString(row.updatedAt)
  };
}

export async function createContact(
  contact
) {
  await pool.query(
    `
      INSERT INTO public.contacts (
        id,
        name,
        email,
        message,
        status,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      contact.id,
      contact.name,
      contact.email,
      contact.message,
      contact.status,
      contact.createdAt
    ]
  );

  return contact;
}

export async function listContacts(
  status = ""
) {
  const result = status
    ? await pool.query(
        `
          SELECT
            id,
            name,
            email,
            message,
            status,
            created_at AS "createdAt"
          FROM public.contacts
          WHERE status = $1
          ORDER BY created_at DESC
        `,
        [status]
      )
    : await pool.query(`
        SELECT
          id,
          name,
          email,
          message,
          status,
          created_at AS "createdAt"
        FROM public.contacts
        ORDER BY created_at DESC
      `);

  return result.rows.map(mapContact);
}

export async function findContactById(
  id
) {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        email,
        message,
        status,
        created_at AS "createdAt"
      FROM public.contacts
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return mapContact(result.rows[0]);
}

export async function updateContactStatus(
  id,
  status
) {
  const result = await pool.query(
    `
      UPDATE public.contacts
      SET status = $1
      WHERE id = $2

      RETURNING
        id,
        name,
        email,
        message,
        status,
        created_at AS "createdAt"
    `,
    [
      status,
      id
    ]
  );

  return (
    mapContact(result.rows[0]) ||
    null
  );
}

export async function deleteContact(id) {
  const result = await pool.query(
    `
      DELETE FROM public.contacts
      WHERE id = $1
      RETURNING id
    `,
    [id]
  );

  return Number(result.rowCount) > 0;
}

export async function getContactStats() {
  const result = await pool.query(`
    SELECT
      COUNT(*)::integer AS total,

      COUNT(*) FILTER (
        WHERE status = 'new'
      )::integer AS "newCount",

      COUNT(*) FILTER (
        WHERE status = 'read'
      )::integer AS "readCount",

      COUNT(*) FILTER (
        WHERE status = 'archived'
      )::integer AS "archivedCount"

    FROM public.contacts
  `);

  const stats = result.rows[0] || {};

  return {
    total: Number(stats.total || 0),
    new: Number(stats.newCount || 0),
    read: Number(stats.readCount || 0),

    archived:
      Number(
        stats.archivedCount || 0
      )
  };
}

export async function countContacts() {
  const stats = await getContactStats();

  return stats.total;
}

export async function findAdminByEmail(
  email
) {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        email,
        password_hash AS "passwordHash",
        role,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.admins
      WHERE email = lower($1)
      LIMIT 1
    `,
    [email]
  );

  return mapAdmin(result.rows[0]);
}

export async function findAdminById(id) {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        email,
        role,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.admins
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return mapAdmin(result.rows[0]);
}

export async function upsertAdmin(admin) {
  const result = await pool.query(
    `
      INSERT INTO public.admins (
        id,
        name,
        email,
        password_hash,
        role,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        lower($3),
        $4,
        $5,
        $6,
        $7
      )

      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        password_hash =
          excluded.password_hash,
        role = excluded.role,
        updated_at =
          excluded.updated_at

      RETURNING
        id,
        name,
        email,
        password_hash AS "passwordHash",
        role,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
    [
      admin.id,
      admin.name,
      admin.email,
      admin.passwordHash,
      admin.role,
      admin.createdAt,
      admin.updatedAt
    ]
  );

  return mapAdmin(result.rows[0]);
}

export async function closeDatabase() {
  if (databaseClosed) {
    return;
  }

  databaseClosed = true;

  await pool.end();
}