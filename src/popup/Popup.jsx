import React, { useState } from 'react';
import '../../public/style.css';

const Popup = () => {
  const [isEnabled, setIsEnabled] = useState(false);

  const handleToggle = () => {
    const newState = !isEnabled;
    setIsEnabled(newState);
    
    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'enhance' });
    });
  };

  return (
    <div className="popup-container">
      <h1>Web Enhancer</h1>
      <div className="toggle-container">
        <label className="switch">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={handleToggle}
          />
          <span className="slider round"></span>
        </label>
        <span className="toggle-label">
          {isEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
    </div>
  );
};

export default Popup; 