// store/store.js
// UPDATED - With authentication actions

import { configureStore, combineReducers } from "@reduxjs/toolkit";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { persistReducer, persistStore } from "redux-persist";

// ============ ACTION TYPES ============
const SET_LOGGED_IN = "SET_LOGGED_IN";
const SET_USER = "SET_USER";
const SET_BUSINESS_ID = "SET_BUSINESS_ID";
const SET_SETTINGS = "SET_SETTINGS";

// ============ ACTION CREATORS ============
export const setLoggedIn = (value) => ({
  type: SET_LOGGED_IN,
  payload: value,
});

export const setUser = (user) => ({
  type: SET_USER,
  payload: user,
});

export const setBusinessId = (id) => ({
  type: SET_BUSINESS_ID,
  payload: id,
});

export const setSettings = (settings) => ({
  type: SET_SETTINGS,
  payload: settings,
});

// ============ INITIAL STATE ============
const initialSettingsState = {
  loggedIn: false,
  user: null,
  businessId: null,
  scaleAddress: null,
  printerAddress: null,
  products: [],
  locations: [],
  collectionRecords: { daily: 0, weekly: 0, monthly: 0 },
};

// ============ SETTINGS REDUCER ============
const settingsReducer = (state = initialSettingsState, action) => {
  switch (action.type) {
    case SET_LOGGED_IN:
      return { ...state, loggedIn: action.payload };
    case SET_USER:
      return { ...state, user: action.payload };
    case SET_BUSINESS_ID:
      return { ...state, businessId: action.payload };
    case SET_SETTINGS:
      return { ...state, ...action.payload };
    default:
      return state;
  }
};

// ============ STORE CONFIGURATION ============
const persistConfig = {
  key: "root",
  storage: AsyncStorage,
  whitelist: ["settings"],
};

const rootReducer = combineReducers({
  settings: settingsReducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) => {
    return getDefaultMiddleware({
      serializableCheck: false,
    });
  },
});

export const persistor = persistStore(store);
