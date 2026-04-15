// Node-only startup recovery: re-kick stuck book extracts + fail orphaned downloads.
import fs from "node:fs/promises";
import { q } from "@/lib/db";
import { resumeExtractForBook } from "@/lib/resume";

// Fire-and-forget; never block server startup.
(async () => {
  try {
    const stuck = await q<{ id: string; status: string; source_path: string | null }>(
      `SELECT id, status, source_path FROM books
       WHERE status IN ('downloading', 'extracting')
         AND created_at < now() - interval '2 minutes'`
    );
    if (!stuck.length) return;
    console.log(`[Reader] startup recovery: ${stuck.length} stuck book(s) found`);

    for (const b of stuck) {
      if (b.status === "downloading") {
        await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`, [
          b.id,
          "Interrupted before download completed. Please retry.",
        ]).catch(() => {});
        console.log(`[Reader] startup recovery: marked ${b.id} (downloading) as failed`);
        continue;
      }
      // status === 'extracting'
      if (!b.source_path) {
        await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`, [
          b.id,
          "Extract interrupted and source path missing.",
        ]).catch(() => {});
        continue;
      }
      const stat = await fs.stat(b.source_path).catch(() => null);
      if (!stat || stat.size <= 0) {
        await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`, [
          b.id,
          "Extract interrupted and source file missing.",
        ]).catch(() => {});
        continue;
      }
      console.log(`[Reader] startup recovery: resuming extract for ${b.id}`);
      (async () => {
        try {
          await resumeExtractForBook(b.id);
          console.log(`[Reader] startup recovery: ${b.id} -> ready`);
        } catch (e: any) {
          console.error(`[Reader] startup recovery: ${b.id} failed:`, e?.message || e);
        }
      })();
    }
  } catch (e: any) {
    console.error("[Reader] startup recovery error:", e?.message || e);
  }
})();
