import { GEMINI_API_KEY } from './config.js';

let timeoutId = null;
let lastActiveInput = null;
let lastProcessedText = '';
let isProcessing = false;
let isApiUpdate = false;
let currentObserver = null;
// let processedInputs = new WeakSet();
let textChangeTimeout = null;
let lastEnhancedText = '';
let textToEnhance = '';

// Enforce single concise output from the model
const SINGLE_OUTPUT_SUFFIX = "\n\nConstraints: Respond with exactly one final rewrite/translation only. Do not include multiple options, bullets, quotes, examples, or explanations. Do not repeat or include the original/source text. Output only the final rewritten/translated sentence.";

// --- Add these helpers near the top of content.js ---

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Try to find a Lexical editor instance on or near the element.
 * Looks for common property names on the element or its ancestors,
 * and as a last resort scans window for objects that look like editors.
 */
function findLexicalEditorInstance(el) {
  console.log('🔧 Step 2 - Looking for Lexical editor...');
  if (!el) return null;
  const props = [
    '__lexicalEditor', '_lexicalEditor', 'lexicalEditor',
    '_editor', '__editor', 'editor'
  ];
  let cur = el;
  while (cur) {
    for (const p of props) {
      try {
        if (cur[p] && typeof cur[p] === 'object') {
          console.log(`🔧 Step 2 - Found editor via property: ${p}`);
          return cur[p];
        }
      } catch (e) {}
    }
    cur = cur.parentElement;
  }

  // Last-resort: try to find a global-looking lexical/editor object on window
  try {
    const names = Object.getOwnPropertyNames(window);
    for (const name of names) {
      if (!name) continue;
      try {
        const v = window[name];
        if (v && typeof v === 'object' && typeof v.update === 'function') {
          const keyLower = String(name).toLowerCase();
          if (keyLower.includes('lexical') || keyLower.includes('editor')) {
            console.log(`🔧 Step 2 - Found editor on window: ${name}`);
            return v;
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  console.log('🔧 Step 2 - No Lexical editor instance found.');
  return null;
}

/**
 * Try to update Lexical editor using page-global helper functions if available,
 * or using a generic editor.update() call. Returns true if successful.
 */
async function tryApplyLexicalEditor(lexicalEditor, text) {
  if (!lexicalEditor || typeof lexicalEditor.update !== 'function') {
    console.log('🔧 No usable editor.update() found on instance.');
    return false;
  }

  // If page exported $getRoot / $createParagraphNode / $createTextNode (rare but possible),
  // prefer that because it uses the actual Lexical helpers the page loaded.
  const hasPageHelpers =
    typeof window.$getRoot === 'function' &&
    typeof window.$createParagraphNode === 'function' &&
    typeof window.$createTextNode === 'function';

  if (hasPageHelpers) {
    try {
      console.log('🔧 Step 3 - Using page-exposed Lexical helpers to update editor state.');
      lexicalEditor.update(() => {
        const root = window.$getRoot();
        root.clear();
        const p = window.$createParagraphNode();
        p.append(window.$createTextNode(text));
        root.append(p);
      });
      return true;
    } catch (err) {
      console.error('🔧 Lexical helper path failed:', err);
      // fallthrough to other attempts
    }
  }

  // Generic editor.update() attempt: try to insert text via known instance methods or by touching the root element.
  try {
    console.log('🔧 Step 3 - Attempting generic editor.update insertion...');
    let success = false;
    lexicalEditor.update(() => {
      try {
        // many times editor.insertText won't exist here, but try defensive checks
        if (typeof lexicalEditor.insertText === 'function') {
          lexicalEditor.insertText(text);
          success = true;
          return;
        }

        // some editors expose getRootElement or similar - try to use it
        if (typeof lexicalEditor.getRootElement === 'function') {
          const rootEl = lexicalEditor.getRootElement();
          if (rootEl && rootEl.nodeType === Node.ELEMENT_NODE) {
            while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
            const p = document.createElement('p');
            p.textContent = text;
            rootEl.appendChild(p);
            success = true;
            return;
          }
        }

        // If nothing else, throw to fallback to paste/dom approach
        throw new Error('No safe insertion method found in generic editor.update()');
      } catch (err) {
        console.warn('🔧 inside lexicalEditor.update: fallback hit', err);
        throw err;
      }
    });
    return !!success;
  } catch (err) {
    console.warn('🔧 Generic lexicalEditor.update path failed:', err);
    return false;
  }
}

// Enhanced cross-tab prompt synchronization
// Add this at the top of your content.js file, replacing the existing storage code

let globalPrompt = '';

// Load saved prompt at startup with better error handling
async function loadSavedPrompt() {
    try {
        if (chrome?.storage?.sync) {
            return new Promise((resolve) => {
                chrome.storage.sync.get({ savedPrompt: '' }, (res) => {
                    if (chrome.runtime.lastError) {
                        console.error('Error loading saved prompt:', chrome.runtime.lastError);
                        resolve('');
                    } else {
                        const prompt = typeof res?.savedPrompt === 'string' ? res.savedPrompt : '';
                        globalPrompt = prompt;
                        window.__lastPopupPrompt = prompt;
                        console.log('[content.js] Loaded savedPrompt from storage:', prompt);
                        resolve(prompt);
                    }
                });
            });
        }
    } catch (e) {
        console.error('Error accessing Chrome storage:', e);
    }
    return '';
}

// Save prompt with better error handling
async function savePrompt(prompt) {
    try {
        if (chrome?.storage?.sync) {
            return new Promise((resolve) => {
                chrome.storage.sync.set({ savedPrompt: prompt }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('Error saving prompt:', chrome.runtime.lastError);
                        resolve(false);
                    } else {
                        console.log('[content.js] Saved prompt to storage:', prompt);
                        resolve(true);
                    }
                });
            });
        }
    } catch (e) {
        console.error('Error saving to Chrome storage:', e);
    }
    return false;
}

// Listen for storage changes from other tabs
if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.savedPrompt) {
            const newPrompt = changes.savedPrompt.newValue || '';
            console.log('[content.js] Storage changed from another tab:', newPrompt);
            globalPrompt = newPrompt;
            window.__lastPopupPrompt = newPrompt;
        }
    });
}

