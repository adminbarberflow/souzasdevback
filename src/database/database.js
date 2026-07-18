import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(
  import.meta.url
);

const currentDirectory = path.dirname(
  currentFile
);

const defaultDataDirectory = path.resolve(
  currentDirectory,
  "../../data"
);

const configuredDatabasePath =
  process.env.DATABASE_PATH?.trim() || "";

export const databasePath =
  configuredDatabasePath
    ? path.resolve(configuredDatabasePath)
    : path.join(
        defaultDataDirectory,
        "portfolio.sqlite"
      );

mkdirSync(path.dirname(databasePath), {
  recursive: true
});

const database = new DatabaseSync(
  databasePath,
  {
    enableForeignKeyConstraints: true
  }
);

database.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,

    name TEXT NOT NULL
      CHECK(length(name) BETWEEN 2 AND 80),

    email TEXT NOT NULL
      CHECK(length(email) BETWEEN 3 AND 254),

    message TEXT NOT NULL
      CHECK(length(message) BETWEEN 10 AND 2000),

    status TEXT NOT NULL DEFAULT 'new'
      CHECK(status IN ('new', 'read', 'archived')),

    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,

    name TEXT NOT NULL
      CHECK(length(name) BETWEEN 2 AND 80),

    email TEXT NOT NULL UNIQUE COLLATE NOCASE
      CHECK(length(email) BETWEEN 3 AND 254),

    password_hash TEXT NOT NULL,

    role TEXT NOT NULL DEFAULT 'admin'
      CHECK(role = 'admin'),

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_contacts_created_at
  ON contacts(created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_contacts_status
  ON contacts(status);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_email
  ON admins(email COLLATE NOCASE);
`);

const insertContactStatement = database.prepare(`
  INSERT INTO contacts (
    id,
    name,
    email,
    message,
    status,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
`);

const listContactsStatement = database.prepare(`
  SELECT
    id,
    name,
    email,
    message,
    status,
    created_at AS createdAt
  FROM contacts
  ORDER BY created_at DESC
`);

const listContactsByStatusStatement =
  database.prepare(`
    SELECT
      id,
      name,
      email,
      message,
      status,
      created_at AS createdAt
    FROM contacts
    WHERE status = ?
    ORDER BY created_at DESC
  `);

const findContactStatement = database.prepare(`
  SELECT
    id,
    name,
    email,
    message,
    status,
    created_at AS createdAt
  FROM contacts
  WHERE id = ?
`);

const updateContactStatusStatement =
  database.prepare(`
    UPDATE contacts
    SET status = ?
    WHERE id = ?
  `);

const deleteContactStatement =
  database.prepare(`
    DELETE FROM contacts
    WHERE id = ?
  `);

const contactStatsStatement =
  database.prepare(`
    SELECT
      COUNT(*) AS total,

      SUM(
        CASE
          WHEN status = 'new'
          THEN 1
          ELSE 0
        END
      ) AS newCount,

      SUM(
        CASE
          WHEN status = 'read'
          THEN 1
          ELSE 0
        END
      ) AS readCount,

      SUM(
        CASE
          WHEN status = 'archived'
          THEN 1
          ELSE 0
        END
      ) AS archivedCount

    FROM contacts
  `);

const findAdminByEmailStatement =
  database.prepare(`
    SELECT
      id,
      name,
      email,
      password_hash AS passwordHash,
      role,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM admins
    WHERE email = ? COLLATE NOCASE
  `);

const findAdminByIdStatement =
  database.prepare(`
    SELECT
      id,
      name,
      email,
      role,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM admins
    WHERE id = ?
  `);

const upsertAdminStatement =
  database.prepare(`
    INSERT INTO admins (
      id,
      name,
      email,
      password_hash,
      role,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)

    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      role = excluded.role,
      updated_at = excluded.updated_at
  `);

export function createContact(contact) {
  insertContactStatement.run(
    contact.id,
    contact.name,
    contact.email,
    contact.message,
    contact.status,
    contact.createdAt
  );

  return contact;
}

export function listContacts(status = "") {
  if (status) {
    return listContactsByStatusStatement.all(
      status
    );
  }

  return listContactsStatement.all();
}

export function findContactById(id) {
  return findContactStatement.get(id);
}

export function updateContactStatus(
  id,
  status
) {
  const result =
    updateContactStatusStatement.run(
      status,
      id
    );

  if (Number(result.changes) === 0) {
    return null;
  }

  return findContactById(id);
}

export function deleteContact(id) {
  const result =
    deleteContactStatement.run(id);

  return Number(result.changes) > 0;
}

export function getContactStats() {
  const result =
    contactStatsStatement.get();

  return {
    total: Number(result.total || 0),
    new: Number(result.newCount || 0),
    read: Number(result.readCount || 0),
    archived: Number(
      result.archivedCount || 0
    )
  };
}

export function countContacts() {
  return getContactStats().total;
}

export function findAdminByEmail(email) {
  return findAdminByEmailStatement.get(
    email
  );
}

export function findAdminById(id) {
  return findAdminByIdStatement.get(id);
}

export function upsertAdmin(admin) {
  upsertAdminStatement.run(
    admin.id,
    admin.name,
    admin.email,
    admin.passwordHash,
    admin.role,
    admin.createdAt,
    admin.updatedAt
  );

  return findAdminByEmail(admin.email);
}

export function closeDatabase() {
  database.close();
}
