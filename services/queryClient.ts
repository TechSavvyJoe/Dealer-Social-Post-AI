import { QueryClient } from "@tanstack/react-query";

let queryClient: QueryClient | null = null;

export const getQueryClient = () => {
  if (!queryClient) {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 1000 * 60 * 5,
          retry: 1,
          refetchOnWindowFocus: false,
        },
        mutations: {
          // Mutations include paid model calls and non-idempotent admin writes.
          // Retrying them globally can duplicate spend or replay a write after
          // its first response was lost. Individual idempotent mutations may
          // opt in explicitly when they have a safe retry contract.
          retry: 0,
        },
      },
    });
  }
  return queryClient;
};
