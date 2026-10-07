import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Dealer } from "../../types";
import * as db from "../../services/database";
import { toUiMessage } from "../../utils/errorMessages";
import { useToast } from "../ui/Toast";

const DEALERS_QUERY_KEY = ["dealers"] as const;

/** The server's limit for `dealers.setup_notes` (pb_hooks/helpers.js). */
export const SETUP_NOTES_MAX_LENGTH = 4000;

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

const savedNotes = (dealer: Dealer): string => dealer.setup_notes ?? "";

export type NotesSaveState =
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * The setup notes for every store on the board: one draft per store, kept
 * while rows open and close (and while the hub shows another tab) until the
 * page is left, and one save definition whose result is recorded per store.
 *
 * Save sends `setup_notes` and nothing else. The dealer PATCH requires a name
 * only when the field is present (pb_hooks/main.pb.js), and it answers with
 * the id alone, so the saved text goes into the cached list here.
 */
export const useSetupNotes = () => {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, NotesSaveState>>({});

  const mutation = useMutation({
    mutationFn: async ({ dealerId, notes }: { dealerId: string; notes: string }) => {
      const formData = new FormData();
      formData.append("setup_notes", notes);
      await db.updateDealerWithFile(dealerId, formData);
      return notes;
    },
    // Options on the mutation itself (not on each mutate call) run for every
    // save, so two stores saved back to back each get their own result.
    onMutate: ({ dealerId }) =>
      setStates((current) => ({ ...current, [dealerId]: { kind: "saving" } })),
    onSuccess: (notes, { dealerId }) => {
      queryClient.setQueryData<Dealer[]>(DEALERS_QUERY_KEY, (list) =>
        list?.map((dealer) =>
          dealer.id === dealerId ? { ...dealer, setup_notes: notes } : dealer,
        ),
      );
      setStates((current) => ({
        ...current,
        [dealerId]: { kind: "saved", at: Date.now() },
      }));
    },
    onError: (error, { dealerId }) =>
      setStates((current) => ({
        ...current,
        [dealerId]: {
          kind: "error",
          message: toUiMessage(error, "The notes weren't saved. Try again."),
        },
      })),
  });

  const draftFor = useCallback(
    (dealer: Dealer) => drafts[dealer.id] ?? savedNotes(dealer),
    [drafts],
  );

  const setDraft = useCallback((dealerId: string, value: string) => {
    setDrafts((current) => ({
      ...current,
      [dealerId]: value.slice(0, SETUP_NOTES_MAX_LENGTH),
    }));
  }, []);

  const isDirty = useCallback(
    (dealer: Dealer) => dealer.id in drafts && drafts[dealer.id] !== savedNotes(dealer),
    [drafts],
  );

  const save = (dealer: Dealer) => {
    if (states[dealer.id]?.kind === "saving") return;
    mutation.mutate({ dealerId: dealer.id, notes: draftFor(dealer) });
  };

  return {
    draftFor,
    setDraft,
    isDirty,
    stateFor: (dealerId: string): NotesSaveState | undefined => states[dealerId],
    save,
  };
};

export type SetupNotes = ReturnType<typeof useSetupNotes>;

/**
 * The system administrator's creative-system switch for every store. The
 * requested value shows at once and is held until the save settles; a
 * successful save goes into the cached list before the list refetches, so the
 * switch never flips back to a stale row.
 */
export const useCreativeSystemSaves = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async ({ dealer, next }: { dealer: Dealer; next: boolean }) => {
      const formData = new FormData();
      // Sent as before this board existed: the current name rides along so
      // the request carries a valid name if the route ever requires one.
      formData.append("name", dealer.name);
      formData.append("creative_system_v2", next ? "true" : "false");
      await db.updateDealerWithFile(dealer.id, formData);
      return next;
    },
    onSuccess: (next, { dealer }) => {
      queryClient.setQueryData<Dealer[]>(DEALERS_QUERY_KEY, (list) =>
        list?.map((item) =>
          item.id === dealer.id ? { ...item, creative_system_v2: next } : item,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: DEALERS_QUERY_KEY });
      toast.success(
        `Creative system turned ${next ? "on" : "off"} for ${dealer.name}.`,
      );
    },
    onError: (error, { dealer }) =>
      setErrors((current) => ({
        ...current,
        [dealer.id]: toUiMessage(error, "The setting wasn't saved. Try again."),
      })),
    onSettled: (_data, _error, { dealer }) =>
      setRequested((current) => without(current, dealer.id)),
  });

  const toggle = (dealer: Dealer, next: boolean) => {
    if (dealer.id in requested) return;
    if (typeof dealer.creative_system_v2 !== "boolean") return;
    setErrors((current) => without(current, dealer.id));
    setRequested((current) => ({ ...current, [dealer.id]: next }));
    mutation.mutate({ dealer, next });
  };

  return {
    checkedFor: (dealer: Dealer) =>
      requested[dealer.id] ?? dealer.creative_system_v2 === true,
    savingFor: (dealerId: string) => dealerId in requested,
    errorFor: (dealerId: string): string | undefined => errors[dealerId],
    toggle,
  };
};

export type CreativeSystemSaves = ReturnType<typeof useCreativeSystemSaves>;
