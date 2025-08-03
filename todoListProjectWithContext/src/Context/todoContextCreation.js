import { useContext,createContext } from "react";

export const TodoContext = createContext({
    todos:[{
        id:1,
        todo:'learning react',
        isChecked:false
    }],

    addTodo: () => {},
    updateTodo:(id,todoMsg) => {},
    isCheckedTodo:(id) => {},
    deleteTodo:(id) => {}
})

export const TodoProvider = TodoContext.Provider;

export const useTodoContext = () =>{
    return useContext(TodoContext);
}