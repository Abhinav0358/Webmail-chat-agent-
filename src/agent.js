import { StateGraph, START, END, Annotation } from '@langchain/langgraph';

// 1. Define State
const StateAnnotation = Annotation.Root({
    user_query: Annotation(),
    current_page: Annotation({
        reducer: (curr, next) => next,
        default: () => 1
    }),
    max_pages: Annotation({
        reducer: (curr, next) => next,
        default: () => 2
    }),
    has_next_page: Annotation({
        reducer: (curr, next) => next,
        default: () => true
    }),
    scraped_emails: Annotation({
        reducer: (curr, next) => [...curr, ...next],
        default: () => []
    }),
    found_answer: Annotation({
        reducer: (curr, next) => next,
        default: () => false
    }),
    final_answer: Annotation({
        reducer: (curr, next) => next,
        default: () => ""
    }),
    dom_error: Annotation({
        reducer: (curr, next) => next,
        default: () => false
    })
});

// 2. Define Nodes

async function domScraperNode(state) {
    console.log("[Node] domScraperNode starting for page:", state.current_page);
    updateUI("Initializing page " + state.current_page + " scrape...", true);
    
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
        console.error("No active tab found");
        return { dom_error: true, final_answer: "Could not find active tab." };
    }
    console.log("Found active tab:", tab.id, tab.url);

    try {
        // Send message to content script
        const response = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { 
                action: 'SCRAPE_EMAILS', 
                targetPage: state.current_page 
            }, resolve);
        });

        if (chrome.runtime.lastError || !response) {
            console.error("Message error:", chrome.runtime.lastError);
            return { dom_error: true, final_answer: "Ensure you are on the Roundcube page and refresh." };
        }

        console.log("Received response from content script:", response);

        if (!response.success) {
            return { dom_error: true, final_answer: "Scraping error: " + response.error };
        }

        return {
            scraped_emails: response.emails,
            has_next_page: response.hasNextPage
        };

    } catch (e) {
        return { dom_error: true, final_answer: "Exception during scraping: " + e.message };
    }
}

async function synthesizerNode(state) {
    if (state.dom_error) {
        console.log("Skipping synthesizer because of dom_error");
        return {};
    }
    
    console.log("[Node] synthesizerNode starting with emails count:", state.scraped_emails.length);
    updateUI("Synthesizing data from " + state.scraped_emails.length + " emails...", true);
    
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
        return { dom_error: true, final_answer: "Please enter your Gemini API Key in the settings above." };
    }

    const systemPrompt = `You are an exact data-extraction agent. Review the provided webmail JSON data to answer the user's query.
RULES:
1. ONLY use the provided JSON. Do not guess.
2. If the answer is present, format it clearly using Markdown.
3. If the answer is NOT in the provided emails, do not apologize. Simply set the 'found' flag to false.

Respond ONLY with valid JSON matching this schema:
{
  "found": boolean,
  "answer": "markdown string"
}`;

    const userPrompt = `Query: ${state.user_query}\n\nEmails JSON:\n${JSON.stringify(state.scraped_emails, null, 2)}`;

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }
                ],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            })
        });

        console.log("Gemini API response status:", res.status);

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            if (res.status === 429) {
                return { dom_error: true, final_answer: "API Limit Reached! You have exhausted your Gemini API limits. Please wait or use a different key." };
            }
            if (res.status === 401 || res.status === 403) {
                 return { dom_error: true, final_answer: "Invalid API Key! Please check your Gemini API key." };
            }
            return { dom_error: true, final_answer: `API Error (${res.status}): ${errorData.error?.message || res.statusText}` };
        }

        const data = await res.json();
        
        if (data.error) {
            return { dom_error: true, final_answer: "API Error: " + data.error.message };
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(textResponse);
        console.log("Parsed Gemini response:", parsed);

        return {
            found_answer: parsed.found,
            final_answer: parsed.answer
        };
    } catch (e) {
        console.error("Synthesizer Exception:", e);
        return { dom_error: true, final_answer: "Failed to contact Gemini API: " + e.message };
    }
}

// 3. Define Graph Routing Logic
function routeAfterSynthesis(state) {
    if (state.found_answer || state.dom_error) {
        return END;
    }
    
    if (!state.found_answer && state.current_page < state.max_pages && state.has_next_page) {
        return "domScraper";
    }
    
    return END;
}

// 4. Build Graph
const workflow = new StateGraph(StateAnnotation)
    .addNode("domScraper", domScraperNode)
    .addNode("synthesizer", synthesizerNode)
    .addEdge(START, "domScraper")
    .addEdge("domScraper", "synthesizer")
    .addConditionalEdges("synthesizer", routeAfterSynthesis);

const app = workflow.compile();


// --- UI Integration ---

const chatHistory = document.getElementById('chatHistory');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const loadingText = document.getElementById('loadingText');
const apiKeyInput = document.getElementById('apiKey');
const saveKeyBtn = document.getElementById('saveKeyBtn');

// Load API Key
const savedKey = localStorage.getItem('geminiApiKey');
if (savedKey) apiKeyInput.value = savedKey;

saveKeyBtn.addEventListener('click', () => {
    localStorage.setItem('geminiApiKey', apiKeyInput.value);
    saveKeyBtn.textContent = 'Saved!';
    setTimeout(() => saveKeyBtn.textContent = 'Save', 2000);
});

function addMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    let htmlText = text.replace(/\n/g, '<br>');
    contentDiv.innerHTML = htmlText;
    
    msgDiv.appendChild(contentDiv);
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function updateUI(text, isLoading) {
    if (isLoading) {
        loadingIndicator.style.display = 'flex';
        loadingText.textContent = text;
    } else {
        loadingIndicator.style.display = 'none';
    }
}

// Listen for progress updates from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SCRAPE_PROGRESS') {
        updateUI(request.text, true);
    }
});

async function handleSend() {
    const query = userInput.value.trim();
    if (!query) return;

    addMessage('user', query);
    userInput.value = '';
    userInput.disabled = true;
    sendBtn.disabled = true;

    console.log("--- Starting handleSend for query:", query, "---");

    try {
        console.log("Invoking LangGraph app...");
        const finalState = await app.invoke({
            user_query: query,
            current_page: 1,
            scraped_emails: []
        });
        
        console.log("LangGraph finished with state:", finalState);

        if (finalState.dom_error) {
            addMessage('system', "❌ " + finalState.final_answer);
        } else if (finalState.found_answer) {
            addMessage('system', finalState.final_answer);
        } else {
            addMessage('system', "I looked through the most recent emails but couldn't find anything about that.");
        }
    } catch (e) {
        console.error("Exception in handleSend execution:", e);
        addMessage('system', "System error: " + e.message);
    } finally {
        updateUI("", false);
        userInput.disabled = false;
        sendBtn.disabled = false;
        userInput.focus();
    }
}

sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
});