// Initialize on script load
loadSavedPrompt();

// Quick heartbeat for popup to detect content script presence
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'PING') {
        sendResponse({ ok: true });
        return true;
    }
});

function isValidInput(element) {
    const tagName = element.tagName;
    const isContentEditable = element.isContentEditable;
    const role = element.getAttribute('role');

    if (tagName === 'INPUT' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(element.type)) {
        return true;
    }
    if (tagName === 'TEXTAREA') {
        return true;
    }
    if (isContentEditable) {
        if (element.id === 'main' || element.getAttribute('data-tab') === 'search') {
            return false;
        }
        return true;
    }
    if (tagName === 'DIV' && role === 'textbox' && element.getAttribute('data-tab') === '10') {
        return true;
    }
    return false;
}

console.log('%c🔍 Gemini Text Enhancer content script loaded!', 'background: #4CAF50; color: white; padding: 5px; border-radius: 3px; font-size: 14px;');

const scriptIndicator = document.createElement('div');
scriptIndicator.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: #4CAF50;
    color: white;
    padding: 5px 10px;
    border-radius: 3px;
    font-size: 12px;
    z-index: 999999;
    opacity: 0.8;
`;
scriptIndicator.textContent = 'Gemini Enhancer Active';
document.body.appendChild(scriptIndicator);

// Function to find the chat input box in WhatsApp Web
const findChatInputBox = () => {
    const chatInput = document.querySelector('div[contenteditable="true"][data-lexical-editor="true"][aria-label="Type a message"]');
    if (chatInput) {
        console.log('Found main chat input box:', chatInput);
        return chatInput;
    }

    const editableDivs = document.querySelectorAll('div[contenteditable="true"]');
    for (const div of editableDivs) {
        const ariaLabel = div.getAttribute("aria-label")?.toLowerCase() || '';
        if (
            ariaLabel.includes("type a message") ||
            (div.dataset.lexicalEditor === "true" && 
             !ariaLabel.includes("search") && 
             !ariaLabel.includes("search input"))
        ) {
            console.log('Found alternative chat input box:', div);
            return div;
        }
    }
    return null;
};

// Function to check if an element is the search box
const isSearchBox = (element) => {
    const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() || '';
    return ariaLabel.includes("search") || ariaLabel.includes("search input");
};

// Function to find the closest contenteditable element
const findClosestContentEditable = (element) => {
    let current = element;
    while (current) {
        if (current.isContentEditable) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
};

// Function to get text from an input element
// Enhanced getInputText to better handle WhatsApp structures
const getInputText = (element) => {
    console.log('%c🔍 getInputText called for:', 'color: #2196F3', element);
    
    if (!element) {
        console.error('%cgetInputText received null/undefined element.', 'color: #F44336');
        return '';
    }

    // Handle standard input elements
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return element.value || '';
    }
    
    // Handle contenteditable elements
    if (element.isContentEditable) {
        // For WhatsApp, get text from all text spans to handle the concatenation issue
        const allTextSpans = element.querySelectorAll('[data-lexical-text="true"]');
        if (allTextSpans.length > 0) {
            const combinedText = Array.from(allTextSpans)
                .map(span => span.textContent || '')
                .join('');
            console.log('%cCombined text from spans:', 'color: #2196F3', `"${combinedText}"`);
            return combinedText;
        }
        
        // Fallback to textContent
        return element.textContent || '';
    }
    
    return '';
};


// WhatsApp/Lexical-safe setter for contenteditable inputs
                        // async function setEditableText(editableElement, text) {
//     if (!editableElement) return;

//     console.log('%c🔧 setEditableText called with text:', 'color: #FF5722', text);
//     console.log('%c🔧 Target element:', 'color: #FF5722', editableElement);

//     // Target the Lexical root if available
//     const root = editableElement.closest('div[contenteditable="true"][data-lexical-editor="true"]') || editableElement;
//     root.focus();
    
//     console.log('%c🔧 Root element:', 'color: #FF5722', root);

//     let updated = false;

//     // 1) Deterministic DOM replace: single paragraph + lexical span with only enhanced text
//     try {
//         while (root.firstChild) root.removeChild(root.firstChild);
//         const p = document.createElement('p');
//         p.className = 'selectable-text copyable-text';
//         const s = document.createElement('span');
//         s.setAttribute('data-lexical-text', 'true');
//         s.textContent = text;
//         p.appendChild(s);
//         root.appendChild(p);
//         updated = true;
//         console.log('%c🔧 DOM manipulation successful', 'color: #4CAF50');
//     } catch (e) { 
//         console.log('%c🔧 DOM manipulation failed:', 'color: #F44336', e);
//         updated = false; 
//     }

//     // 2) If DOM replace somehow blocked, try Range-based replace
//     if (!updated) {
//         try {
//             const sel = window.getSelection();
//             const r = document.createRange();
//             r.selectNodeContents(root);
//             sel.removeAllRanges();
//             sel.addRange(r);
//             r.deleteContents();
//             const node = document.createTextNode(text);
//             r.insertNode(node);
//             sel.removeAllRanges();
//             const end = document.createRange();
//             end.selectNodeContents(root);
//             end.collapse(false);
//             sel.addRange(end);
//             updated = true;
//         } catch { updated = false; }
//     }

//     // 3) Clipboard paste path (Lexical-friendly)
//     if (!updated) {
//         try {
//             const sel = window.getSelection();
//             const r = document.createRange();
//             r.selectNodeContents(root);
//             sel.removeAllRanges();
//             sel.addRange(r);
//             const dt = new DataTransfer();
//             dt.setData('text/plain', text);
//             const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
//             updated = root.dispatchEvent(pasteEvent) === true;
//         } catch { updated = false; }
//     }

//     // 4) ExecCommand delete + insertText
//     if (!updated) {
//         try {
//             const sel = window.getSelection();
//             const r = document.createRange();
//             r.selectNodeContents(root);
//             sel.removeAllRanges();
//             sel.addRange(r);
//             try { document.execCommand && document.execCommand('delete'); } catch {}
//             try { updated = !!(document.execCommand && document.execCommand('insertText', false, text)); } catch { updated = false; }
//         } catch { updated = false; }
//     }

//     // 5) Final normalization (ensure only enhanced text remains)
//     try {
//         const paras = Array.from(root.querySelectorAll('p'));
//         const first = paras[0] || document.createElement('p');
//         if (!first.parentElement) root.appendChild(first);
//         first.classList.add('selectable-text', 'copyable-text');
//         for (let i = 1; i < paras.length; i++) paras[i].remove();
//         while (first.firstChild) first.removeChild(first.firstChild);
//         const s = document.createElement('span');
//         s.setAttribute('data-lexical-text', 'true');
//         s.textContent = text;
//         first.appendChild(s);
//     } catch {}

//     // Verify the text was actually set
//     const finalText = root.textContent || root.innerText || '';
//     console.log('%c🔧 Final text in element:', 'color: #FF5722', `"${finalText}"`);
//     console.log('%c🔧 Expected text:', 'color: #FF5722', `"${text}"`);
//     console.log('%c🔧 Text matches:', 'color: #FF5722', finalText === text);
    
//     // Dispatch input/change to notify frameworks
//     try { root.dispatchEvent(new InputEvent('input', { bubbles: true })); } catch {}
//     try { root.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
                        // }

// --- Replace your old setInputText with this complete async function ---
// Improved setInputText function specifically for WhatsApp Web
// Fixed setInputText function - properly clears and replaces text
// Enhanced setInputText function with better WhatsApp Web support
async function setInputText(element, text) {
    if (!element) return;
    
    console.log('%c🔧 setInputText called with text:', 'color: #FF5722', text);
    console.log('%c🔧 Target element:', 'color: #FF5722', element);

    element.focus();
    isApiUpdate = true;

    // Handle regular input/textarea elements
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        try {
            element.value = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.setSelectionRange(text.length, text.length);
            
            console.log('%c🔧 Standard input/textarea updated successfully', 'color: #4CAF50');
            lastEnhancedText = text;
            lastProcessedText = text;
            isApiUpdate = false;
            return;
        } catch (e) {
            console.log('%c🔧 Standard input method failed:', 'color: #F44336', e);
        }
    }

    // Handle contenteditable elements (WhatsApp, Gmail, etc.)
    const root = element.closest('div[contenteditable="true"]') || element;
    let success = false;

    // Method 1: Aggressive clearing with multiple attempts
    try {
        console.log('%c🔧 Method 1: Aggressive clearing and replacement', 'color: #2196F3');
        
        root.focus();
        
        // Step 1: Multiple clearing attempts
        for (let attempt = 0; attempt < 3; attempt++) {
            console.log(`%c🔧 Clearing attempt ${attempt + 1}`, 'color: #FF9800');
            
            // Clear via selection and deletion
            try {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(root);
                selection.removeAllRanges();
                selection.addRange(range);
                
                // Multiple deletion methods
                range.deleteContents();
                document.execCommand('delete');
                document.execCommand('cut');
                
                selection.removeAllRanges();
            } catch (e) {
                console.log(`Clear attempt ${attempt + 1} failed:`, e);
            }
            
            // Direct DOM clearing
            try {
                root.innerHTML = '';
                root.textContent = '';
                while (root.firstChild) {
                    root.removeChild(root.firstChild);
                }
            } catch (e) {
                console.log(`DOM clear attempt ${attempt + 1} failed:`, e);
            }
            
            // Check if cleared
            const currentText = root.textContent || root.innerText || '';
            console.log(`%c🔧 After clear attempt ${attempt + 1}, remaining text:`, 'color: #FF9800', `"${currentText}"`);
            
            if (!currentText.trim()) {
                console.log('%c🔧 Successfully cleared content', 'color: #4CAF50');
                break;
            }
            
            // Small delay between attempts
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Step 2: Insert new text with proper structure
        if (root.dataset.lexicalEditor === 'true') {
            // WhatsApp Lexical structure
            const paragraph = document.createElement('p');
            paragraph.className = 'selectable-text copyable-text';
            
            const textSpan = document.createElement('span');
            textSpan.setAttribute('data-lexical-text', 'true');
            textSpan.textContent = text;
            
            paragraph.appendChild(textSpan);
            root.appendChild(paragraph);
        } else {
            // Generic contenteditable
            root.textContent = text;
        }
        
        success = true;
        console.log('%c🔧 Method 1: SUCCESS', 'color: #4CAF50');
    } catch (e) {
        console.log('%c🔧 Method 1 failed:', 'color: #F44336', e);
    }

    // Method 2: Keyboard simulation approach
    if (!success) {
        try {
            console.log('%c🔧 Method 2: Keyboard simulation', 'color: #2196F3');
            
            root.focus();
            
            // Simulate Ctrl+A to select all
            root.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'a',
                code: 'KeyA',
                ctrlKey: true,
                bubbles: true
            }));
            
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // Simulate typing the new text
            for (const char of text) {
                root.dispatchEvent(new KeyboardEvent('keydown', {
                    key: char,
                    code: `Key${char.toUpperCase()}`,
                    bubbles: true
                }));
                
                root.dispatchEvent(new InputEvent('input', {
                    data: char,
                    inputType: 'insertText',
                    bubbles: true
                }));
            }
            
            success = true;
            console.log('%c🔧 Method 2: SUCCESS', 'color: #4CAF50');
        } catch (e) {
            console.log('%c🔧 Method 2 failed:', 'color: #F44336', e);
        }
    }

    // Method 3: Force replacement with innerHTML
    if (!success) {
        try {
            console.log('%c🔧 Method 3: Force innerHTML replacement', 'color: #2196F3');
            
            const escapedText = text.replace(/&/g, '&amp;')
                                  .replace(/</g, '&lt;')
                                  .replace(/>/g, '&gt;')
                                  .replace(/"/g, '&quot;')
                                  .replace(/'/g, '&#039;');
            
            if (root.dataset.lexicalEditor === 'true') {
                root.innerHTML = `<p class="selectable-text copyable-text"><span data-lexical-text="true">${escapedText}</span></p>`;
            } else {
                root.innerHTML = escapedText;
            }
            
            success = true;
            console.log('%c🔧 Method 3: SUCCESS', 'color: #4CAF50');
        } catch (e) {
            console.log('%c🔧 Method 3 failed:', 'color: #F44336', e);
        }
    }

    // Method 4: Lexical editor specific approach
    if (!success && root.dataset.lexicalEditor === 'true') {
        try {
            console.log('%c🔧 Method 4: Lexical editor specific approach', 'color: #2196F3');
            
            // Try to find and use Lexical editor instance
            const lexicalEditor = findLexicalEditorInstance(root);
            if (lexicalEditor) {
                const lexicalSuccess = await tryApplyLexicalEditor(lexicalEditor, text);
                if (lexicalSuccess) {
                    success = true;
                    console.log('%c🔧 Method 4: SUCCESS via Lexical editor', 'color: #4CAF50');
                }
            }
        } catch (e) {
            console.log('%c🔧 Method 4 failed:', 'color: #F44336', e);
        }
    }

    // Position cursor at end
    try {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(root);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (e) {
        console.log('%c🔧 Cursor positioning failed:', 'color: #FFC107', e);
    }

    // Dispatch events
    const events = [
        new Event('input', { bubbles: true }),
        new Event('change', { bubbles: true }),
        new KeyboardEvent('keyup', { bubbles: true })
    ];

    events.forEach(event => {
        try {
            root.dispatchEvent(event);
        } catch (e) {
            console.log('%c🔧 Event dispatch failed:', 'color: #FFC107', e);
        }
    });

    // Update tracking variables
    lastEnhancedText = text;
    lastProcessedText = text;

    // Enhanced verification with retry
    setTimeout(async () => {
        let finalText = getInputText(root);
        console.log('%c🔧 Final verification - Expected:', 'color: #2196F3', `"${text}"`);
        console.log('%c🔧 Final verification - Actual:', 'color: #2196F3', `"${finalText}"`);
        
        // If text still contains original text, try one more aggressive clear
        if (finalText.includes('hi i is shivam') || finalText !== text) {
            console.log('%c🔧 Verification failed, attempting final cleanup', 'color: #FF9800');
            
            try {
                // Nuclear option: completely rebuild the element structure
                const parent = root.parentElement;
                const newRoot = root.cloneNode(false); // Clone without children
                
                if (root.dataset.lexicalEditor === 'true') {
                    const p = document.createElement('p');
                    p.className = 'selectable-text copyable-text';
                    const span = document.createElement('span');
                    span.setAttribute('data-lexical-text', 'true');
                    span.textContent = text;
                    p.appendChild(span);
                    newRoot.appendChild(p);
                } else {
                    newRoot.textContent = text;
                }
                
                parent.replaceChild(newRoot, root);
                newRoot.focus();
                
                // Update reference if this is the active input
                if (lastActiveInput === root) {
                    lastActiveInput = newRoot;
                }
                
                console.log('%c🔧 Final cleanup completed', 'color: #4CAF50');
            } catch (e) {
                console.log('%c🔧 Final cleanup failed:', 'color: #F44336', e);
            }
        }
        
        isApiUpdate = false;
    }, 200);
}

// Alternative approach: Try to trigger WhatsApp's internal text setting mechanism
async function setWhatsAppText(element, text) {
    // This function attempts to work with WhatsApp's internal React/Lexical state
    element.focus();
    
    // Try to find React fiber node
    const fiberKey = Object.keys(element).find(key => key.startsWith('__reactInternalInstance') || key.startsWith('_reactInternalFiber'));
    
    if (fiberKey) {
        try {
            const fiber = element[fiberKey];
            // This is experimental - React Fiber manipulation
            console.log('%c🔧 Found React Fiber:', 'color: #9C27B0', fiber);
            
            // Try to trigger React's onChange
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            const event = new Event('input', { bubbles: true });
            
            element.focus();
            element.select();
            document.execCommand('insertText', false, text);
            element.dispatchEvent(event);
        } catch (e) {
            console.log('%c🔧 React Fiber approach failed:', 'color: #F44336', e);
            // Fallback to regular method
            return setInputText(element, text);
        }
    } else {
        return setInputText(element, text);
    }
}
  

// Function to setup MutationObserver
const setupMutationObserver = (element) => {
    if (currentObserver) {
        currentObserver.disconnect();
        console.log('%cDisconnecting previous MutationObserver.', 'color: #FFC107');
    }
    
    console.log('%cSetting up MutationObserver for contenteditable element:', 'color: #FFC107', element);
    
    currentObserver = new MutationObserver((mutations) => {
        if (isApiUpdate) {
            console.log('%cSkipping mutation processing during API update.', 'color: #FFC107');
            return;
        }
        
        console.log('%c🌳 MutationObserver callback triggered.', 'color: #4CAF50', `Time: ${performance.now().toFixed(2)}ms`);
        const currentText = getInputText(element);
        const trimmedCurrentText = currentText.trim();
        const trimmedLastProcessedText = lastProcessedText.trim();
        const trimmedLastEnhancedText = lastEnhancedText.trim();

        console.log('%c[MutationObserver] Current text (trimmed): ', 'color: #4CAF50', `"${trimmedCurrentText}"`);
        console.log('%c[MutationObserver] Last processed text (trimmed): ', 'color: #4CAF50', `"${trimmedLastProcessedText}"`);
        console.log('%c[MutationObserver] Last enhanced text (trimmed): ', 'color: #4CAF50', `"${trimmedLastEnhancedText}"`);
        console.log('%c[MutationObserver] current === lastEnhanced: ', 'color: #4CAF50', trimmedCurrentText === trimmedLastEnhancedText);
        console.log('%c[MutationObserver] current === lastProcessed: ', 'color: #4CAF50', trimmedCurrentText === trimmedLastProcessedText);
        
        // Don't show popup if current text matches last enhanced text or last processed text
        if (trimmedCurrentText === trimmedLastEnhancedText || trimmedCurrentText === trimmedLastProcessedText) {
            console.log('Text matches last enhanced/processed text, not showing popup.');
            return;
        }

        if (trimmedCurrentText !== trimmedLastProcessedText && trimmedCurrentText) { 
            console.log('%c[MutationObserver] Text changed and is not empty/whitespace, scheduling new timeout for popup (2000ms).', 'color: #4CAF50');
            if (textChangeTimeout) {
                clearTimeout(textChangeTimeout);
            }
            textChangeTimeout = setTimeout(() => {
                console.log('%c[MutationObserver] Timeout triggered! Attempting to show popup.', 'color: #4CAF50');
                const textAfterDelay = getInputText(element); // Get text again in case it changed during delay
                const trimmedTextAfterDelay = textAfterDelay.trim();
                // Only show popup if text is not empty and is different from last enhanced text
                if (trimmedTextAfterDelay && trimmedTextAfterDelay !== trimmedLastEnhancedText) {
                    console.log('%c[MutationObserver] Text is genuinely new after delay, showing popup.', 'color: #4CAF50');
                    showPopup(element, textAfterDelay); // Pass current text to showPopup for textToEnhance
                } else {
                    console.log('%c[MutationObserver] Text is empty, whitespace, or matches last enhanced text at timeout, not showing popup.', 'color: #FFC107');
                }
            }, 2000); // Changed delay to 2 seconds
            
            lastProcessedText = currentText; // Update lastProcessedText after scheduling timer
            console.log('%c[MutationObserver] lastProcessedText updated to:', 'color: #FFC107', `"${lastProcessedText}"`);
        }
        
        console.log('%cisApiUpdate after mutation processing:', 'color: #FFC107', isApiUpdate);
    });
    
    currentObserver.observe(element, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// Function to show the popup
const showPopup = (element, currentInputText) => {
    // Ensure element is visible and valid
    if (!element || !element.offsetParent) {
        console.log('%cElement not visible or invalid for popup.', 'color: #FFC107');
        resetPopup();
        return;
    }

    textToEnhance = currentInputText; // Store the text that triggered the popup for API call
    console.log('%cText stored for enhancement:', 'color: #4CAF50', `"${textToEnhance}"`, `Time: ${performance.now().toFixed(2)}ms`);

    const rect = element.getBoundingClientRect();

    // Prevent popup from going off-screen or being hidden
    const popupWidth = 200; // Approximate popup width
    const popupHeight = 50; // Approximate popup height

    let leftPos = rect.left + window.scrollX;
    let topPos = rect.bottom + window.scrollY + 5;

    if (leftPos + popupWidth > window.innerWidth) {
        leftPos = window.innerWidth - popupWidth - 10; // Adjust to fit on screen
    }
    if (topPos + popupHeight > window.innerHeight) {
        topPos = rect.top + window.scrollY - popupHeight - 5; // Position above if no space below
    }

    popup.style.left = `${leftPos}px`;
    popup.style.top = `${topPos}px`;
    popup.style.display = 'block';
    popup.offsetHeight; // Trigger reflow
    popup.style.opacity = '1';

    console.log('Popup shown for:', element.tagName, 'at', `(${leftPos}, ${topPos})`, `Time: ${performance.now().toFixed(2)}ms`);
};

// Function to enhance text with Gemini API


const enhanceTextWithGemini = async (text, hideAlert = false) => {
    if (!GEMINI_API_KEY) {
        console.error('Gemini API key is not set.');
        if (!hideAlert) {
            alert('Gemini API key is not set. Please check your config.js');
        }
        return null;
    }

    // If the caller passed a full instruction (looks like an instruction + source text)
    // detect common markers to avoid wrapping it again.
    const looksLikeFinalPrompt = /source text:|translate to|translate into|translate|option 1:|fix any grammatical/i.test(text) || text.includes('{text}');
    let finalPrompt = "";

    if (looksLikeFinalPrompt) {
        // Caller already built an instruction (or used {text}); use as-is
        finalPrompt = text;
    } else {
        // Treat 'text' as the source text and apply default "fix grammar" instruction
        finalPrompt = `Fix any grammatical errors and improve this text to be more professional, but keep it concise and only give option one: ${text}`;
    }

    try {
        const response = await callGeminiAPI(finalPrompt, hideAlert);
        if (response && response.candidates && response.candidates.length > 0) {
            const geminiResponseText = response.candidates[0].content.parts[0].text;
            const match = geminiResponseText.match(/Option 1:\s*(.*)/i);
            return match ? match[1].trim() : geminiResponseText.trim();
        } else {
            console.warn('Gemini API response did not contain candidates.', response);
            if (!hideAlert) {
                alert('Could not get enhanced text from Gemini API. No candidates found.');
            }
            return null;
        }
    } catch (error) {
        console.error('Error enhancing text with Gemini API:', error);
        if (!hideAlert) {
            alert(`Error enhancing text: ${error.message}. Check console for details.`);
        }
        return null;
    }
};

// Handles focus event to determine the active input field
const handleFocus = (event) => {
    const target = event.target;
    if (isValidInput(target)) {
        lastActiveInput = target;
        console.log('Focus event detected on element:', target.tagName, ', contentEditable:', target.isContentEditable);
        console.log('Setting lastActiveInput to:', lastActiveInput);
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        popup.style.display = 'none';
        resetPopup();
        setupMutationObserver(target);
        lastProcessedText = getInputText(target); // Set initial processed text on focus
    } else {
        if (isSearchBox(target)) {
            console.log('Ignoring search box focus');
            return;
        }
        console.log('Focus event detected on element (ignored as not valid input): ', target.tagName, ', contentEditable:', target.isContentEditable);
    }
};

// Place cursor at the end of the input
function placeCursorAtEnd(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
    } else if (el.isContentEditable) {
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

async function checkAvailableModels() {
    const API_BASE_URL = 'https://generativelanguage.googleapis.com';
    try {
        const response = await fetch(`${API_BASE_URL}/v1beta/models?key=${GEMINI_API_KEY}`);
        const data = await response.json();
        console.log('Available models:', data);
    } catch (error) {
        console.error('Error checking available models:', error);
    }
}

// Create and append popup element
function createPopup() {
    const popup = document.createElement('div');
    popup.id = 'gemini-enhancer-popup';
    popup.style.cssText = `
        position: absolute;
    `;
    document.body.appendChild(popup);
    return popup;
}

const popup = createPopup();

// Updated enhance button click handler - use the globally synced prompt
// Replace your existing btn.addEventListener('click', ...) with this:
function createEnhanceButtonHandler(btn) {
    return async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!lastActiveInput || !textToEnhance) {
            console.warn('No active input or no text to enhance.');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Enhancing...';

        const globalEnterBlocker = (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopImmediatePropagation();
                return false;
            }
        };
        
        document.addEventListener('keydown', globalEnterBlocker, true);
        document.addEventListener('keyup', globalEnterBlocker, true);

        try {
            // Always get the latest prompt from storage to ensure cross-tab sync
            let userPrompt = await loadSavedPrompt();
            
            // Fallback to global or window variable if storage fails
            if (!userPrompt) {
                userPrompt = globalPrompt || window.__lastPopupPrompt || '';
            }

            console.log('[content.js] Using prompt for enhancement:', userPrompt);

            let finalPrompt = '';
            if (userPrompt && userPrompt.includes('{text}')) {
                finalPrompt = userPrompt.replaceAll('{text}', textToEnhance);
            } else if (userPrompt && /translate|hindi|convert|change the text|translate to|translate into/i.test(userPrompt)) {
                finalPrompt = textToEnhance ? `${userPrompt}\n\nSource text:\n${textToEnhance}` : userPrompt;
            } else if (userPrompt) {
                finalPrompt = textToEnhance ? `${userPrompt}\n\nSource text:\n${textToEnhance}` : userPrompt;
            } else {
                finalPrompt = `Fix any grammatical errors and improve this text to be more professional, but keep it concise and only give option one: ${textToEnhance}`;
            }

            console.log('%c🤖 Calling Gemini API with finalPrompt (enhance button):', 'color: #8D6E63', `${finalPrompt}`);
            const enhancedText = await enhanceTextWithGemini(finalPrompt + SINGLE_OUTPUT_SUFFIX, true);
            
            if (enhancedText) {
                console.log('✨ Enhanced text received:', enhancedText);
                await setInputText(lastActiveInput, enhancedText);
                placeCursorAtEnd(lastActiveInput);
                lastEnhancedText = enhancedText;
                console.log('%clastEnhancedText updated to:', 'color: #FFC107', `${lastEnhancedText}`, 'Time:', performance.now().toFixed(2) + 'ms');
            } else {
                console.error('Failed to get enhanced text from API');
            }
        } catch (error) {
            console.error('Error during text enhancement:', error);
        }

        setTimeout(() => {
            document.removeEventListener('keydown', globalEnterBlocker, true);
            document.removeEventListener('keyup', globalEnterBlocker, true);
        }, 1500);

        btn.disabled = false;
        btn.textContent = 'Enhance';
        resetPopup();
    };
}

// Reset popup state
function resetPopup() {
    popup.innerHTML = '';
    const btn = document.createElement('button');
    btn.textContent = 'Enhance';
    btn.style.cssText = `
        padding: 6px 12px;
        border-radius: 6px;
        border: none;
        background: #4CAF50;
        color: white;
        cursor: pointer;
        font-size: 14px;
    `;
    
    // Updated: use cross-tab synced handler
    btn.addEventListener('click', createEnhanceButtonHandler(btn));
    
    popup.appendChild(btn);
    popup.style.opacity = '0';
    popup.style.display = 'none';
    if (timeoutId) clearTimeout(timeoutId);
    if (textChangeTimeout) clearTimeout(textChangeTimeout);
}


// Call Gemini API
async function callGeminiAPI(text, hideAlert = false) {
    const API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    const requestBody = {
        contents: [{
            parts: [{
                text: text
            }]
        }]
    };

    try {
        const response = await fetch(`${API_ENDPOINT}?key=${GEMINI_API_KEY}` , {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        console.log('API Response Status:', response.status);
        console.log('API Response Status Text:', response.statusText);

        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error Response:', errorData);
            throw new Error(`API request failed: ${response.status}  - ${errorData.error.message}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('%c❌ Error calling Gemini API:', 'color: #F44336', error);
        if (!hideAlert) {
            alert(`Error calling Gemini API: ${error.message}. Check console for details.`);
        }
        throw error; 
    }
}

