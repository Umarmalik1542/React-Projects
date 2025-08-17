import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { removeTodo, updateTodo } from '../Features/Todo/todoSlice';

function AddTodos() {
  const todos = useSelector((state) => state.todo.todos); // ✅ make sure path is correct
  const dispatch = useDispatch();

  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const handleEditClick = (todo) => {
    setEditingId(todo.id);
    setEditText(todo.title); // ✅ Set current todo title into input
  };

  const handleUpdate = (id) => {
    if (editText.trim()) {
      dispatch(updateTodo({ id, title: editText }));
      setEditingId(null);
      setEditText('');
    }
  };

  return (
    <>
      <div className="text-white text-lg mb-2">Todos</div>
      <ul className="list-none">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className="mt-4 flex justify-between items-center bg-zinc-800 px-4 py-2 rounded"
          >
            <div className="text-white flex-1 mr-4">
              {editingId === todo.id ? (
                <input
                  type="text"
                  className="w-full text-white px-2 py-1 rounded"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                />
              ) : (
                todo.title
              )}
            </div>

            <div className="flex gap-2">
              {editingId === todo.id ? (
                <button
                  onClick={() => handleUpdate(todo.id)}
                  className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                >
                  Save
                </button>
              ) : (
                <button
                  onClick={() => handleEditClick(todo)}
                  className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                >
                  Edit
                </button>
              )}

              <button
                onClick={() => dispatch(removeTodo(todo.id))}
                className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default AddTodos;
