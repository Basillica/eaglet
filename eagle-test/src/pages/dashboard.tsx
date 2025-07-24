import { createSignal, onMount, For, createMemo, Show, JSX } from "solid-js";
import LogEntryCard from "../components/logCard";
import { generateMockLog, LOG_LEVELS, SERVICES } from "../logUtils";
import { LogEntry } from "../lib/types";

const PAGE_SIZE = 10;
const NUMBER_OF_MOCK_LOGS = 100; // Total logs to generate

const LogDashboard: () => JSX.Element = () => {
  const [allMockLogs, setAllMockLogs] = createSignal<LogEntry[]>([]);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [searchTerm, setSearchTerm] = createSignal("");
  const [selectedLevel, setSelectedLevel] = createSignal("");
  const [selectedService, setSelectedService] = createSignal("");

  // Memoized computation for filtered logs
  const filteredAndSortedLogs = createMemo(() => {
    const term = searchTerm().toLowerCase();
    const level = selectedLevel();
    const service = selectedService();

    const filtered = allMockLogs().filter((log) => {
      const matchesSearch =
        term === "" ||
        log.message.toLowerCase().includes(term) ||
        log.service.toLowerCase().includes(term) ||
        (log.errorName && log.errorName.toLowerCase().includes(term)) ||
        (log.errorMessage && log.errorMessage.toLowerCase().includes(term)) ||
        (log.context &&
          JSON.stringify(log.context).toLowerCase().includes(term)) ||
        (log.user &&
          log.user.username &&
          log.user.username.toLowerCase().includes(term)) ||
        (log.user &&
          log.user.email &&
          log.user.email.toLowerCase().includes(term));

      const matchesLevel = level === "" || log.level === level;
      const matchesService = service === "" || log.service === service;

      return matchesSearch && matchesLevel && matchesService;
    });

    // Always sort to ensure consistent order, especially if new logs are added
    return filtered.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  });

  // Memoized computation for logs to display on current page
  const logsToDisplay = createMemo(() => {
    const start = 0; // Always start from 0 for filtered view
    const end = (currentPage() + 1) * PAGE_SIZE;
    return filteredAndSortedLogs().slice(start, end);
  });

  onMount(() => {
    const generatedLogs: LogEntry[] = [];
    for (let i = 0; i < NUMBER_OF_MOCK_LOGS; i++) {
      generatedLogs.push(generateMockLog());
    }
    setAllMockLogs(generatedLogs);
    console.log(`Generated ${generatedLogs.length} mock logs.`);
    console.table(generatedLogs.slice(0, 5));
  });

  const handleApplyFilters = () => {
    setCurrentPage(0); // Reset page on new filters
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    setSelectedLevel("");
    setSelectedService("");
    setCurrentPage(0); // Reset page
  };

  const handleLoadMore = () => {
    setCurrentPage((prev) => prev + 1);
  };

  return (
    <div class="container mx-auto p-4">
      {/* Search and Filter Bar */}
      <div class="bg-white shadow-md rounded-lg p-6 mb-6 flex flex-wrap items-center gap-4">
        <div class="flex-grow">
          <label for="search" class="sr-only">
            Search Logs
          </label>
          <input
            type="text"
            id="search"
            placeholder="Search by message, service, or context..."
            class="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={searchTerm()}
            onInput={(e) => setSearchTerm(e.currentTarget.value)}
          />
        </div>

        <div class="flex-shrink-0">
          <label for="logLevel" class="sr-only">
            Log Level
          </label>
          <select
            id="logLevel"
            class="p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedLevel()}
            onChange={(e) => setSelectedLevel(e.currentTarget.value)}
          >
            <option value="">All Levels</option>
            <For each={LOG_LEVELS.reverse()}>
              {(level) => (
                <option value={level}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </option>
              )}
            </For>
          </select>
        </div>

        <div class="flex-shrink-0">
          <label for="serviceFilter" class="sr-only">
            Service
          </label>
          <select
            id="serviceFilter"
            class="p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={selectedService()}
            onChange={(e) => setSelectedService(e.currentTarget.value)}
          >
            <option value="">All Services</option>
            <For each={SERVICES.sort()}>
              {(service) => <option value={service}>{service}</option>}
            </For>
          </select>
        </div>

        <button
          onClick={handleApplyFilters}
          class="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Apply Filters
        </button>
        <button
          onClick={handleClearFilters}
          class="px-6 py-3 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          Clear Filters
        </button>
      </div>

      {/* Log Display Area */}
      <div
        id="logContainer"
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
      >
        <Show
          when={logsToDisplay().length > 0}
          fallback={
            <p class="col-span-full text-center text-gray-500 p-8">
              No logs found matching criteria.
            </p>
          }
        >
          <For
            each={logsToDisplay()}
            fallback={
              <p class="col-span-full text-center text-gray-500 p-8">
                Loading logs...
              </p>
            }
          >
            {(log) => <LogEntryCard log={log} />}
          </For>
        </Show>
      </div>

      {/* Load More Button */}
      <div class="text-center">
        <Show when={logsToDisplay().length < filteredAndSortedLogs().length}>
          <button
            id="loadMoreBtn"
            onClick={handleLoadMore}
            class="px-8 py-4 bg-green-600 text-white rounded-lg text-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            Load More Logs
          </button>
        </Show>
      </div>
    </div>
  );
};

export default LogDashboard;
