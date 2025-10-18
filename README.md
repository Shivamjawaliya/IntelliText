# 🧠 IntelliText – AI-Powered Text Enhancement Chrome Extension

> A Chrome Extension like Grammarly that enhances your writing clarity, grammar, and tone using the **Gemini AI API** — built with **React + TypeScript + Vite** and powered by **Manifest V3**.

---

## 🚀 Features

✅ Detects typing in any editable field (`input`, `textarea`, or `contenteditable` elements)  
✅ Waits for 2 seconds of inactivity before suggesting improvements  
✅ Displays a smart **popup** near the editable element  
✅ Uses **Gemini AI** to enhance the clarity, tone, and grammar of your text  
✅ Allows users to **Accept**, **Reject**, or **Edit** the AI-enhanced suggestion  
✅ Works seamlessly across all webpages  
✅ Lightweight, secure, and built with **modern web technologies**

---

## 🧩 Tech Stack

- ⚛️ **React + TypeScript + Vite**
- 🔥 **Manifest V3** (latest Chrome Extension API)
- 🤖 **Gemini AI API**
- 💡 Dynamic **React popup** injected using `createRoot()`
- 🎨 Clean CSS styling for the popup interface

---

## 🗂 Folder Structure

```
IntelliText/
├── public/
│ └── icon.png
├── src/
│ ├── api/
│ │ └── gemini.ts
│ ├── content/
│ │ └── contentScript.ts
│ └── popup/
│ ├── Popup.tsx
│ └── popup.css
├── main.tsx
├── manifest.json
├── vite.config.ts
├── tsconfig.json
└── package.json
```
---



## 1 Clone the Repository

```
git clone https://github.com/Shivamjawaliya/IntelliText.git
cd IntelliText
```

 ## 2 Install Dependencies
 ```
npm install
# or
yarn install
```
## 3 Run the Development Server
```
npm run dev
```

## 4 Build for Production
``` npm run build ```

## 5 Load Extension in Chrome
1. Open chrome://extensions/
2. Turn on Developer mode
3. Click Load unpacked
4. Select the dist folder