// Event Listeners
document.addEventListener('focusin', handleFocus);
document.addEventListener('input', function(e) {
    console.log('%c⌨️ Input event detected:', 'color: #FF9800', e.target.tagName, `Time: ${performance.now().toFixed(2)}ms`);
    if (isApiUpdate) {
        console.log('%cInput event is from API update, not showing popup.', 'color: #FFC107');
        return;
    }

    const target = e.target;
    if (!target || !isValidInput(target)) {
        return;
    }

    const currentText = getInputText(target);
    const trimmedCurrentText = currentText.trim();
    const trimmedLastProcessedText = lastProcessedText.trim();
    const trimmedLastEnhancedText = lastEnhancedText.trim();

    console.log('Current text from getInputText:', `"${currentText}"`);
    console.log('Current text (trimmed): ', `"${trimmedCurrentText}"`);
    console.log('Last processed text (trimmed): ', `"${trimmedLastProcessedText}"`);
    console.log('Last enhanced text (trimmed): ', `"${trimmedLastEnhancedText}"`);
    console.log('current === lastEnhanced: ', trimmedCurrentText === trimmedLastEnhancedText);
    console.log('current === lastProcessed: ', trimmedCurrentText === trimmedLastProcessedText);

    // Don't show popup if current text matches last enhanced text or last processed text
    if (trimmedCurrentText === trimmedLastEnhancedText || trimmedCurrentText === trimmedLastProcessedText) {
        console.log('Text matches last enhanced/processed text, not showing popup.');
        return;
    }

    if (trimmedCurrentText !== trimmedLastProcessedText) { 
        console.log('Text changed from last processed, scheduling popup timer.');
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            if (lastActiveInput && lastActiveInput === target) {
                console.log('Timeout triggered! Showing popup for element:', target, `Time: ${performance.now().toFixed(2)}ms`);
                showPopup(target, currentText); // Pass current text to showPopup for textToEnhance
            }
        }, 2000);
        lastProcessedText = currentText; // Update lastProcessedText after scheduling timer
        console.log('%clastProcessedText updated to:', 'color: #FFC107', `"${lastProcessedText}"`);
    }
});

