import { useCallback, useEffect, useRef, useState } from "react";
import { applyOperations, OperationError, type Operation, type SiteDocument } from "@sitecraft/schema";
import { ApiError, Sites } from "./api";

export type SaveState = "loading" | "saved" | "unsaved" | "saving" | "error" | "conflict";

interface History {
  past: SiteDocument[];
  future: SiteDocument[];
  lastKey: string | null;
  lastAt: number;
}

/**
 * Document state for one branch: local edits through the shared operations,
 * undo/redo, and debounced saves with conflict detection.
 */
export function useEditor(siteId: string, branch: string, onError: (msg: string) => void) {
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [versionId, setVersionId] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const docRef = useRef<SiteDocument | null>(null);
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const history = useRef<History>({ past: [], future: [], lastKey: null, lastAt: 0 });

  const syncHistoryFlags = () => {
    setCanUndo(history.current.past.length > 0);
    setCanRedo(history.current.future.length > 0);
  };

  const load = useCallback(async () => {
    setSaveState("loading");
    const head = await Sites.head(siteId, branch);
    docRef.current = head.document;
    versionRef.current = head.versionId;
    dirtyRef.current = false;
    history.current = { past: [], future: [], lastKey: null, lastAt: 0 };
    syncHistoryFlags();
    setDoc(head.document);
    setVersionId(head.versionId);
    setSaveState("saved");
    return head;
  }, [siteId, branch]);

  useEffect(() => {
    load().catch((e) => onError((e as Error).message));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const save = useCallback(async () => {
    if (!docRef.current || savingRef.current || !dirtyRef.current) return;
    savingRef.current = true;
    const gen = generation.current;
    setSaveState("saving");
    try {
      const r = await Sites.save(siteId, branch, docRef.current, versionRef.current);
      versionRef.current = r.versionId;
      setVersionId(r.versionId);
      if (gen === generation.current) {
        dirtyRef.current = false;
        setSaveState("saved");
      } else {
        setSaveState("unsaved");
        schedule();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setSaveState("conflict");
      else {
        setSaveState("error");
        onError(`Couldn't save: ${(e as Error).message}`);
      }
    } finally {
      savingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, branch]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 700);
  }, [save]);

  const commitLocal = (next: SiteDocument) => {
    docRef.current = next;
    dirtyRef.current = true;
    generation.current++;
    setDoc(next);
    setSaveState("unsaved");
    schedule();
  };

  /**
   * Apply edit operations locally. Edits sharing a coalesce key within a second
   * (like typing into one field) become a single undo step.
   */
  const apply = useCallback(
    (ops: Operation[], coalesceKey?: string): (string | null)[] | null => {
      const cur = docRef.current;
      if (!cur) return null;
      try {
        const { document, created } = applyOperations(cur, ops);
        const h = history.current;
        const now = Date.now();
        const merge = coalesceKey && h.lastKey === coalesceKey && now - h.lastAt < 1000;
        if (!merge) h.past.push(cur);
        if (h.past.length > 100) h.past.shift();
        h.future = [];
        h.lastKey = coalesceKey ?? null;
        h.lastAt = now;
        syncHistoryFlags();
        commitLocal(document);
        return created;
      } catch (e) {
        onError(e instanceof OperationError ? e.message.replace(/^Operation \d+: /, "") : (e as Error).message);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule],
  );

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev || !docRef.current) return;
    h.future.push(docRef.current);
    h.lastKey = null;
    syncHistoryFlags();
    commitLocal(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next || !docRef.current) return;
    h.past.push(docRef.current);
    h.lastKey = null;
    syncHistoryFlags();
    commitLocal(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  return {
    doc,
    versionId,
    saveState,
    canUndo,
    canRedo,
    apply,
    undo,
    redo,
    reload: load,
    isDirty: () => dirtyRef.current,
    currentVersion: () => versionRef.current,
    flush: save,
  };
}
