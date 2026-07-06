---
name: Bovial Mobile App Setup
description: Key decisions and patterns for the Bovial native Expo mobile app (artifacts/bovial-mobile)
---

## Clerk Auth for Expo

- `tokenCache` uses `expo-secure-store` (getItemAsync / setItemAsync / deleteItemAsync)
- `ClerkProvider` wraps the entire tree in `app/_layout.tsx`, OUTSIDE `QueryClientProvider`
- Provider order: SafeAreaProvider > ErrorBoundary > ClerkProvider > ClerkLoaded > QueryClientProvider > GestureHandlerRootView > KeyboardProvider
- Auth token getter: `setAuthTokenGetter(() => getToken())` in `app/(app)/_layout.tsx` inside `useEffect`
- Dev script prefix: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY` must be prepended to the `dev` script in package.json
- `scripts/build.js` also needs `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY || ""` in the env block passed to Metro

## Navigation Structure

- `app/(auth)/_layout.tsx` — unprotected Stack (sign-in, sign-up); redirects to `/` if signed in
- `app/(app)/_layout.tsx` — protected Stack; redirects to `/sign-in` if not signed in
- `app/(app)/(tabs)/` — bottom tab bar (Betriebe, Tagebuch)
- `app/(app)/farms/[datasetId].tsx` — farm detail with analyses list
- `app/(app)/chat/[analysisId].tsx` — chat with SSE streaming

## SSE Streaming

- Use `import { fetch as expoFetch } from 'expo/fetch'` (supports `getReader()` on all platforms)
- SSE endpoint: `GET /api/analyses/:analysisId/stream` with `Authorization: Bearer <token>`
- Parse events: split on `\n\n`, then each part has `event: <name>` and `data: <json>` lines
- Named events: `delta` (text chunk), `progress` (step name), `chart` (chart object), `sources`, `done`, `agenterror`
- For NEW analysis: open SSE immediately after navigation with `isNew=1` param; server buffers 200ms
- Abort by setting `abortRef.current = true` before calling `reader.cancel()`

## API Client

- `customFetch` is now exported from `lib/api-client-react/src/index.ts` (added manually; not auto-generated)
- Diary entries use `customFetch('/api/diary?days=60')` since diary is not in the OpenAPI spec
- Generated hooks: `useListDatasets`, `useGetDataset`, `useListAnalyses`, `useGetAnalysis`, `useCreateAnalysis`, `useAskQuestion`

**Why:**
- Clerk tokenCache is required for Expo to persist sessions across app restarts
- SSE via expo/fetch avoids the react-native-sse package and uses the standard ReadableStream API
- customFetch export allows non-generated endpoints (like diary) to reuse auth and base URL
