import { useState } from 'react'
import React from 'react'
import './App.css'
import AddTodo from './Components/addTodo'
import TodosList from './Components/TodosList'
function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <h1>todo with redux toolkit</h1>
    <AddTodo />
    <TodosList />
    </>
  )
}

export default App
