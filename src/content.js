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
const getInputText = (element) => {
    console.log('%c🔍 getInputText called for:', 'color: #2196F3', element);
    
    if (!element) {
        console.error('%cgetInputText received null/undefined element.', 'color: #F44336');
        return '';
    }

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        console.log('%cInput/Textarea value:', 'color: #2196F3', element.value);
        return element.value;
    }
    
    const contentEditableElement = findClosestContentEditable(element);
    if (contentEditableElement) {
        console.log('%cContentEditable element found:', 'color: #2196F3', contentEditableElement);
        
        const textSpan = contentEditableElement.querySelector('.selectable-text.copyable-text[data-lexical-text="true"]');
        if (textSpan) {
            console.log('%cText span content:', 'color: #2196F3', textSpan.textContent);
            return textSpan.textContent;
        }
        
        console.log('%cContentEditable textContent:', 'color: #2196F3', contentEditableElement.textContent);
        return contentEditableElement.textContent;
    }
    console.log('%cNo text found for element.', 'color: #F44336');
    return '';
};

// Function to set text in an input element
async function setInputText(element, text) {
    console.log('%c✍️ Setting text for element:', 'color: #2196F3', element, 'with text:', text);
    
    if (!element) {
        console.log('No element provided to setInputText');
        return;
    }

    const isContentEditable = element.getAttribute('contenteditable') === 'true';
    const isTextarea = element.tagName === 'TEXTAREA';
    const isInput = element.tagName === 'INPUT';
    const isWhatsApp = window.location.hostname.includes('web.whatsapp.com');
    
    console.log('Element type:', {
        isContentEditable,
        isTextarea,
        isInput,
        isWhatsApp,
        tagName: element.tagName
    });

    if (isContentEditable) {
        const contentEditableElement = element;
        const observerWasConnected = currentObserver && currentObserver.isConnected;
        
        if (observerWasConnected) {
            console.log('Disconnecting observer before setting text');
            currentObserver.disconnect();
        }
        
        isApiUpdate = true; // Set this flag BEFORE modifying the DOM
        console.log('%c🚩 isApiUpdate set to TRUE in setInputText (before DOM mod).', 'color: #FFC107', `Time: ${performance.now().toFixed(2)}ms`);
        
        try {
            if (isWhatsApp) {
                // For WhatsApp Web, use the specialized function
                await setEditableText(contentEditableElement, text);
            } else {
                // For other contenteditable elements
                contentEditableElement.textContent = text;
                contentEditableElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            // Reset isApiUpdate after a delay
            setTimeout(() => {
                isApiUpdate = false;
                console.log('%c🚩 isApiUpdate set to FALSE (after delay).', 'color: #FFC107', `Time: ${performance.now().toFixed(2)}ms`);
                // Also reset lastProcessedText to allow new changes to trigger popup
                lastProcessedText = text;
                console.log('%c[MutationObserver] lastProcessedText reset to:', 'color: #FFC107', `"${lastProcessedText}"`);
            }, 300); // Increased delay slightly to 300ms
            
            if (contentEditableElement && observerWasConnected) { // Reconnect only if it was disconnected
                console.log('Reconnecting observer after setting text');
                setupMutationObserver(contentEditableElement);
            }
        } catch (error) {
            console.error('Error setting contenteditable text:', error);
            isApiUpdate = false; // Reset flag on error
        }
    } else if (isTextarea || isInput) {
        isApiUpdate = true; // Set this flag BEFORE modifying the DOM
        console.log('%c🚩 isApiUpdate set to TRUE in setInputText (before DOM mod).', 'color: #FFC107', `Time: ${performance.now().toFixed(2)}ms`);
        
        try {
            element.value = text;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Reset isApiUpdate after a delay
            setTimeout(() => {
                isApiUpdate = false;
                console.log('%c🚩 isApiUpdate set to FALSE (after delay).', 'color: #FFC107', `Time: ${performance.now().toFixed(2)}ms`);
                // Also reset lastProcessedText to allow new changes to trigger popup
                lastProcessedText = text;
                console.log('%c[MutationObserver] lastProcessedText reset to:', 'color: #FFC107', `"${lastProcessedText}"`);
            }, 300); // Increased delay slightly to 300ms
        } catch (error) {
            console.error('Error setting input/textarea value:', error);
            isApiUpdate = false; // Reset flag on error
        }
    } else {
        console.log('Element is not a valid input type:', element.tagName);
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

    // Set popup content - it will always be the Enhance button
    popup.innerHTML = `
  <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px;">
    <span style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">✨ Instantly corrected</span>
    <div style="display: flex; gap: 8px;">
      <button class="pop_up_button" id="enhance-btn">
        Enhance your text
      </button>
      <button class="pop_up_button secondary" id="no-thanks-btn" style="background: #fff; color: #d32f2f; border: 1px solid #d32f2f;">
        No thanks
      </button>
    </div>
  </div>
`;

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

    const prompt = `Fix any grammatical errors and improve this text to be more professional, but keep it concise and only give option one: ${text}`;

    try {
        const response = await callGeminiAPI(prompt, hideAlert);
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
        width: 100px;
        height: 25px;
        z-index: 10000;
        text-transform: uppercase;
        background-color:blue;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.3s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    `;
    document.body.appendChild(popup);
    return popup;
}

const popup = createPopup();

// Reset popup state
function resetPopup() {
    popup.innerHTML = '<button>Enhance</button>';
    popup.style.opacity = '0';
    popup.style.display = 'none';
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    if (textChangeTimeout) {
        clearTimeout(textChangeTimeout);
        textChangeTimeout = null;
    }
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

popup.addEventListener('click', async function(e) {
    e.stopPropagation();
    
    if (isProcessing) {
        return;
    }
    
    // Ensure lastActiveInput is valid before proceeding
    if (!lastActiveInput || !isValidInput(lastActiveInput)) {
        popup.style.display = 'none';
        resetPopup();
        alert('Please click on an input field and type some text first');
        console.error('No valid lastActiveInput when enhance button clicked. lastActiveInput:', lastActiveInput);
        return;
    }

    // Use textToEnhance which was captured when popup was shown
    if (!textToEnhance.trim()) {
        popup.style.display = 'none';
        resetPopup();
        alert('No text available to enhance.');
        console.error('Attempted to enhance empty text from textToEnhance.');
        return;
    }

    try {
        isProcessing = true;
        popup.innerHTML = 'Processing...';
        console.log('%c🤖 Calling Gemini API with stored textToEnhance:', 'color: #8D6E63', `"${textToEnhance}"`, `Time: ${performance.now().toFixed(2)}ms`); // Log the stored text and time
        const enhancedText = await enhanceTextWithGemini(textToEnhance, true); // Use textToEnhance for API call
        
        if (enhancedText) {
            isApiUpdate = true; // Set flag before setting text
            console.log('%c🚩 isApiUpdate set to TRUE in popup click handler (before setInputText).', 'color: #FFC107', `Time: ${performance.now().toFixed(2)}ms`);
            await setInputText(lastActiveInput, enhancedText);
            placeCursorAtEnd(lastActiveInput);
            lastActiveInput.dispatchEvent(new Event('input', { bubbles: true }));
            lastActiveInput.dispatchEvent(new Event('change', { bubbles: true }));
            // lastProcessedText is now updated inside setInputText automatically
            lastEnhancedText = enhancedText; // Store the enhanced text
            console.log('%clastEnhancedText updated to:', 'color: #FFC107', `"${lastEnhancedText}"`, `Time: ${performance.now().toFixed(2)}ms`);
            popup.style.display = 'none';
            resetPopup();
        } else {
            popup.innerHTML = 'Error: Could not enhance text';
            setTimeout(resetPopup, 2000);
        }
    } catch (error) {
        console.error('Error during text enhancement:', error);
        popup.innerHTML = 'Error: ' + error.message;
        setTimeout(resetPopup, 2000);
    } finally {
        isProcessing = false;
        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
        }
    }
});

// Initial check for models (optional, can be removed once confident)
// checkAvailableModels(); 