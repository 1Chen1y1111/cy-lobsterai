import { configureStore } from "@reduxjs/toolkit";
import { modelReducer } from "./slices/modelSlice";
import { coworkReducer } from "./slices/coworkSlice";

export const store = configureStore({
  reducer: {
    model: modelReducer,
    cowork: coworkReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
