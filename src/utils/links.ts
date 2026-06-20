export interface ParsedLink {
    url: string;
    type: "youtube" | "drive" | "external";
    title: string;
    thumbnail_url: string | null;
}

export function parseLinksFromContent(content: string): ParsedLink[] {
    // Regex to capture markdown links [title](url) or naked URLs
    const urlRegex = /(https?:\/\/[^\s)\]]+)/g;
    const matches = content.match(urlRegex) || [];
    const uniqueUrls = Array.from(new Set(matches));

    const parsedLinks: ParsedLink[] = [];

    for (const url of uniqueUrls) {
        // Strip trailing punctuation like period, comma, or markdown syntax
        let cleanUrl = url.replace(/[.,;)]+$/, "");

        try {
            const urlObj = new URL(cleanUrl);

            // Check YouTube
            if (
                urlObj.hostname.includes("youtube.com") ||
                urlObj.hostname.includes("youtu.be")
            ) {
                let videoId = "";
                if (urlObj.hostname.includes("youtu.be")) {
                    videoId = urlObj.pathname.slice(1);
                } else {
                    videoId = urlObj.searchParams.get("v") || "";
                }

                // Handle short URLs or embed URLs
                if (urlObj.pathname.startsWith("/embed/")) {
                    videoId = urlObj.pathname.split("/embed/")[1];
                } else if (urlObj.pathname.startsWith("/shorts/")) {
                    videoId = urlObj.pathname.split("/shorts/")[1];
                }

                // Clean up videoId in case there are extra params
                videoId = videoId.split(/[?#]/)[0];

                if (videoId) {
                    parsedLinks.push({
                        url: cleanUrl,
                        type: "youtube",
                        title: `YouTube Video`,
                        thumbnail_url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                    });
                }
            }
            // Check Google Drive
            else if (urlObj.hostname.includes("drive.google.com")) {
                parsedLinks.push({
                    url: cleanUrl,
                    type: "drive",
                    title: "Google Drive Document",
                    thumbnail_url: null,
                });
            }
            // General external resource
            else {
                parsedLinks.push({
                    url: cleanUrl,
                    type: "external",
                    title: `Resource from ${urlObj.hostname}`,
                    thumbnail_url: null,
                });
            }
        } catch (e) {
            // Invalid URL, skip
        }
    }

    return parsedLinks;
}

// Sync links in DB, preserving watch progress of existing links
export async function syncNoteLinks(
    db: import("@cloudflare/workers-types").D1Database,
    noteId: string,
    content: string,
): Promise<void> {
    const parsed = parseLinksFromContent(content);

    // Get existing links to preserve watch progress
    const existingLinks: any[] =
        (
            await db
                .prepare(
                    "SELECT url, watch_progress FROM links WHERE note_id = ?",
                )
                .bind(noteId)
                .all()
        ).results || [];

    const progressMap = new Map<string, number>();
    for (const link of existingLinks) {
        progressMap.set(link.url, link.watch_progress || 0);
    }

    // Delete existing links
    await db.prepare("DELETE FROM links WHERE note_id = ?").bind(noteId).run();

    // Insert new links
    for (const item of parsed) {
        const id = crypto.randomUUID();
        const progress = progressMap.get(item.url) || 0;
        const now = Date.now();
        await db
            .prepare(
                "INSERT INTO links (id, note_id, url, type, title, thumbnail_url, watch_progress, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
                id,
                noteId,
                item.url,
                item.type,
                item.title,
                item.thumbnail_url,
                progress,
                now,
            )
            .run();
    }
}

// Sync backlinks parsed from note content
export async function syncBacklinks(
    db: import("@cloudflare/workers-types").D1Database,
    noteId: string,
    content: string,
): Promise<void> {
    const uuidRegex =
        /\/notes\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi;
    const matches = [...content.matchAll(uuidRegex)];
    const targetIds = new Set<string>();

    for (const match of matches) {
        targetIds.add(match[1]);
    }

    // Clear old backlinks where this note is the source
    await db
        .prepare("DELETE FROM backlinks WHERE source_note_id = ?")
        .bind(noteId)
        .run();

    // Insert new backlinks
    for (const targetId of targetIds) {
        if (targetId === noteId) continue;
        try {
            const exists = await db
                .prepare("SELECT id FROM notes WHERE id = ?")
                .bind(targetId)
                .first();
            if (exists) {
                await db
                    .prepare(
                        "INSERT OR IGNORE INTO backlinks (source_note_id, target_note_id) VALUES (?, ?)",
                    )
                    .bind(noteId, targetId)
                    .run();
            }
        } catch (e) {
            console.error("Error syncing backlink:", e);
        }
    }
}
