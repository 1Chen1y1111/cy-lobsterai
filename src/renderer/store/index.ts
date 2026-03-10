import { configureStore } from '@reduxjs/toolkit'
import { modelReducer } from './slices/modelSlice'
import { coworkReducer } from './slices/coworkSlice'
import { skillReducer } from './slices/skillSlice'

export const store = configureStore({
  reducer: {
    model: modelReducer,
    cowork: coworkReducer,
    skill: skillReducer
  }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
