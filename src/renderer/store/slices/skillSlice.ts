import { Skill } from '@/types/skill'
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface SkillState {
  skills: Skill[]
  activeSkillIds: string[] // Currently selected skills for conversation (multi-select)
}

const initialState: SkillState = {
  skills: [],
  activeSkillIds: []
}

const skillSlice = createSlice({
  name: 'skill',
  initialState,
  reducers: {
    setSkills: (state, action: PayloadAction<Skill[]>) => {
      state.skills = action.payload
      // Remove any active skill IDs that no longer exist
      state.activeSkillIds = state.activeSkillIds.filter((id) => action.payload.some((skill) => skill.id === id))
    }
  }
})

export const { setSkills } = skillSlice.actions
export const skillReducer = skillSlice.reducer
