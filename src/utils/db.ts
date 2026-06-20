// DB Types and utilities for Cloudflare D1

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  created_at: number;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
  children?: Collection[];
}

export interface Note {
  id: string;
  user_id: string;
  collection_id: string | null;
  title: string;
  content: string;
  category: string | null;
  semester: string | null;
  topic: string | null;
  is_favorite: number; // 0 or 1
  is_pinned: number; // 0 or 1
  created_at: number;
  updated_at: number;
}

export interface LinkItem {
  id: string;
  note_id: string;
  url: string;
  type: 'youtube' | 'drive' | 'external';
  title: string | null;
  thumbnail_url: string | null;
  watch_progress: number;
  created_at: number;
}

export interface Attachment {
  id: string;
  note_id: string;
  filename: string;
  r2_key: string;
  file_size: number;
  mime_type: string;
  created_at: number;
}

export interface Tag {
  id: string;
  name: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  details: string;
  created_at: number;
}

// Log activity to the D1 Database
export async function logActivity(
  db: import("@cloudflare/workers-types").D1Database,
  userId: string,
  action: string,
  details: string
): Promise<void> {
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db
      .prepare('INSERT INTO activity_logs (id, user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, userId, action, details, now)
      .run();
  } catch (e) {
    console.error('Failed to log activity:', e);
  }
}

// Build collections hierarchical tree
export function buildCollectionTree(collections: Collection[]): Collection[] {
  const map: Record<string, Collection & { children: Collection[] }> = {};
  const roots: Collection[] = [];
  
  for (const c of collections) {
    map[c.id] = { ...c, children: [] };
  }
  
  for (const c of collections) {
    const mapped = map[c.id];
    if (c.parent_id && map[c.parent_id]) {
      map[c.parent_id].children.push(mapped);
    } else {
      roots.push(mapped);
    }
  }
  
  return roots;
}
