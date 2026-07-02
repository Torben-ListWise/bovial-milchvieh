import {
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';
import { customFetch } from './custom-fetch';
import type { ErrorType } from './custom-fetch';

type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];

export interface FarmNote {
  id: string;
  content: string;
  enabled: boolean;
  createdAt: string;
}

export interface CreateFarmNoteInput {
  content: string;
  enabled?: boolean;
}

export interface UpdateFarmNoteInput {
  content?: string;
  enabled?: boolean;
}

export const getListFarmNotesUrl = () => `/api/farm-notes`;

export const listFarmNotes = async (options?: RequestInit): Promise<FarmNote[]> => {
  return customFetch<FarmNote[]>(getListFarmNotesUrl(), {
    ...options,
    method: 'GET',
  });
};

export const getListFarmNotesQueryKey = () => [`/api/farm-notes`] as const;

export const getListFarmNotesQueryOptions = <
  TData = Awaited<ReturnType<typeof listFarmNotes>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof listFarmNotes>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListFarmNotesQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listFarmNotes>>> = ({ signal }) =>
    listFarmNotes({ signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listFarmNotes>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export function useListFarmNotes<
  TData = Awaited<ReturnType<typeof listFarmNotes>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof listFarmNotes>>, TError, TData>;
  request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListFarmNotesQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return { ...query, queryKey: queryOptions.queryKey };
}

export const createFarmNote = async (
  input: CreateFarmNoteInput,
  options?: RequestInit,
): Promise<FarmNote> => {
  return customFetch<FarmNote>(getListFarmNotesUrl(), {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(input),
  });
};

export const useCreateFarmNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createFarmNote>>,
    TError,
    CreateFarmNoteInput,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof createFarmNote>>,
  TError,
  CreateFarmNoteInput,
  TContext
> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createFarmNote>>,
    CreateFarmNoteInput
  > = (input) => createFarmNote(input, requestOptions);
  return useMutation<
    Awaited<ReturnType<typeof createFarmNote>>,
    TError,
    CreateFarmNoteInput,
    TContext
  >({ mutationFn, ...mutationOptions });
};

export const updateFarmNote = async (
  noteId: string,
  input: UpdateFarmNoteInput,
  options?: RequestInit,
): Promise<FarmNote> => {
  return customFetch<FarmNote>(`/api/farm-notes/${noteId}`, {
    ...options,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(input),
  });
};

export const useUpdateFarmNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof updateFarmNote>>,
    TError,
    { noteId: string; data: UpdateFarmNoteInput },
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<
  Awaited<ReturnType<typeof updateFarmNote>>,
  TError,
  { noteId: string; data: UpdateFarmNoteInput },
  TContext
> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof updateFarmNote>>,
    { noteId: string; data: UpdateFarmNoteInput }
  > = ({ noteId, data }) => updateFarmNote(noteId, data, requestOptions);
  return useMutation<
    Awaited<ReturnType<typeof updateFarmNote>>,
    TError,
    { noteId: string; data: UpdateFarmNoteInput },
    TContext
  >({ mutationFn, ...mutationOptions });
};

export const deleteFarmNote = async (noteId: string, options?: RequestInit): Promise<void> => {
  return customFetch<void>(`/api/farm-notes/${noteId}`, {
    ...options,
    method: 'DELETE',
  });
};

export const useDeleteFarmNote = <TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof deleteFarmNote>>,
    TError,
    string,
    TContext
  >;
  request?: SecondParameter<typeof customFetch>;
}): UseMutationResult<Awaited<ReturnType<typeof deleteFarmNote>>, TError, string, TContext> => {
  const { mutation: mutationOptions, request: requestOptions } = options ?? {};
  const mutationFn: MutationFunction<Awaited<ReturnType<typeof deleteFarmNote>>, string> = (
    noteId,
  ) => deleteFarmNote(noteId, requestOptions);
  return useMutation<Awaited<ReturnType<typeof deleteFarmNote>>, TError, string, TContext>({
    mutationFn,
    ...mutationOptions,
  });
};
