import { configureStore } from "@reduxjs/toolkit";
import { modelReducer } from "./slices/modelSlice";

export const store = configureStore({
  reducer: {
    model: modelReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
