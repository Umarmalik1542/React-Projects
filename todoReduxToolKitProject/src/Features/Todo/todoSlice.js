import { createSlice,nanoid } from "@reduxjs/toolkit";

const initialStateOfStore = {
    todos:
    [
        {
            id:nanoid(),
            title:"Learn Redux Toolkit"
        }
    ]
}

export const todoSlice = createSlice({
    name: "todo",
    initialState:initialStateOfStore,
    reducers:{
        addTodo:(state,action) =>{
            const todo = {
                id:nanoid(),
                title:action.payload.title
            }
            state.todos.push(todo);
        },

        removeTodo:(state,action) =>{
            state.todos = state.todos.filter((prevTodo) =>
                prevTodo.id !== action.payload
            );
        },
        
        updateTodo:(state,action) =>{
            const {id,title} = action.payload;
            const todo = state.todos.find((todo) =>todo.id ===id);
            if(todo) {
                todo.title =title;
            }
        }
    }
})

export const {addTodo,removeTodo,updateTodo} = todoSlice.actions

export default todoSlice.reducer