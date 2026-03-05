import { CoworkConfig } from "@/types/cowork";
import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface CoworkState {
  config: CoworkConfig;
}

const initialState: CoworkState = {
  config: {
    workingDirectory: "",
    systemPrompt: "",
    executionMode: "local",
    memoryEnabled: true,
    memoryImplicitUpdateEnabled: true,
    memoryLlmJudgeEnabled: false,
    memoryGuardLevel: "strict",
    memoryUserMemoriesMaxItems: 12,
  },
};

const coworkSlice = createSlice({
  name: "cowork",
  initialState,
  reducers: {
    setConfig(state, action: PayloadAction<CoworkConfig>) {
      state.config = action.payload;
    },
    updateConfig(state, action: PayloadAction<Partial<CoworkConfig>>) {
      state.config = { ...state.config, ...action.payload };
    },
  },
});

export const { setConfig, updateConfig } = coworkSlice.actions;

export const coworkReducer = coworkSlice.reducer;
