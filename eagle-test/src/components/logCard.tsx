// src/LogEntryCard.tsx
import { createSignal, JSX, Show } from "solid-js";
import { getLevelColorClass } from "../logUtils";
import { LogEntry } from "../lib/types";

interface LogEntryCardProps {
  log: LogEntry;
}

const LogEntryCard: (props: LogEntryCardProps) => JSX.Element = (props) => {
  const [showDetails, setShowDetails] = createSignal(false);

  const timestamp = new Date(props.log.timestamp).toLocaleString();

  // Prepare JSON details for display
  const jsonDetails = {
    id: props.log.id,
    context: props.log.context,
    globalContext: props.log.globalContext,
    userContext: props.log.userContext,
    user: props.log.user,
    device: props.log.device,
    breadcrumbs: props.log.breadcrumbs,
    error_name: props.log.errorName,
    stack: props.log.stack,
    reason: props.log.reason,
    request_method: props.log.requestMethod,
    request_url: props.log.requestUrl,
    status_code: props.log.statusCode,
    status_text: props.log.statusText,
    duration_ms: props.log.durationMs,
    response_size: props.log.responseSize,
    error_message: props.log.errorMessage,
  };

  return (
    <div
      class={`log-entry p-4 rounded-lg shadow-sm border border-gray-200 ${getLevelColorClass(
        props.log.level
      )} relative overflow-hidden`}
    >
      <div class="flex items-center justify-between mb-2">
        <span
          class={`text-xs font-semibold uppercase px-2 py-1 rounded-full ${getLevelColorClass(
            props.log.level
          )}`}
        >
          {props.log.level}
        </span>
        <span class="text-gray-500 text-sm">{timestamp}</span>
      </div>
      <h3
        class={`font-bold text-lg mb-1 ${getLevelColorClass(
          props.log.level
        ).replace("log-", "text-")}`}
      >
        {props.log.message}
      </h3>
      <p class="text-sm text-gray-600 mb-2">
        Service: <span class="font-medium">{props.log.service}</span>
      </p>

      <Show when={props.log.errorName}>
        <p class="text-red-700 text-sm">
          Error: <span class="font-medium">{props.log.errorName}</span>
        </p>
      </Show>
      <Show when={props.log.errorMessage}>
        <p class="text-red-700 text-sm">
          Error Message:{" "}
          <span class="font-medium">{props.log.errorMessage}</span>
        </p>
      </Show>
      <Show when={props.log.requestUrl}>
        <p class="text-gray-600 text-sm">
          Request:{" "}
          <span class="font-medium">
            {props.log.requestMethod || "GET"} {props.log.requestUrl}
          </span>
        </p>
      </Show>
      <Show when={props.log.statusCode}>
        <p class="text-gray-600 text-sm">
          Status:{" "}
          <span class="font-medium">
            {props.log.statusCode} {props.log.statusText || ""}
          </span>
        </p>
      </Show>

      <Show when={showDetails()}>
        <div class="details-panel p-2 mt-3 border-t border-gray-300 text-xs text-gray-700 max-h-48 overflow-y-auto">
          <pre class="whitespace-pre-wrap font-mono text-[10px]">
            {JSON.stringify(jsonDetails, null, 2)}
          </pre>
        </div>
      </Show>
      <button
        class="toggle-details absolute bottom-2 right-2 px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded-md hover:bg-gray-300"
        onClick={() => setShowDetails(!showDetails())}
      >
        {showDetails() ? "Hide Details" : "View Details"}
      </button>
    </div>
  );
};

export default LogEntryCard;
