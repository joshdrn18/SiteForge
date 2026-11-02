export async function cleanupUnusedMedia(env, memberId) {
  if (!env.MEDIA || !env.DB || !memberId) return;
  try {
    const rows = await env.DB.prepare(
      "SELECT c.content_json FROM sites s JOIN site_content c ON c.site_id=s.id WHERE s.owner_id=?"
    ).bind(memberId).all();
    const references = new Set();
    const visit = value => {
      if (typeof value === "string") {
        const match = value.match(/^\/media\/([A-Za-z0-9_-]{1,64})\/([0-9a-f-]{36}\.(?:png|jpg|webp|gif))$/i);
        if (match) references.add(match[0]);
      } else if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else if (value && typeof value === "object") {
        for (const item of Object.values(value)) visit(item);
      }
    };
    for (const row of rows.results || []) {
      try { visit(JSON.parse(row.content_json || "{}")); } catch {}
    }

    let cursor;
    let hasMore = true;
    while (hasMore) {
      const listed = await env.MEDIA.list({ prefix: String(memberId) + "/", limit: 1000, cursor });
      const unused = (listed.objects || []).filter(object => {
        const file = object.key.slice(String(memberId).length + 1);
        return !references.has("/media/" + memberId + "/" + file);
      });
      if (unused.length) await env.MEDIA.delete(unused.map(object => object.key));
      hasMore = !!listed.truncated;
      cursor = listed.cursor;
    }
  } catch (error) {
    console.error("[member-media:cleanup]", String(error?.message || error));
  }
}
