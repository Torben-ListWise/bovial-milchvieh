---
name: Bovial Mobile App Setup
description: Key decisions and patterns for the Bovial native Expo mobile app (artifacts/bovial-mobile)
---

## Clerk Auth for Expo

- `tokenCache` uses `expo-secure-store` (getItemAsync / setItemAsync / deleteItemAsync)
- `ClerkProvider` wraps the entire tree in `app/_layout.tsx`
- `BottomSheetModalProvider` must be a child of `GestureHandlerRootView` but parent of all screens
- Provider order: SafeAreaProvider > ErrorBoundary > ClerkProvider > ClerkLoaded > QueryClientProvider > GestureHandlerRootView > KeyboardProvider > BottomSheetModalProvider
- Auth token getter: `setAuthTokenGetter(() => getToken())` in `app/(app)/_layout.tsx` via `useEffect`
- Dev script prefix: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY` must be prepended
- `scripts/build.js` also needs `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY || ""` in the Metro env block

## Navigation Structure

- `app/(auth)/_layout.tsx` — unprotected Stack (sign-in, sign-up); redirects to `/` if signed in
- `app/(app)/_layout.tsx` — protected Stack; redirects to `/sign-in` if not signed in
- `app/(app)/(tabs)/` — 4 tabs: Betriebe (index), Analysen (analyse), Berichte (berichte), Einstellungen (einstellungen)
- `app/(app)/farms/[datasetId].tsx` — Farm router: loads last analysis from AsyncStorage, creates one if none exist, redirects immediately to `/chat/[analysisId]`
- `app/(app)/chat/[analysisId].tsx` — chat with SSE streaming + diary bottom sheet

## Farm-to-Chat Flow (AsyncStorage-backed)

- Tapping a farm card navigates to `/farms/[datasetId]`
- That screen is a router: checks `AsyncStorage.getItem('lastAnalysisId:${datasetId}')`, redirects to `/chat/${analysisId}`
- If no stored analysis: loads list, takes most recent, stores it, redirects
- If no analyses at all: creates one via `POST /api/datasets/:id/analyses` with default question, sets `?new=1`
- ChatScreen writes the current analysis back to AsyncStorage on mount so the "last opened" key stays fresh

## SSE Streaming (react-native-sse)

- Use `react-native-sse` EventSource (NOT `expo/fetch getReader()`)
- `new EventSource(url, { headers: { Authorization: 'Bearer <token>' } })`
- **CRITICAL**: for `handleSend`, open SSE connection FIRST (in `connectSSE(question)`), THEN POST the question inside the `open` event listener to avoid missing early deltas
- For `isNew=1` case: call `connectSSE(false)` — no POST needed, server already has the question
- Endpoint: `GET /api/analyses/:analysisId/stream` with Authorization header
- Named events: `delta` (text chunk), `progress` (step), `chart`, `done`, `error`
- Close with `es.close()`; keep ref in `esRef` for cleanup on unmount

## Diary Bottom Sheet

- Use `@gorhom/bottom-sheet` v5 `BottomSheetModal` (NOT React Native Modal)
- `diarySheetRef.current?.present()` to open, `dismiss()` to close
- Diary CTA "📅 Ereignis eintragen?" only shown when `lastAssistantMsg && !lastAssistantMsg.loggedEvent`
- Form calls `POST /api/diary` with `{ entryDate, category, description }`

## Feedback

- MessageBubble accepts `onFeedback?: (messageId, rating: 'up'|'down') => void`
- Calls `POST /api/messages/:messageId/feedback` with `{ rating }`
- Thumbs shown only for non-streaming, non-user messages when `onFeedback` is provided

**Why:**
- SSE-first-then-POST avoids missing delta events during the server's processing window
- AsyncStorage "last analysis" per farm gives instant navigation without showing a list
- BottomSheetModal requires BottomSheetModalProvider in the ancestor tree
