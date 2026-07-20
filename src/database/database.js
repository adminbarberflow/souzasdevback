export const databaseProvider =
  process.env.DATABASE_PROVIDER
    ?.trim()
    .toLowerCase() ||
  "sqlite";

const adapterPaths = new Map([
  [
    "sqlite",
    "./sqlite-database.js"
  ]
]);

const adapterPath =
  adapterPaths.get(databaseProvider);

if (!adapterPath) {
  throw new Error(
    `DATABASE_PROVIDER inválido: ${databaseProvider}`
  );
}

const adapter = await import(adapterPath);

const requiredMethods = [
  "createContact",
  "listContacts",
  "findContactById",
  "updateContactStatus",
  "deleteContact",
  "getContactStats",
  "countContacts",
  "findAdminByEmail",
  "findAdminById",
  "upsertAdmin",
  "closeDatabase"
];

for (const method of requiredMethods) {
  if (typeof adapter[method] !== "function") {
    throw new Error(
      `O adaptador ${databaseProvider} não implementa ${method}.`
    );
  }
}

export const databasePath =
  adapter.databasePath || "";

export async function createContact(contact) {
  return adapter.createContact(contact);
}

export async function listContacts(
  status = ""
) {
  return adapter.listContacts(status);
}

export async function findContactById(id) {
  return adapter.findContactById(id);
}

export async function updateContactStatus(
  id,
  status
) {
  return adapter.updateContactStatus(
    id,
    status
  );
}

export async function deleteContact(id) {
  return adapter.deleteContact(id);
}

export async function getContactStats() {
  return adapter.getContactStats();
}

export async function countContacts() {
  return adapter.countContacts();
}

export async function findAdminByEmail(
  email
) {
  return adapter.findAdminByEmail(email);
}

export async function findAdminById(id) {
  return adapter.findAdminById(id);
}

export async function upsertAdmin(admin) {
  return adapter.upsertAdmin(admin);
}

export async function closeDatabase() {
  return adapter.closeDatabase();
}