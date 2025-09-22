// Popup.jsx
import React, { useState } from "react";

export default function Popup() {
  const [inputValue, setInputValue] = useState("");
  const [isInputEnabled, setIsInputEnabled] = useState(true);
  const [lastResponse, setLastResponse] = useState(null);
  const [restrictedInfo, setRestrictedInfo] = useState(null);

  // Load saved prompt on open
  React.useEffect(() => {
    try {
      if (chrome?.storage?.sync) {
        chrome.storage.sync.get({ savedPrompt: "" }, (res) => {
          if (typeof res?.savedPrompt === "string") {
            setInputValue(res.savedPrompt);
          }
        });
      }
    } catch {}
  }, []);

  const isRestrictedUrl = (url) => {
    if (!url) return true;
    return (
      url.startsWith("chrome://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url.startsWith("chrome-extension://") ||
      // Chrome Web Store or pdf viewer often block content scripts
      url.includes("chrome.google.com/webstore") ||
      url.startsWith("chrome://extensions")
    );
  };

  const ensureContentScript = async (tabId) => {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "PING" }, () => {
        if (!chrome.runtime.lastError) {
          resolve(true);
          return;
        }
        try {
          chrome.scripting.executeScript(
            {
              target: { tabId },
              files: ["content.js"],
            },
            () => {
              setTimeout(() => resolve(true), 50);
            }
          );
        } catch (e) {
          resolve(false);
        }
      });
    });
  };

  const sendPromptToActiveTab = (prompt) => {
    if (!prompt && prompt !== "") {
      // allow empty
    }
    if (!chrome || !chrome.tabs) {
      setLastResponse({ success: false, error: "chrome.tabs not available" });
      return;
    }

    // Persist globally before sending
    try {
      chrome?.storage?.sync?.set({ savedPrompt: String(prompt ?? "") });
    } catch {}

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setLastResponse({ success: false, error: "No active tab" });
        return;
      }

      const url = tab.url || "";
      if (isRestrictedUrl(url)) {
        setRestrictedInfo("This page does not allow extensions to run (e.g., chrome://, Web Store, or internal pages). Open any normal website and try again.");
        setLastResponse({ success: false, error: "Restricted page" });
        return;
      }

      const tabId = tab.id;
      const doSend = () => {
      chrome.tabs.sendMessage(
          tabId,
        { type: "PROMPT_FROM_POPUP", prompt },
        (response) => {
          if (chrome.runtime.lastError) {
            setLastResponse({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            setLastResponse(response);
          }
        );
      };

      chrome.tabs.sendMessage(tabId, { type: "PING" }, async () => {
        if (chrome.runtime.lastError) {
          const ok = await ensureContentScript(tabId);
          if (!ok) {
            setLastResponse({ success: false, error: "Content script not available" });
            return;
          }
          doSend();
        } else {
          doSend();
        }
      });
    });
  };

  const handleLockToggle = () => {
    const newEnabled = !isInputEnabled;
    setIsInputEnabled(newEnabled);
    if (!newEnabled) {
      sendPromptToActiveTab(inputValue);
    }
  };

  return (
    <div className="popup-root" 
     style={{ width: '300px', borderRadius: '8px' }}
    >
      <h1 className="popup-heading">Text Enhanser</h1>
      <br />
      <img
        className="popup-logo"
        src="https://cdn-icons-png.freepik.com/512/10337/10337559.png"
        alt="Extension Banner"
      />
 
      {restrictedInfo && (
        <div className="response-msg error">
          {restrictedInfo}
        </div>
      )}

      <input
        className="popup-input"
        type="text"
        placeholder="Enter Your Prompt"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        disabled={!isInputEnabled}
      />

      <div className="popup-actions">
        <button
          onClick={() => handleLockToggle(inputValue)}
          className="button block"
          disabled={!!restrictedInfo}
        >
          Lock prompt
        </button>
      </div>

      {lastResponse && (
        <div
        className={`response-msg ${lastResponse.success ? "success" : "error"}`}
        >
          {lastResponse.success ? "Sent ✓" : `Failed: ${lastResponse.error || "unknown"}`}
        </div>
      )}
    </div>
  );
}