// Updated message listener with better prompt synchronization
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'PING') {
        sendResponse({ ok: true });
        return true;
    }

    if (!message || message.type !== "PROMPT_FROM_POPUP") return;

    const prompt = typeof message.prompt === "string" ? message.prompt : String(message.prompt || "");
    console.log("[content.js] Received PROMPT_FROM_POPUP:", prompt, "from", sender);

    (async () => {
        try {
            // Save to storage first for cross-tab sync
            await savePrompt(prompt);
            
            // Update local variables
            globalPrompt = prompt;
            window.__lastPopupPrompt = prompt;

            // Broadcast to other tabs via storage (this will trigger storage change listeners)
            // The storage.set above already handles this, but we can also send a direct message
            try {
                chrome.runtime.sendMessage({
                    type: 'PROMPT_UPDATED',
                    prompt: prompt
                });
            } catch (e) {
                // Ignore if no other tabs are listening
            }

            if (typeof enhanceTextWithGemini === "function") {
                let enhanced = null;
                try {
                    const userInput = prompt.trim();
                    let sourceText = '';
                    
                    if (typeof lastActiveInput !== 'undefined' && lastActiveInput) {
                        try { 
                            sourceText = getInputText(lastActiveInput); 
                        } catch (e) { 
                            sourceText = ''; 
                        }
                    }
                    if (!sourceText && typeof textToEnhance === 'string') {
                        sourceText = textToEnhance;
                    }

                    let finalPrompt = '';
                    if (userInput.includes('{text}')) {
                        finalPrompt = userInput.replaceAll('{text}', sourceText || '');
                    } else if (/translate|hindi|convert|change the text|translate to|translate into/i.test(userInput)) {
                        if (sourceText) {
                            finalPrompt = `${userInput}\n\nSource text:\n${sourceText}`;
                        } else {
                            finalPrompt = userInput;
                        }
                    } else if (userInput.length > 0) {
                        if (sourceText) {
                            finalPrompt = `${userInput}\n\nSource text:\n${sourceText}`;
                        } else {
                            finalPrompt = userInput;
                        }
                    } else {
                        finalPrompt = `Fix any grammatical errors and improve this text to be more professional, but keep it concise and only give option one: ${sourceText}`;
                    }

                    console.log('[content.js] Final prompt constructed:', finalPrompt);
                    enhanced = await enhanceTextWithGemini(finalPrompt + SINGLE_OUTPUT_SUFFIX, true);
                } catch (e) {
                    console.error('[content.js] Error while building finalPrompt:', e);
                    enhanced = await enhanceTextWithGemini(prompt + SINGLE_OUTPUT_SUFFIX, true);
                }

                console.log("[content.js] Enhanced prompt:", enhanced);

                if (typeof lastActiveInput !== "undefined" && lastActiveInput && (typeof isValidInput !== "function" || isValidInput(lastActiveInput))) {
                    if (typeof setInputText === "function") {
                        await setInputText(lastActiveInput, enhanced || prompt);
                    } else {
                        if (lastActiveInput.isContentEditable) {
                            lastActiveInput.innerText = enhanced || prompt;
                            lastActiveInput.dispatchEvent(new Event("input", { bubbles: true }));
                        } else {
                            lastActiveInput.value = enhanced || prompt;
                            lastActiveInput.dispatchEvent(new Event("input", { bubbles: true }));
                        }
                    }
                    if (typeof placeCursorAtEnd === "function") placeCursorAtEnd(lastActiveInput);
                    lastEnhancedText = enhanced || prompt;
                    sendResponse({ success: true, injected: true, enhanced: !!enhanced });
                    return;
                }

                // No focused input — store for later
                globalPrompt = enhanced || prompt;
                window.__lastPopupPrompt = enhanced || prompt;
                lastEnhancedText = enhanced || prompt;
                sendResponse({ success: true, injected: false, enhanced: !!enhanced });
                return;
            }

            // No enhancer — inject raw prompt into the currently focused element if possible
            const active = document.activeElement;
            if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
                if (active.isContentEditable) {
                    active.innerText = prompt;
                    const range = document.createRange();
                    range.selectNodeContents(active);
                    range.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    active.value = prompt;
                    active.dispatchEvent(new Event("input", { bubbles: true }));
                }
                sendResponse({ success: true, injected: true, enhanced: false });
                return;
            }

            // Fallback: save prompt for later
            globalPrompt = prompt;
            window.__lastPopupPrompt = prompt;
            sendResponse({ success: true, injected: false, enhanced: false });
        } catch (err) {
            console.error("[content.js] Error processing prompt:", err);
            sendResponse({ success: false, error: err && err.message ? err.message : String(err) });
        }
    })();

    return true;
});

// Listen for prompt updates from other tabs
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'PROMPT_UPDATED') {
        console.log('[content.js] Received prompt update from another tab:', message.prompt);
        globalPrompt = message.prompt;
        window.__lastPopupPrompt = message.prompt;
        sendResponse({ received: true });
    }
});

// Initial check for models (optional, can be removed once confident)
// checkAvailableModels();