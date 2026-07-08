# 🎯 System Objective
A serverless Chrome Extension Side Panel that acts as a local agent. It uses LangGraph.js running in the extension's side panel. It commands the Content Script to scrape the webmail DOM, processes the text directly in the browser, and makes direct API calls to an LLM (e.g., Gemini 1.5 Flash). It features a dynamic "Pagination RAG" (analyzes up to 50 emails per page). If the answer is not found on the current page, it automatically triggers a page navigation in the DOM, waits for the load, and analyzes the next 50. It gracefully halts when a maximum page limit is reached or the inbox ends.

# 🏗️ Architecture Flow (No Backend)
*   **UI (Side Panel):** Chat interface with quick-action buttons.
*   **Controller (LangGraph.js):** Runs in the extension. Orchestrates the flow and maintains state.
*   **Data Pipe (Content Script):** When requested, it scrapes the DOM, formats it into clean JSON (stripping heavy HTML/CSS), and passes it back to the Side Panel. It handles DOM interactions like clicking "Next Page" using robust `MutationObserver` wait logic (not hardcoded timeouts).
*   **LLM Engine:** Direct fetch calls to the Gemini/OpenAI API.

# 🧠 LangGraph.js State Definition
This is the single source of truth passed between nodes.

```typescript
interface WebmailState {
    user_query: string;
    current_page: number;       // Starts at 1
    max_pages: number;          // Hard cap (e.g., 2 for up to 100 emails)
    has_next_page: boolean;     // Set by Content Script (are we at the end of the inbox?)
    scraped_emails: Email[];    // The clean JSON array from DOM for the CURRENT page
    found_answer: boolean;      // True if the LLM found the data
    final_answer: string;       // The Markdown response
    dom_error: boolean;         // True if the scraper failed to find expected DOM elements
}
```

# 🤖 The Nodes (JavaScript Functions)

### Node 1: DOM_Scraper (The Data Fetcher)
*   **Goal:** Tell the active tab to extract emails for the current page.
*   **Action:** Uses `chrome.tabs.sendMessage` to trigger the Content Script.
*   **Logic:**
    *   If `current_page === 1`, scrape the current view.
    *   If `current_page > 1`, the content script clicks the "Next Page" arrow, uses a `MutationObserver` to wait for the new emails to render, and *then* scrapes.
*   **Updates:** Sets `scraped_emails` and `has_next_page` (boolean). Sets `dom_error` if extraction fails.

### Node 2: Structured_Synthesizer (The Data Evaluator & Generator)
*   **Goal:** Read the currently scraped emails, answer the question, or admit it doesn't know.
*   **Prompt Strategy:**
    "You are an exact data-extraction agent. Review the provided webmail JSON data to answer the user's query.
    RULES: ONLY use the provided JSON. Do not guess. If the answer is present, format it clearly using Markdown. If NOT present, simply set 'found' to false."
*   **Structured Output:** We force the LLM API to return JSON. This combines the "Generator" and "Verifier" into a single API call, making it highly cost-effective.
    ```json
    {
      "found": true/false,
      "answer": "The event is scheduled for..."
    }
    ```
*   **Updates:** Sets `found_answer` and `final_answer`.

# 🔀 Graph Routing Logic (The Safety Rails)
This logic guarantees zero infinite loops while enabling "Pagination Search".

1.  **START** ➔ `DOM_Scraper`
2.  `DOM_Scraper` ➔ `Structured_Synthesizer`
3.  **Conditional Edge from Structured_Synthesizer:**
    *   `IF found_answer === true OR dom_error === true` ➔ **END** (Show response or error in UI).
    *   `IF found_answer === false AND current_page < max_pages AND has_next_page === true` ➔
        *   Action: Show "Digging deeper into older emails..." in UI.
        *   Update: `current_page += 1`
        *   Route: Go back to `DOM_Scraper`.
    *   `IF found_answer === false AND (current_page >= max_pages OR has_next_page === false)` ➔ **END**
        *   Action: Force output: "Looked through the available emails, but couldn't find anything related to this."

# 🚀 Implementation Steps for LLM (Project Guide)

1.  **Step 1: Extension Scaffold & Manifest**
    *   Setup `manifest.json` with `side_panel`, `activeTab`, `scripting`, and `storage` permissions (Manifest V3).
    *   Create the basic Side Panel HTML/CSS (UI) and the background service worker.
2.  **Step 2: Robust Content Script (The Scraper)**
    *   Implement the DOM scraping logic for the target webmail client.
    *   Implement the `MutationObserver` logic for clicking "Next Page" and waiting for the DOM to settle before extracting.
    *   Ensure the output is clean JSON (strip all HTML tags, limit to Sender, Subject, Date, Body snippet).
3.  **Step 3: LangGraph Setup (The Orchestrator)**
    *   Initialize LangGraph.js within the Side Panel script (or background script if preferred, but side panel is easier for direct UI updates).
    *   Define the `WebmailState` interface/graph state.
4.  **Step 4: Node Implementation**
    *   Write the `DOM_Scraper` node to handle async messaging with the Content Script (`chrome.tabs.sendMessage`).
    *   Write the `Structured_Synthesizer` node to make the API call to Gemini (using `fetch` with structured JSON output instructions).
5.  **Step 5: Graph Compilation & UI Integration**
    *   Wire the nodes and conditional edges together using LangGraph's `StateGraph`.
    *   Connect the graph execution to the UI chat interface (handling user inputs, loading states, and displaying the final markdown answer).