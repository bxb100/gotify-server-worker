import bcrypt from "bcryptjs";
import type { ApplicationRow, ClientRow, EnvBindings, MessageRow, UserRow } from "./types";
import { generateSortKey, generateToken, passwordRounds } from "./utils";

let bootstrapPromise: Promise<void> | null = null;

async function all<T>(db: D1Database, sql: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...bindings).all<T>();
  return (result.results ?? []) as T[];
}

async function first<T>(db: D1Database, sql: string, ...bindings: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...bindings).first<T>()) ?? null;
}

async function run(db: D1Database, sql: string, ...bindings: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...bindings).run();
}

export function ensureBootstrap(env: EnvBindings): Promise<void> {
  bootstrapPromise ??= initializeBootstrap(env);
  return bootstrapPromise;
}

async function initializeBootstrap(env: EnvBindings): Promise<void> {
  const row = await first<{ count: number | string }>(env.DB, "SELECT COUNT(*) AS count FROM users");
  if (Number(row?.count ?? 0) > 0) {
    return;
  }

  const password = env.GOTIFY_DEFAULT_PASS?.trim();
  if (!password) {
    return;
  }

  const name = env.GOTIFY_DEFAULT_USER?.trim() || "admin";
  const hash = await bcrypt.hash(password, passwordRounds(env.GOTIFY_PASSWORD_ROUNDS));
  try {
    await run(env.DB, "INSERT INTO users (name, pass, admin) VALUES (?, ?, 1)", name, hash);
  } catch {
    // Another isolate may have created the user concurrently.
  }
}

export async function ping(db: D1Database): Promise<void> {
  await first<{ ok: number }>(db, "SELECT 1 AS ok");
}

export function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  return first<UserRow>(db, "SELECT id, name, pass, admin FROM users WHERE id = ?", id);
}

export function getUserByName(db: D1Database, name: string): Promise<UserRow | null> {
  return first<UserRow>(db, "SELECT id, name, pass, admin FROM users WHERE name = ?", name);
}

export function getUsers(db: D1Database): Promise<UserRow[]> {
  return all<UserRow>(db, "SELECT id, name, pass, admin FROM users ORDER BY id ASC");
}

export async function createUser(
  db: D1Database,
  input: { name: string; pass: string; admin: boolean },
): Promise<UserRow> {
  const result = await run(
    db,
    "INSERT INTO users (name, pass, admin) VALUES (?, ?, ?)",
    input.name,
    input.pass,
    input.admin ? 1 : 0,
  );
  return (await getUserById(db, Number(result.meta.last_row_id))) as UserRow;
}

export async function updateUser(
  db: D1Database,
  input: { id: number; name: string; pass: string; admin: boolean },
): Promise<UserRow> {
  await run(
    db,
    "UPDATE users SET name = ?, pass = ?, admin = ? WHERE id = ?",
    input.name,
    input.pass,
    input.admin ? 1 : 0,
    input.id,
  );
  return (await getUserById(db, input.id)) as UserRow;
}

export function countAdmins(db: D1Database): Promise<{ count: number | string } | null> {
  return first<{ count: number | string }>(db, "SELECT COUNT(*) AS count FROM users WHERE admin = 1");
}

export async function deleteUser(db: D1Database, id: number): Promise<void> {
  await run(db, "DELETE FROM messages WHERE application_id IN (SELECT id FROM applications WHERE user_id = ?)", id);
  await run(db, "DELETE FROM clients WHERE user_id = ?", id);
  await run(db, "DELETE FROM applications WHERE user_id = ?", id);
  await run(db, "DELETE FROM users WHERE id = ?", id);
}

export function getClientById(db: D1Database, id: number): Promise<ClientRow | null> {
  return first<ClientRow>(db, "SELECT id, token, user_id, name, last_used FROM clients WHERE id = ?", id);
}

export function getClientByToken(db: D1Database, token: string): Promise<ClientRow | null> {
  return first<ClientRow>(db, "SELECT id, token, user_id, name, last_used FROM clients WHERE token = ?", token);
}

export function getClientsByUser(db: D1Database, userId: number): Promise<ClientRow[]> {
  return all<ClientRow>(db, "SELECT id, token, user_id, name, last_used FROM clients WHERE user_id = ? ORDER BY id ASC", userId);
}

export async function createClient(db: D1Database, input: { name: string; userId: number }): Promise<ClientRow> {
  let token = "";
  while (!token) {
    const candidate = generateToken("C");
    if ((await getClientByToken(db, candidate)) === null) {
      token = candidate;
    }
  }

  const result = await run(
    db,
    "INSERT INTO clients (token, user_id, name, last_used) VALUES (?, ?, ?, NULL)",
    token,
    input.userId,
    input.name,
  );
  return (await getClientById(db, Number(result.meta.last_row_id))) as ClientRow;
}

export async function updateClient(
  db: D1Database,
  input: { id: number; name: string },
): Promise<ClientRow> {
  await run(db, "UPDATE clients SET name = ? WHERE id = ?", input.name, input.id);
  return (await getClientById(db, input.id)) as ClientRow;
}

export function deleteClient(db: D1Database, id: number): Promise<D1Result> {
  return run(db, "DELETE FROM clients WHERE id = ?", id);
}

export function touchClient(db: D1Database, token: string, isoDate: string): Promise<D1Result> {
  return run(db, "UPDATE clients SET last_used = ? WHERE token = ?", isoDate, token);
}

