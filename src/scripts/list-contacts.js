import {
  closeDatabase,
  databasePath,
  listContacts
} from "../database/database.js";

try {
  const contacts = listContacts();

  console.log(`\nBanco: ${databasePath}`);
  console.log(`Total de mensagens: ${contacts.length}\n`);

  if (contacts.length === 0) {
    console.log("Nenhuma mensagem cadastrada.");
  } else {
    console.table(
      contacts.map((contact) => ({
        id: contact.id,
        nome: contact.name,
        email: contact.email,
        status: contact.status,
        mensagem:
          contact.message.length > 50
            ? `${contact.message.slice(0, 50)}...`
            : contact.message,
        data: contact.createdAt
      }))
    );
  }
} finally {
  closeDatabase();
}
