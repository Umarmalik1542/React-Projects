# 📝 React Todo App with Context API & LocalStorage

## 📌 Project Overview
This is a **Todo Management Application** built with **React**, using:
- **Context API** for state management
- **LocalStorage** for data persistence
- **Tailwind CSS** for styling

The app allows users to:
- ➕ Add new todos
- ✏️ Edit existing todos
- ✅ Mark todos as completed
- ❌ Delete todos
- 💾 Save todos even after page refresh (using LocalStorage)

---

## 🛠️ **Technologies Used**
- **React** (useState, useEffect, useContext, createContext)
- **Context API** (for global state sharing)
- **Tailwind CSS** (for UI styling)
- **LocalStorage** (for persistent data storage)

---

## 🚀 **How the App Works**
### 1. **State Management with Context API**
- **English:**  
  - `createContext` is used to create a context that holds todos and related functions.  
  - `Provider` shares this data across all components.  
  - `useContext` (via `useTodoContext`) allows components to access and use the shared data.  

- **Roman Urdu:**  
  - `createContext` se ek context banta hai jo todos aur related functions hold karta hai.  
  - `Provider` ye data sab components ke sath share karta hai.  
  - `useContext` (`useTodoContext` ke zariye) components ko ye shared data use karne deta hai.  

---

### 2. **Local State in Components**
- **English:**  
  - `useState` is used in components to handle input fields (`TodoForm`) and edit modes (`TodoItem`).  

- **Roman Urdu:**  
  - `useState` components me input fields (`TodoForm`) aur edit mode (`TodoItem`) handle karne ke liye use hota hai.  

---

### 3. **LocalStorage for Persistence**
- **English:**  
  - `useEffect` loads todos from localStorage when the app starts.  
  - Another `useEffect` saves todos to localStorage whenever they change.  

- **Roman Urdu:**  
  - `useEffect` app start hone par todos localStorage se load karta hai.  
  - Dusra `useEffect` todos change hone par unhe localStorage me save karta hai.  

---

## 🏗️ **Project Structure**

📦 react-todo-app
┣ 📂 src
┃ ┣ 📂 Components
┃ ┃ ┣ 📜 TodoForm.jsx # Form for adding todos
┃ ┃ ┗ 📜 TodoItem.jsx # Displays individual todo
┃ ┣ 📂 Context
┃ ┃ ┗ 📜 todoContextCreation.js # Context & custom hook
┃ ┣ 📜 App.jsx # Main component with Provider
┃ ┗ 📜 index.css / App.css # Styling
┣ 📜 package.json
┣ 📜 README.md

yaml
Copy
Edit


---

## 🔥 **Features**
- ✅ Add todos dynamically
- ✅ Edit todos (if not completed)
- ✅ Toggle completed state (checkbox)
- ✅ Delete todos
- ✅ Data stays after refresh (LocalStorage)
- ✅ Modern UI with Tailwind CSS

---

## 📚 **Concepts Used**

| Concept | Description (English) 
|---------|------------------------|--------------------------|
| **createContext** | Creates a global context to hold data.
| **Provider* | Shares the context data with all components.
| **useConext** | Allows components to access context data easily.
 **useState** | Manages local state (input, edit mode, todos) | Local state managtodos).
| **ueEffect** | Runs side effects (load & save todos in LocalStorage).
| **LocalStorage** | Stores todos permanently on the browser.
| **Tailwind SS** | Used for styling the UI.

---