export function getApplicationById(db: D1Database, id: number): Promise<ApplicationRow | null> {
  return first<ApplicationRow>(
    db,
    "SELECT id, token, user_id, name, description, internal, image, default_priority, last_used, sort_key FROM applications WHERE id = ?",
    id,
  );
}

export function getApplicationByToken(db: D1Database, token: string): Promise<ApplicationRow | null> {
  return first<ApplicationRow>(
    db,
    "SELECT id, token, user_id, name, description, internal, image, default_priority, last_used, sort_key FROM applications WHERE token = ?",
    token,
  );
}

export function getApplicationsByUser(db: D1Database, userId: number): Promise<ApplicationRow[]> {
  return all<ApplicationRow>(
    db,
    "SELECT id, token, user_id, name, description, internal, image, default_priority, last_used, sort_key FROM applications WHERE user_id = ? ORDER BY sort_key ASC, id ASC",
    userId,
  );
}

export async function createApplication(
  db: D1Database,
  input: {
    userId: number;
    name: string;
    description: string;
    defaultPriority: number;
    sortKey?: string;
  },
): Promise<ApplicationRow> {
  let token = "";
  while (!token) {
    const candidate = generateToken("A");
    if ((await getApplicationByToken(db, candidate)) === null) {
      token = candidate;
    }
  }

  const result = await run(
    db,
    `INSERT INTO applications
      (token, user_id, name, description, internal, image, default_priority, last_used, sort_key)
      VALUES (?, ?, ?, ?, 0, '', ?, NULL, ?)`,
    token,
    input.userId,
    input.name,
    input.description,
    input.defaultPriority,
    input.sortKey?.trim() || generateSortKey(),
  );
  return (await getApplicationById(db, Number(result.meta.last_row_id))) as ApplicationRow;
}

export async function updateApplication(
  db: D1Database,
  input: {
    id: number;
    name: string;
    description: string;
    defaultPriority: number;
    sortKey: string;
    image: string;
  },
): Promise<ApplicationRow> {
  await run(
    db,
    "UPDATE applications SET name = ?, description = ?, default_priority = ?, sort_key = ?, image = ? WHERE id = ?",
    input.name,
    input.description,
    input.defaultPriority,
    input.sortKey,
    input.image,
    input.id,
  );
  return (await getApplicationById(db, input.id)) as ApplicationRow;
}

export async function deleteApplication(db: D1Database, id: number): Promise<void> {
  await run(db, "DELETE FROM messages WHERE application_id = ?", id);
  await run(db, "DELETE FROM applications WHERE id = ?", id);
}

export function touchApplication(db: D1Database, token: string, isoDate: string): Promise<D1Result> {
  return run(db, "UPDATE applications SET last_used = ? WHERE token = ?", isoDate, token);
}

export function getMessageById(db: D1Database, id: number): Promise<MessageRow | null> {
  return first<MessageRow>(
    db,
    "SELECT id, application_id, message, title, priority, extras, date FROM messages WHERE id = ?",
    id,
  );
}

export function getMessagesByApplication(
  db: D1Database,
  applicationId: number,
  limit: number,
  since: number,
): Promise<MessageRow[]> {
  if (since > 0) {
    return all<MessageRow>(
      db,
      `SELECT id, application_id, message, title, priority, extras, date
       FROM messages
       WHERE application_id = ? AND id < ?
       ORDER BY id DESC
       LIMIT ?`,
      applicationId,
      since,
      limit,
    );
  }
  return all<MessageRow>(
    db,
    `SELECT id, application_id, message, title, priority, extras, date
     FROM messages
     WHERE application_id = ?
     ORDER BY id DESC
     LIMIT ?`,
    applicationId,
    limit,
  );
}

export function getMessagesByUser(
  db: D1Database,
  userId: number,
  limit: number,
  since: number,
): Promise<MessageRow[]> {
  if (since > 0) {
    return all<MessageRow>(
      db,
      `SELECT m.id, m.application_id, m.message, m.title, m.priority, m.extras, m.date
       FROM messages m
       JOIN applications a ON a.id = m.application_id
       WHERE a.user_id = ? AND m.id < ?
       ORDER BY m.id DESC
       LIMIT ?`,
      userId,
      since,
      limit,
    );
  }
  return all<MessageRow>(
    db,
    `SELECT m.id, m.application_id, m.message, m.title, m.priority, m.extras, m.date
     FROM messages m
     JOIN applications a ON a.id = m.application_id
     WHERE a.user_id = ?
     ORDER BY m.id DESC
     LIMIT ?`,
    userId,
    limit,
  );
}

export async function createMessage(
  db: D1Database,
  input: {
    applicationId: number;
    message: string;
    title: string;
    priority: number;
    extras: string | null;
    date: string;
  },
): Promise<MessageRow> {
  const result = await run(
    db,
    "INSERT INTO messages (application_id, message, title, priority, extras, date) VALUES (?, ?, ?, ?, ?, ?)",
    input.applicationId,
    input.message,
    input.title,
    input.priority,
    input.extras,
    input.date,
  );
  return (await getMessageById(db, Number(result.meta.last_row_id))) as MessageRow;
}

export function deleteMessage(db: D1Database, id: number): Promise<D1Result> {
  return run(db, "DELETE FROM messages WHERE id = ?", id);
}

export function deleteMessagesByApplication(db: D1Database, applicationId: number): Promise<D1Result> {
  return run(db, "DELETE FROM messages WHERE application_id = ?", applicationId);
}

export function deleteMessagesByUser(db: D1Database, userId: number): Promise<D1Result> {
  return run(db, "DELETE FROM messages WHERE application_id IN (SELECT id FROM applications WHERE user_id = ?)", userId);
}
