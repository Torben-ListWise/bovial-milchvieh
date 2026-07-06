---
name: Bovial Mobile App Setup
description: Durable decisions and constraints for the Bovial native Expo mobile app (artifacts/bovial-mobile)
---

## Provider order (root _layout.tsx)

SafeAreaProvider > ErrorBoundary > ClerkProvider > ClerkLoaded > QueryClientProvider > GestureHandlerRootView > KeyboardProvider > BottomSheetModalProvider

**Why:** BottomSheetModalProvider must be inside GestureHandlerRootView but above all screens.

## SSE streaming — correct endpoint and token passing

- Endpoint: `GET /api/stream?analysisId=X&token=<jwt>` (NOT `/api/analyses/:analysisId/stream`)
- Token is passed as a query param because `react-native-sse` EventSource headers are less reliable across proxies
- API server `/api/stream` has a pre-requireAuth middleware that promotes `?token=` → `Authorization: Bearer` header
- Use `react-native-sse` EventSource (NOT `expo/fetch` + ReadableStream, NOT standard EventSource)
- **CRITICAL order**: open SSE connection FIRST, then POST question inside the `connected` named-event handler (not `open`)
- For new analyses (`isNew=1`): call `connectSSE(false)` — server already has the question queued
- Named events: `delta` (text chunk), `progress` (step), `chart`, `turn_reset`, `done`, `agenterror`

**Why:** The `open` event fires when the TCP connection is established but before the server sends the `connected` SSE event. Posting on `connected` ensures the server's SSE writer is registered before the agent starts emitting events.

## Farm-to-chat direct navigation

- FarmCard → `/farms/[datasetId]` (router screen, not an analysis list)
- Router checks `AsyncStorage.getItem('lastAnalysisId:${datasetId}')`, redirects to `/chat/${id}`
- Falls back: latest from `useListAnalyses`, then creates new with default question (`?new=1`)
- Chat screen writes current analysisId back to AsyncStorage on mount

## Diary CTA and bottom-sheet

- Amber CTA chip appears when `lastAssistantMsg?.loggedEvent != null` (event WAS auto-logged by agent)
- Chip taps open `BottomSheetModal` (not React Native Modal) to review/add entries
- Diary form requires: `entryDate` (YYYY-MM-DD text input), `category` chip picker, `description` text, `reminderDays` optional numeric
- Categories match server enum: health, feed, management, infrastructure, weather, other
- POST `/api/diary` payload: `{ entryDate, category, description, reminderDays: number|null }`
- After done/mounted: fetch `GET /api/diary?limit=2` and render preview section at bottom of message list

## Step progress pills

- `ProgressPill` takes `{ steps: string[], currentStep: string | null }`
- Completed steps shown with checkmark icon; current step shown with ActivityIndicator
- `streaming.completedSteps` grows on each `progress` event (push previous `currentStep` before replacing)

## Feedback

- `MessageBubble` accepts `onFeedback?: (messageId, rating: 'up'|'down') => void`
- POST `/api/messages/:messageId/feedback` with `{ rating }`
- Shown only for non-streaming, non-user messages when `onFeedback` is provided
