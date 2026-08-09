import { getDb } from './api/queries/connection.ts';
import { users } from './db/schema.ts';

const db = getDb();
try {
  const result = db.insert(users).values({ name: 'test', passwordHash: 'test', email: 'test@example.com' }).returning({ id: users.id });
  console.log('returning result:', result);
} catch (e) {
  console.error('returning error:', e);
}

try {
  const result = db.insert(users).values({ name: 'test2', passwordHash: 'test', email: 'test2@example.com' });
  console.log('plain result:', result);
  console.log('typeof result:', typeof result);
  console.log('result keys:', Object.keys(result));
  console.log('result[0]:', result[0]);
} catch (e) {
  console.error('plain error:', e);
}
