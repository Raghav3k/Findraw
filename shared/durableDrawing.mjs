import { drawingDelta, applyDrawingDelta } from "./drawingDelta.mjs";

export const DRAWING_CHECKPOINT_KEY = "room:drawingOperations";
export const DRAWING_JOURNAL_KEY = "room:drawingJournal";
const MAX_JOURNAL_BATCHES = 32;
const MAX_JOURNAL_BYTES = 64 * 1024;

export class DurableDrawing {
  constructor(storage) {
    this.storage = storage;
    this.operations = [];
    this.epoch = null;
    this.revision = 0;
    this.journal = [];
    this.needsCheckpoint = true;
  }

  async load(legacyOperations = []) {
    const checkpoint = await this.storage.get(DRAWING_CHECKPOINT_KEY);
    this.operations = Array.isArray(checkpoint) ? checkpoint : checkpoint?.operations || legacyOperations;
    this.epoch = checkpoint?.epoch || crypto.randomUUID();
    this.revision = checkpoint?.revision || 0;
    this.needsCheckpoint = !checkpoint?.epoch;
    const journal = await this.storage.get(DRAWING_JOURNAL_KEY);
    if (journal) {
      if (journal.epoch !== this.epoch) throw new Error("Drawing journal does not match its checkpoint.");
      for (const entry of journal.entries) {
        if (entry.baseRevision !== this.revision || entry.revision !== this.revision + 1) throw new Error("Drawing journal revision gap.");
        this.operations = applyDrawingDelta(this.operations, entry.delta);
        this.revision = entry.revision;
      }
      this.journal = journal.entries;
    }
  }

  async reset(operations, epoch, writeMetadata) {
    await this.storage.transaction(async (storage) => {
      await storage.put(DRAWING_CHECKPOINT_KEY, { epoch, revision: 0, operations });
      await storage.delete(DRAWING_JOURNAL_KEY);
      await writeMetadata?.(storage);
    });
    this.operations = operations;
    this.epoch = epoch;
    this.revision = 0;
    this.journal = [];
    this.needsCheckpoint = false;
  }

  async commit(operations) {
    const delta = drawingDelta(this.operations, operations);
    if (!delta.deleteCount && !delta.operations.length) return null;
    const entry = { baseRevision: this.revision, revision: this.revision + 1, delta };
    const entries = [...this.journal, entry];
    const journal = { epoch: this.epoch, entries };
    if (this.needsCheckpoint || entries.length >= MAX_JOURNAL_BATCHES || new TextEncoder().encode(JSON.stringify(journal)).byteLength >= MAX_JOURNAL_BYTES) {
      await this.storage.transaction(async (storage) => {
        await storage.put(DRAWING_CHECKPOINT_KEY, { epoch: this.epoch, revision: entry.revision, operations });
        await storage.delete(DRAWING_JOURNAL_KEY);
      });
      this.journal = [];
      this.needsCheckpoint = false;
    } else {
      await this.storage.put(DRAWING_JOURNAL_KEY, journal);
      this.journal = entries;
    }
    // Publish and acknowledge only after persistence succeeds.
    this.operations = operations;
    this.revision = entry.revision;
    return { epoch: this.epoch, ...entry };
  }
}
